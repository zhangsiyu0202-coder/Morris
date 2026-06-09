"use client"

import { useEffect, useRef, useState } from "react"
import { useInterviewBootstrap } from "@/lib/use-interview-bootstrap"
import { useLiveInterview } from "@/lib/use-live-interview"
import { InterviewRoomShell } from "./interview-room-shell"
import { InterviewLoadingScreen, PreInterviewFlow } from "./pre-interview-flow"
import { InterviewStatus } from "./interview-status"

interface InterviewRoomProps {
  linkToken: string | null
}

/**
 * Live interview-side orchestration.
 *
 * Flow: pre-interview consent flow → (on consent) issue the one-time room token
 * → connect over LiveKit → render the dark two-pane room shell driven entirely
 * by the agent's published state. Token issuance is deliberately gated on
 * `started` so merely opening the page never spends the single-use session slot.
 */
export function InterviewRoom({ linkToken }: InterviewRoomProps) {
  const [started, setStarted] = useState(false)
  const bootstrap = useInterviewBootstrap(linkToken, started)
  const session = useLiveInterview(bootstrap.connectArgs)
  const mediaStartedRef = useRef(false)

  const connected = session.phase === "connected" || session.phase === "reconnecting"

  // Once in the room, publish camera + screenshare. This is the consent gate:
  // we only reach a connected room after the interviewee accepted in the flow,
  // so enabling here is authorized. Mic is enabled by the transport on connect.
  useEffect(() => {
    if (!connected || mediaStartedRef.current) return
    mediaStartedRef.current = true
    void session.setCameraEnabled(true)
    void session.setScreenShareEnabled(true)
  }, [connected, session])

  if (!linkToken) {
    return (
      <InterviewStatus
        tone="error"
        title="链接无效"
        detail="缺少访谈链接参数，请使用研究者提供的完整链接。"
      />
    )
  }

  if (!started) {
    return <PreInterviewFlow onReady={() => setStarted(true)} />
  }

  if (bootstrap.phase === "error") {
    return <InterviewStatus tone="error" title="无法加入访谈" detail={describeError(bootstrap.error)} />
  }

  if (session.phase === "error") {
    return <InterviewStatus tone="error" title="连接中断" detail={describeError(session.error)} />
  }

  if (session.completed) {
    return (
      <InterviewStatus
        tone="done"
        title="访谈到此结束"
        detail="感谢你的参与，你的回答已经记录。"
      />
    )
  }

  if (!connected) {
    return <InterviewLoadingScreen label={loadingLabel(bootstrap.phase, session.phase)} />
  }

  return <InterviewRoomShell session={session} linkKind={bootstrap.linkKind} />
}

function loadingLabel(
  bootstrapPhase: ReturnType<typeof useInterviewBootstrap>["phase"],
  sessionPhase: string,
): string {
  if (bootstrapPhase !== "ready") return "正在为你建立安全的访谈房间…"
  if (sessionPhase === "connecting" || sessionPhase === "idle") return "正在接入语音访谈…"
  return "即将开始…"
}

function describeError(code: string | null): string {
  switch (code) {
    case "link_not_found":
      return "访谈链接不存在，请确认链接是否正确。"
    case "link_expired":
      return "访谈链接已过期，请向研究者索取新的链接。"
    case "link_exhausted":
      return "访谈链接的使用次数已用尽。"
    case "survey_not_published":
      return "此访谈暂未开放，请稍后重试或联系研究者。"
    case "link_revoked":
      return "该链接已被停用，请向研究者索取新的链接。"
    case "appwrite_not_configured":
      return "服务尚未配置完成，请稍后再试。"
    case "agent_unavailable":
      return "AI 访谈员暂时不可用，请稍后重试。"
    default:
      return "出现了一些问题，请刷新页面重试。"
  }
}

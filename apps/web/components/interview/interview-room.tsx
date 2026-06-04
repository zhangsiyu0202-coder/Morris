"use client"

import type { InterviewAnswerPayload } from "@merism/contracts"
import { useInterviewBootstrap } from "@/lib/use-interview-bootstrap"
import { useLiveInterview } from "@/lib/use-live-interview"
import { QuestionCard } from "./question-card"
import { InterviewStatus } from "./interview-status"

interface InterviewRoomProps {
  linkToken: string | null
}

/**
 * Live interview-side orchestration.
 *
 * Bootstraps a room token from the link, connects over LiveKit, then renders
 * the structured question card driven entirely by the agent's published state.
 * The card itself is identical to the preview build — only the data source
 * differs.
 */
export function InterviewRoom({ linkToken }: InterviewRoomProps) {
  const bootstrap = useInterviewBootstrap(linkToken)
  const session = useLiveInterview(bootstrap.connectArgs)

  if (!linkToken) {
    return <InterviewStatus tone="error" title="链接无效" detail="缺少访谈链接参数，请使用研究者提供的完整链接。" />
  }

  if (bootstrap.phase === "error") {
    return <InterviewStatus tone="error" title="无法加入访谈" detail={describeError(bootstrap.error)} />
  }

  if (bootstrap.phase !== "ready") {
    return <InterviewStatus tone="pending" title="正在准备访谈" detail="正在为你建立安全的访谈房间…" />
  }

  if (session.phase === "error") {
    return <InterviewStatus tone="error" title="连接中断" detail={describeError(session.error)} />
  }

  if (session.phase === "connecting" || session.phase === "idle") {
    return <InterviewStatus tone="pending" title="正在连接" detail="正在接入语音访谈…" />
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

  if (!session.question) {
    return <InterviewStatus tone="pending" title="访谈员正在准备问题" detail="请稍候，AI 访谈员马上开始。" />
  }

  async function handleSubmit(answer: InterviewAnswerPayload) {
    await session.submitAnswer(answer)
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      {session.phase === "reconnecting" ? (
        <p className="mb-4 rounded bg-mauve-100 px-4 py-2 text-center text-caption text-ink-600">
          网络波动，正在重新连接…
        </p>
      ) : null}
      <QuestionCard question={session.question} onSubmit={handleSubmit} />
    </div>
  )
}

function describeError(code: string | null): string {
  switch (code) {
    case "link_not_found":
      return "访谈链接不存在，请确认链接是否正确。"
    case "link_expired":
      return "访谈链接已过期，请向研究者索取新的链接。"
    case "link_exhausted":
      return "访谈链接的使用次数已用尽。"
    case "appwrite_not_configured":
      return "服务尚未配置完成，请稍后再试。"
    case "agent_unavailable":
      return "AI 访谈员暂时不可用，请稍后重试。"
    default:
      return "出现了一些问题，请刷新页面重试。"
  }
}

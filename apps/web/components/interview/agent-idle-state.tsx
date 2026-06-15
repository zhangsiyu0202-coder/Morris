"use client"

import { useVoiceAssistant } from "@livekit/components-react"
import type { AgentState } from "@livekit/components-react"
import { AlertCircle, Loader2, Mic, Sparkles } from "lucide-react"
import type { TranscriptLine } from "@/lib/hooks/use-live-interview"
import { LiveTranscript } from "./live-transcript"

interface AgentIdleStateProps {
  transcript: ReadonlyArray<TranscriptLine>
}

/**
 * "There is no current question to render" — uses LiveKit's canonical agent
 * state machine (`useVoiceAssistant().state`) as the source of truth. The
 * canonical states + when each fires are documented at
 * https://docs.livekit.io/frontends/build/agent-state/
 *
 * Why this hook over a custom message: LiveKit + Vapi both warn that voice
 * latency > 800ms feels broken (Vapi playbook ch.12 "Latency masking"), and
 * the right copy depends on whether the agent is connecting, thinking,
 * speaking, etc. Hard-coding "访谈员正在准备问题…" lied during long thinking
 * stretches and during connection failures.
 */
export function AgentIdleState({ transcript }: AgentIdleStateProps) {
  const { state } = useVoiceAssistant()
  const view = idleView(state)
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col items-center">
      <div className="mt-12 flex flex-col items-center text-center">
        <span
          className={
            "mb-4 flex size-16 items-center justify-center rounded-full " +
            (view.tone === "danger"
              ? "bg-ink-100 text-ink-900"
              : "bg-ink-100 text-ink-400")
          }
          aria-hidden="true"
        >
          {view.icon}
        </span>
        <p className="font-ui text-body-sm text-ink-600">{view.headline}</p>
        {view.detail ? (
          <p className="mt-1 max-w-md font-ui text-caption text-ink-400">
            {view.detail}
          </p>
        ) : null}
      </div>
      <div className="w-full">
        <LiveTranscript transcript={transcript} />
      </div>
    </div>
  )
}

interface IdleView {
  headline: string
  detail?: string
  icon: React.ReactNode
  tone: "neutral" | "danger"
}

function idleView(state: AgentState): IdleView {
  switch (state) {
    case "connecting":
    case "pre-connect-buffering":
      return {
        headline: "正在接入访谈员…",
        detail: "我们正在为你建立连接,通常需要 5-10 秒。",
        icon: <Loader2 className="size-6 animate-spin" aria-hidden="true" />,
        tone: "neutral",
      }
    case "initializing":
      return {
        headline: "访谈员正在准备…",
        detail: "正在加载访谈大纲和上下文。",
        icon: <Sparkles className="size-6" strokeWidth={2} aria-hidden="true" />,
        tone: "neutral",
      }
    case "idle":
      return {
        headline: "访谈员已就绪",
        detail: "等待开场白,马上开始第一个问题。",
        icon: <Mic className="size-6" strokeWidth={2} aria-hidden="true" />,
        tone: "neutral",
      }
    case "listening":
      return {
        headline: "请直接开口回答",
        detail: "访谈员正在聆听你的回答。",
        icon: <Mic className="size-6" strokeWidth={2} aria-hidden="true" />,
        tone: "neutral",
      }
    case "thinking":
      return {
        headline: "访谈员正在整理下一个问题…",
        // No detail: thinking is brief, extra copy adds noise.
        icon: <Loader2 className="size-6 animate-spin" aria-hidden="true" />,
        tone: "neutral",
      }
    case "speaking":
      return {
        headline: "访谈员正在说",
        detail: "请稍候,听完后再开口。",
        icon: <Sparkles className="size-6" strokeWidth={2} aria-hidden="true" />,
        tone: "neutral",
      }
    case "failed":
      return {
        headline: "访谈员断开了连接",
        detail: "请刷新页面重试,如多次失败请联系研究者。",
        icon: <AlertCircle className="size-6" strokeWidth={2} aria-hidden="true" />,
        tone: "danger",
      }
    case "disconnected":
      return {
        headline: "访谈已结束",
        detail: "感谢你的参与,可以关闭页面。",
        icon: <Sparkles className="size-6" strokeWidth={2} aria-hidden="true" />,
        tone: "neutral",
      }
    default:
      return {
        headline: "访谈员准备中…",
        icon: <Loader2 className="size-6 animate-spin" aria-hidden="true" />,
        tone: "neutral",
      }
  }
}

"use client"

import { Bot, User } from "lucide-react"
import { useEffect, useRef } from "react"
import type { TranscriptLine } from "@/lib/hooks/use-live-interview"

interface LiveTranscriptProps {
  transcript: ReadonlyArray<TranscriptLine>
}

/**
 * Live conversational transcript shown alongside the question. Borrows PostHog
 * TranscriptChat's two-pillar shape (avatar + speaker label + bubble) but
 * keeps the Mauve Quiet palette: no colored avatars, just `bg-ink-100` circles
 * with mono icons. Agent uses `font-reading text-ink-800`, interviewee uses
 * `font-ui text-ink-600` — typeface role + ink shade carry the speaker
 * affordance, never color (per design-system.md).
 *
 * Differences from PostHog (which serves a static post-completion replay):
 * - We render in real time as `TranscriptSegmentUpdate` events stream from
 *   LiveKit, including interim segments at 60% opacity to signal mutability.
 * - The list auto-scrolls to the latest line.
 * - Empty state stays present so the user knows the panel exists even before
 *   the agent speaks.
 */
export function LiveTranscript({ transcript }: LiveTranscriptProps) {
  const tailRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [transcript])

  return (
    <div className="mt-6 rounded-md border border-ink-200/70 bg-mauve-50/60">
      <div className="flex items-center justify-between border-b border-ink-200/60 px-4 py-2.5">
        <p className="text-caption font-medium uppercase tracking-wider text-ink-400">
          实时对话记录
        </p>
        {transcript.length > 0 ? (
          <p className="font-data text-caption text-ink-400">
            {transcript.length} 条
          </p>
        ) : null}
      </div>

      {transcript.length === 0 ? (
        <p className="px-4 py-5 font-ui text-body-sm text-ink-400">
          暂无对话内容,等待访谈员开口。
        </p>
      ) : (
        <ol className="max-h-72 overflow-y-auto px-4 py-3">
          {transcript.map((line) => (
            <TranscriptBubble key={line.id} line={line} />
          ))}
          <div ref={tailRef} aria-hidden="true" />
        </ol>
      )}
    </div>
  )
}

interface TranscriptBubbleProps {
  line: TranscriptLine
}

function TranscriptBubble({ line }: TranscriptBubbleProps) {
  const isAgent = line.speaker === "agent"
  const name = isAgent ? "访谈员" : "你"
  return (
    <li
      aria-live="polite"
      className={
        "mb-3 flex gap-3 last:mb-0 " + (line.final ? "" : "opacity-60")
      }
    >
      <span
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-600"
        aria-hidden="true"
      >
        {isAgent ? (
          <Bot className="size-3.5" strokeWidth={2} />
        ) : (
          <User className="size-3.5" strokeWidth={2} />
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-caption font-medium uppercase tracking-wider text-ink-400">
          {name}
        </span>
        <span
          className={
            isAgent
              ? "font-reading text-body-sm leading-relaxed text-ink-800"
              : "font-ui text-body-sm leading-relaxed text-ink-600"
          }
        >
          {line.text || (line.final ? "（无内容）" : "…")}
        </span>
      </div>
    </li>
  )
}

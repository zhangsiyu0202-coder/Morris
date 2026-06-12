"use client"

import { useEffect, useRef } from "react"
import type { TranscriptLine } from "@/lib/hooks/use-live-interview"

interface ConversationPanelProps {
  transcript: TranscriptLine[]
}

/**
 * Left-pane live transcript stream on the dark room shell.
 *
 * Consumes the coalesced transcript lines from `useLiveInterview` (agent +
 * interviewee). Interim segments render muted until they finalize. Auto-scrolls
 * to the latest line.
 */
export function ConversationPanel({ transcript }: ConversationPanelProps) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [transcript])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
      <p className="mb-4 text-center font-ui text-caption font-semibold uppercase tracking-widest text-ink-400">
        对话记录
      </p>

      {transcript.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="font-ui text-body-sm text-ink-400">访谈员马上开始，请稍候…</p>
        </div>
      ) : (
        <div className="space-y-3">
          {transcript.map((line) => (
            <TranscriptBubble key={line.id} line={line} />
          ))}
        </div>
      )}

      <div ref={endRef} />
    </div>
  )
}

function TranscriptBubble({ line }: { line: TranscriptLine }) {
  const isAgent = line.speaker === "agent"
  return (
    <div className={`flex flex-col gap-1 ${isAgent ? "items-start" : "items-end"}`}>
      <span className="font-ui text-caption font-semibold uppercase tracking-wider text-mauve-200">
        {isAgent ? "AI 访谈员" : "你"}
      </span>
      <div
        className={`max-w-[95%] rounded-2xl px-4 py-3 ${
          isAgent ? "rounded-tl-sm bg-ink-800 text-ink-100" : "rounded-tr-sm bg-mauve-200 text-ink-900"
        } ${line.final ? "" : "opacity-70"}`}
      >
        <p className="font-reading text-body-sm leading-relaxed">{line.text}</p>
      </div>
    </div>
  )
}

"use client"

import { BarVisualizer, useVoiceAssistant } from "@livekit/components-react"

/** Voice-assistant state → a short Chinese status line. */
const STATE_LABEL: Record<string, string> = {
  connecting: "连接中…",
  initializing: "准备中…",
  listening: "在听你说…",
  thinking: "思考中…",
  speaking: "访谈员正在说…",
}

/**
 * Always-on voice-activity indicator that sits beside the self-cam, replacing
 * the dropped transcript panel. The bars react to the agent's audio track and
 * its voice-assistant state (listening / thinking / speaking), so the
 * interviewee can see the mic is live and whose turn it is — the affordance
 * that stands in for an absent push-to-talk button.
 *
 * Must render inside a `@livekit/components-react` RoomContext (the room shell
 * provides it). Bars are styled with a custom Mauve-Quiet template, so the
 * `@livekit/components-styles` stylesheet is not needed.
 */
export function VoiceVisualizer() {
  const { state, audioTrack } = useVoiceAssistant()

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6">
      <BarVisualizer
        state={state}
        barCount={5}
        track={audioTrack}
        options={{ minHeight: 12 }}
        className="flex h-20 items-center justify-center gap-2"
      >
        <span className="w-2.5 rounded-full bg-mauve-200/25 transition-colors duration-150 data-[lk-highlighted=true]:bg-mauve-200" />
      </BarVisualizer>
      <p className="font-ui text-caption text-ink-400" role="status" aria-live="polite">
        {STATE_LABEL[state] ?? "语音访谈进行中"}
      </p>
    </div>
  )
}

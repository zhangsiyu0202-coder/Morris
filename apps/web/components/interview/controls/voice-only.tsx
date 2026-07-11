"use client"

/**
 * Open-ended question: no selectable control. The respondent answers by
 * speaking. We show a calm "listening" affordance instead of inputs.
 */
export function VoiceOnly() {
  return (
    <div className="flex items-center gap-3 rounded border border-dashed border-ink-200 bg-mauve-50 px-4 py-4">
      <span className="flex items-end gap-1" aria-hidden="true">
        <span className="h-3 w-1 animate-pulse rounded-full bg-ink-400 [animation-delay:0ms]" />
        <span className="h-5 w-1 animate-pulse rounded-full bg-ink-800 [animation-delay:150ms]" />
        <span className="h-2.5 w-1 animate-pulse rounded-full bg-ink-400 [animation-delay:300ms]" />
      </span>
      <p className="text-body-sm text-ink-600">请直接开口回答，AI 访谈员正在聆听。</p>
    </div>
  )
}

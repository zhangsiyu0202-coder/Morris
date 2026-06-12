"use client"

import { useInterviewSession } from "@/lib/hooks/use-interview-session"
import { QuestionStage } from "@/components/interview/question-stage"
import { MOCK_RUNTIME_QUESTIONS } from "@/lib/mock-session"

const RESPONSE_MODE_LABELS: Record<string, string> = {
  voice_only: "纯语音",
  single_select: "单选",
  multi_select: "多选",
  scale: "量表",
  ranking: "排序",
}

export default function InterviewPage() {
  const { question, index, total, submitAnswer, jumpTo } = useInterviewSession()
  const progress = total > 0 ? Math.round((index / total) * 100) : 0

  return (
    <main className="min-h-dvh bg-mauve-50">
      <div
        className="h-1 w-full bg-ink-200"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="访谈进度"
      >
        <div
          className="h-full bg-ink-800 transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <PreviewSwitcher active={index} onSelect={jumpTo} />

      <div className="w-full px-4 py-10 sm:py-16">
        {question ? (
          <QuestionStage question={question} onSubmit={submitAnswer} />
        ) : (
          <CompletionCard />
        )}
      </div>
    </main>
  )
}

/**
 * Preview-only control to inspect each responseMode renderer.
 * This belongs to the local fixture host, not the production portal.
 */
function PreviewSwitcher({ active, onSelect }: { active: number; onSelect: (target: number) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-2 px-4 pt-6">
      <span className="text-caption uppercase tracking-wider text-ink-400">预览题型</span>
      {MOCK_RUNTIME_QUESTIONS.map((q, i) => (
        <button
          key={q.questionId}
          type="button"
          onClick={() => onSelect(i)}
          className={`rounded-full border px-3 py-1 text-caption transition-colors ${
            active === i
              ? "border-ink-900 bg-ink-900 text-ink-0"
              : "border-ink-200 bg-ink-0 text-ink-600 hover:border-ink-400"
          }`}
        >
          {RESPONSE_MODE_LABELS[q.responseMode] ?? q.responseMode}
        </button>
      ))}
    </div>
  )
}

function CompletionCard() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <section className="rounded-lg border border-ink-200 bg-ink-0 p-8 text-center shadow-sm">
        <p className="text-caption font-medium uppercase tracking-wider text-ink-400">AI Interviewer</p>
        <h1 className="mt-3 text-display-lg font-display text-ink-900">访谈到此结束</h1>
        <p className="mt-3 text-body-sm text-ink-600">感谢你的参与，你的回答已经记录。</p>
      </section>
    </div>
  )
}

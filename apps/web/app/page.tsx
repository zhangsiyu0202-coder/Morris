"use client"

import { useInterviewSession } from "@/lib/use-interview-session"
import { QuestionCard } from "@/components/interview/question-card"

export default function InterviewPage() {
  const { question, index, total, submitAnswer } = useInterviewSession()
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

      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
        {question ? (
          <QuestionCard question={question} onSubmit={submitAnswer} />
        ) : (
          <CompletionCard />
        )}
      </div>
    </main>
  )
}

function CompletionCard() {
  return (
    <section className="rounded-lg border border-ink-200 bg-ink-0 p-8 text-center shadow-sm">
      <p className="text-caption font-medium uppercase tracking-wider text-ink-400">AI Interviewer</p>
      <h1 className="mt-3 text-display-lg font-display text-ink-900">访谈到此结束</h1>
      <p className="mt-3 text-body-sm text-ink-600">感谢你的参与，你的回答已经记录。</p>
    </section>
  )
}

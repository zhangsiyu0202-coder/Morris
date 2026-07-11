"use client"

import { useEffect, useState } from "react"
import type { InterviewAnswerPayload, InterviewRuntimeQuestion } from "@merism/contracts"
import {
  ResponseControl,
  emptyDraft,
  hasSelection,
  type ResponseDraft,
} from "./response-control"

interface QuestionCardProps {
  question: InterviewRuntimeQuestion
  onSubmit: (answer: InterviewAnswerPayload) => void
}

/**
 * The core interview-side render target.
 *
 * Layout matches the reference: an "AI INTERVIEWER" eyebrow label, the large
 * question text, then the stacked full-width response control, then Submit.
 * The control is an aid on top of voice — answering by speaking is always
 * valid, so the submit button stays optional for voice-only questions.
 */
export function QuestionCard({ question, onSubmit }: QuestionCardProps) {
  const [draft, setDraft] = useState<ResponseDraft>(() => emptyDraft(question.options))

  // Reset the local draft whenever the agent advances to a new question.
  useEffect(() => {
    setDraft(emptyDraft(question.options))
  }, [question.questionId, question.options])

  const canSubmit = hasSelection(question.responseMode, draft)

  function handleSubmit() {
    onSubmit(buildAnswer(question, draft))
  }

  return (
    <section className="rounded-lg border border-ink-200 bg-ink-0 p-6 shadow-sm sm:p-8">
      <p className="text-caption font-medium uppercase tracking-wider text-ink-400">AI Interviewer</p>

      <h1 className="mt-3 text-pretty text-display-lg font-display text-ink-900">
        {question.questionText}
      </h1>

      <div className="mt-7">
        <ResponseControl
          mode={question.responseMode}
          options={question.options}
          draft={draft}
          onChange={setDraft}
        />
      </div>

      {question.responseMode !== "voice_only" ? (
        <div className="mt-8">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full rounded bg-mauve-200 px-5 py-3.5 text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            提交
          </button>
          <p className="mt-3 text-center text-caption text-ink-400">你也可以直接开口回答，无需点击。</p>
        </div>
      ) : null}
    </section>
  )
}

/** Map the local UI draft into the wire-format answer payload. */
function buildAnswer(
  question: InterviewRuntimeQuestion,
  draft: ResponseDraft,
): InterviewAnswerPayload {
  const base = {
    questionId: question.questionId,
    sectionId: question.sectionId,
    questionType: question.questionType,
    source: "ui" as const,
    text: "",
    selectedOptions: [] as string[],
    ranking: [] as string[],
  }

  switch (question.responseMode) {
    case "single_select":
      return { ...base, selectedOptions: draft.single ? [draft.single] : [] }
    case "multi_select":
      return { ...base, selectedOptions: draft.multi }
    case "scale":
      return {
        ...base,
        selectedOptions: draft.scale ? [draft.scale] : [],
        score: draft.scale ? parseScore(draft.scale) : undefined,
      }
    case "ranking":
      return { ...base, ranking: draft.ranking }
    case "voice_only":
    default:
      return base
  }
}

/** Pull a leading numeric score out of a scale label like "4 - Very confident". */
function parseScore(label: string): number | undefined {
  const match = label.match(/^\s*(\d+)/)
  return match ? Number(match[1]) : undefined
}

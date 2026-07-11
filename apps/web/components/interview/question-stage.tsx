import type { InterviewAnswerPayload, InterviewRuntimeQuestion } from "@merism/contracts"
import { QuestionCard } from "./question-card"
import { StimulusDisplay } from "./stimulus-display"

interface QuestionStageProps {
  question: InterviewRuntimeQuestion
  onSubmit: (answer: InterviewAnswerPayload) => void
}

/**
 * Lays out the question against its optional stimulus.
 *
 * - No stimulus: the question card stays centered in a single column.
 * - With stimulus: a two-column split on desktop (question left, material
 *   right, matching the reference). On mobile the stimulus stacks on top so
 *   respondents see the material before answering.
 */
export function QuestionStage({ question, onSubmit }: QuestionStageProps) {
  if (!question.stimulus) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <QuestionCard question={question} onSubmit={onSubmit} />
      </div>
    )
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <div className="order-last lg:order-first">
        <QuestionCard question={question} onSubmit={onSubmit} />
      </div>
      <div className="order-first lg:order-last lg:sticky lg:top-10">
        <StimulusDisplay stimulus={question.stimulus} />
      </div>
    </div>
  )
}

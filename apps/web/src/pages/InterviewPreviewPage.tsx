import { InterviewRuntimeStudySchema } from "@merism/contracts"
import { ArrowLeft, MessageSquareQuote } from "lucide-react"
import { Link } from "react-router-dom"
import { z } from "zod"
import { Button } from "@/components/ui"

type InterviewRuntimeStudy = z.infer<typeof InterviewRuntimeStudySchema>

const RUNTIME_KEY = "merism.survey-preview.runtime"

function loadRuntimeStudy(): InterviewRuntimeStudy | null {
  const raw = window.localStorage.getItem(RUNTIME_KEY)
  if (!raw) return null

  try {
    return InterviewRuntimeStudySchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export function InterviewPreviewPage() {
  const runtimeStudy = loadRuntimeStudy()
  const firstSection = runtimeStudy?.sections[0]
  const firstQuestion = firstSection?.questions[0]

  if (!runtimeStudy || !firstSection || !firstQuestion) {
    return (
      <div className="bg-background flex min-h-screen px-6 py-10">
        <div className="mx-auto max-w-4xl hf-empty-state">
          <p className="text-secondary text-sm">No local interview preview is available yet.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background min-h-screen px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <Link to="/projects/default/surveys/demo-1?tab=sessions">
          <Button.Ghost size="sm">
            <ArrowLeft className="h-4 w-4" />
            Back to sessions
          </Button.Ghost>
        </Link>

        <div className="hf-card mt-4 grid overflow-hidden rounded-2xl lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="max-lg:border-b border-accent-light lg:border-r">
            <div className="border-accent-light border-b px-6 py-5">
              <div className="text-secondary text-sm font-medium">Interview preview</div>
              <div className="text-primary mt-1 text-2xl font-semibold">{runtimeStudy.studyTitle}</div>
              <div className="text-secondary mt-2 text-sm">{runtimeStudy.researchGoal}</div>
            </div>

            <div className="space-y-6 px-6 py-6">
              <div>
                <div className="text-secondary text-xs font-medium uppercase tracking-wide">
                  Current section
                </div>
                <div className="text-primary mt-1 text-lg font-semibold">{firstSection.title}</div>
                <div className="text-secondary mt-1 text-sm">{firstSection.objective}</div>
              </div>

              <div className="hf-card-muted p-5">
                <div className="text-secondary flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
                  <MessageSquareQuote className="h-4 w-4" />
                  Current question
                </div>
                <div className="text-primary mt-3 text-lg font-semibold">
                  {firstQuestion.questionText}
                </div>
                <div className="text-secondary mt-2 text-sm">
                  {firstQuestion.questionType.replace("_", " ")} ·{" "}
                  {firstQuestion.probeLevel.replace("_", " ")}
                </div>
                {firstQuestion.options.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    {firstQuestion.options.map((option) => (
                      <div
                        key={option}
                        className="bg-foreground text-primary rounded-lg border border-input px-4 py-3 text-sm"
                      >
                        {option}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <aside className="bg-accent-light p-5">
            <div className="hf-card p-5">
              <div className="text-primary text-sm font-medium">Interview intro</div>
              <div className="text-secondary mt-3 text-sm leading-6">{runtimeStudy.introScript}</div>
            </div>

            <div className="hf-card mt-4 p-5">
              <div className="text-primary text-sm font-medium">Probe instruction</div>
              <div className="text-secondary mt-3 text-sm leading-6">
                {firstQuestion.probeInstruction || "No probing configured."}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

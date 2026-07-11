import { AlertCircle, Check, Loader2 } from "lucide-react"

interface InterviewStatusProps {
  tone: "pending" | "error" | "done"
  title: string
  detail: string
}

/**
 * Full-screen status card for the non-question phases of the interview
 * (preparing, connecting, errors, completion).
 *
 * Per the Mauve Quiet system, status is communicated through icon + copy +
 * container treatment, never color: errors get an outlined `border-ink-900`
 * card, done/pending sit on a quiet mauve surface. Kept presentational so the
 * orchestration in InterviewRoom owns all lifecycle logic.
 */
export function InterviewStatus({ tone, title, detail }: InterviewStatusProps) {
  const outlined = tone === "error"

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-4">
      <section
        className={`w-full rounded-lg bg-ink-0 p-8 text-center ${
          outlined ? "border border-ink-900" : "border border-ink-200 shadow-sm"
        }`}
        role={tone === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        <div className="mb-5 flex justify-center" aria-hidden="true">
          <span className="flex size-11 items-center justify-center rounded-full bg-mauve-100 text-ink-900">
            {tone === "pending" ? (
              <Loader2 className="size-5 animate-spin" />
            ) : tone === "done" ? (
              <Check className="size-5" />
            ) : (
              <AlertCircle className="size-5" />
            )}
          </span>
        </div>
        <p className="text-caption font-medium uppercase tracking-wider text-ink-400">AI Interviewer</p>
        <h1 className="mt-3 text-display-md font-display text-ink-900">{title}</h1>
        <p className="mt-3 text-body-sm text-ink-600">{detail}</p>
      </section>
    </div>
  )
}

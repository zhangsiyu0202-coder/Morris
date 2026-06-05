import { Lightbulb } from "lucide-react"
import type { Insight } from "@/lib/mock-report"

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-0">
        <div className="h-full rounded-full bg-ink-900" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-data text-caption tabular-nums text-ink-400">{`置信 ${pct}%`}</span>
    </div>
  )
}

export function HighlightsSection({ insights }: { insights: Insight[] }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-semibold tracking-tight text-ink-900">关键洞察</h2>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {insights.map((insight) => (
          <article
            key={insight.id}
            className="flex flex-col gap-2.5 rounded-lg bg-mauve-200 px-4 py-4 shadow-[0_2px_4px_rgba(167,133,133,0.08)]"
          >
            <div className="flex items-start gap-2">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-mauve-500" aria-hidden="true" />
              <h3 className="text-body-sm font-semibold leading-snug text-ink-900">{insight.title}</h3>
            </div>
            <p className="text-body-sm leading-relaxed text-ink-600">{insight.text}</p>
            <div className="mt-auto pt-1">
              <ConfidenceBar value={insight.confidence} />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

"use client"

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts"
import type { SentimentDatum, Theme } from "@/lib/mock-report"
import { SENTIMENT_COLOR, SENTIMENT_LABEL } from "./shared"

function SentimentDonut({ data }: { data: SentimentDatum[] }) {
  const total = data.reduce((s, d) => s + d.count, 0)
  return (
    <div className="flex flex-col gap-4 rounded-lg bg-mauve-200 px-5 py-5 shadow-[0_2px_4px_rgba(167,133,133,0.08)]">
      <h3 className="text-body-sm font-semibold text-ink-800">整体情感分布</h3>
      <div className="flex items-center gap-5">
        <ResponsiveContainer width={120} height={120}>
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="sentiment" innerRadius={36} outerRadius={56} paddingAngle={2}>
              {data.map((d) => (
                <Cell
                  key={d.sentiment}
                  fill={SENTIMENT_COLOR[d.sentiment]}
                  stroke="var(--color-ink-0)"
                  strokeWidth={2}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <ul className="flex flex-1 flex-col gap-2">
          {data.map((d) => (
            <li key={d.sentiment} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-body-sm text-ink-700">
                <span className="size-2.5 rounded-full" style={{ background: SENTIMENT_COLOR[d.sentiment] }} aria-hidden="true" />
                {SENTIMENT_LABEL[d.sentiment]}
              </span>
              <span className="font-data text-caption tabular-nums text-ink-500">
                {`${d.count} 人 · ${Math.round((d.count / total) * 100)}%`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function ThemeBars({ themes }: { themes: Theme[] }) {
  const max = Math.max(...themes.map((t) => t.mentions))
  return (
    <div className="flex flex-col gap-4 rounded-lg bg-mauve-200 px-5 py-5 shadow-[0_2px_4px_rgba(167,133,133,0.08)]">
      <h3 className="text-body-sm font-semibold text-ink-800">高频主题</h3>
      <ul className="flex flex-col gap-2.5">
        {themes.map((t) => (
          <li key={t.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-body-sm text-ink-800">{t.label}</span>
              <span className="font-data text-caption tabular-nums text-ink-500">{`${t.mentions} 次 · ${t.pct}%`}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-mauve-100">
              <div
                className="h-full rounded-full"
                style={{ width: `${(t.mentions / max) * 100}%`, background: SENTIMENT_COLOR[t.sentiment] }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AnalysisSection({
  sentiment,
  themes,
}: {
  sentiment: SentimentDatum[]
  themes: Theme[]
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-semibold tracking-tight text-ink-900">情感与主题</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <SentimentDonut data={sentiment} />
        <ThemeBars themes={themes} />
      </div>
    </section>
  )
}

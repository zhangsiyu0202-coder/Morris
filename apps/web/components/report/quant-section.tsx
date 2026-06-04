"use client"

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { QuestionStat } from "@/lib/mock-report"

function ChartCard({
  title,
  meta,
  children,
}: {
  title: string
  meta: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-ink-200 bg-ink-0 p-5 shadow-sm">
      <div className="flex flex-col gap-1">
        <h3 className="text-pretty font-ui text-body font-medium text-ink-900">{title}</h3>
        <p className="text-caption text-ink-400">{meta}</p>
      </div>
      {children}
    </section>
  )
}

const tooltipStyle = {
  borderRadius: 8,
  border: "1px solid var(--color-ink-200)",
  background: "var(--color-ink-0)",
  fontSize: 12,
  color: "var(--color-ink-800)",
  boxShadow: "var(--shadow-popover)",
}

function ChoiceChart({ stat }: { stat: Extract<QuestionStat, { kind: "choice" }> }) {
  return (
    <ChartCard
      title={stat.questionText}
      meta={`${stat.multi ? "多选" : "单选"} · ${stat.total} 份回答`}
    >
      <ResponsiveContainer width="100%" height={Math.max(160, stat.data.length * 46)}>
        <BarChart data={stat.data} layout="vertical" margin={{ left: 0, right: 32 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={120}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--color-ink-600)", fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: "var(--color-mauve-50)" }}
            contentStyle={tooltipStyle}
            formatter={(v, _n, p) => [`${Number(v)} 人 · ${(p.payload as { pct: number }).pct}%`, "选择"]}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={22}>
            {stat.data.map((_, i) => (
              <Cell key={i} fill={i === 0 ? "var(--color-chart-1)" : "var(--color-chart-3)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function RatingChart({ stat }: { stat: Extract<QuestionStat, { kind: "rating" }> }) {
  return (
    <ChartCard title={stat.questionText} meta={`均值 ${stat.average} / ${stat.scaleMax} · ${stat.total} 份回答`}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={stat.data} margin={{ left: -16, right: 8, top: 8 }}>
          <XAxis
            dataKey="score"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--color-ink-600)", fontSize: 12 }}
          />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--color-ink-400)", fontSize: 11 }} />
          <Tooltip
            cursor={{ fill: "var(--color-mauve-50)" }}
            contentStyle={tooltipStyle}
            formatter={(v) => [`${Number(v)} 人`, "评分"]}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={36}>
            {stat.data.map((d, i) => (
              <Cell
                key={i}
                fill={d.score >= 4 ? "var(--color-chart-1)" : d.score === 3 ? "var(--color-chart-3)" : "var(--color-chart-5)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function NpsChart({ stat }: { stat: Extract<QuestionStat, { kind: "nps" }> }) {
  const segments = [
    { label: "推荐者", count: stat.promoters, color: "var(--color-positive)" },
    { label: "中立者", count: stat.passives, color: "var(--color-neutral)" },
    { label: "贬损者", count: stat.detractors, color: "var(--color-negative)" },
  ]
  return (
    <ChartCard title={stat.questionText} meta={`NPS 得分 ${stat.score} · ${stat.total} 份回答`}>
      <div className="flex items-baseline gap-2">
        <span className="font-data text-display-md text-ink-900">{stat.score}</span>
        <span className="text-caption text-ink-500">净推荐值</span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {segments.map((s) => (
          <div
            key={s.label}
            style={{ width: `${(s.count / stat.total) * 100}%`, background: s.color }}
            aria-label={`${s.label} ${s.count} 人`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="text-caption text-ink-600">
              {s.label} {s.count}
              {" 人"}
            </span>
          </div>
        ))}
      </div>
    </ChartCard>
  )
}

export function QuantSection({ stats }: { stats: QuestionStat[] }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-display-sm text-ink-900">定量统计</h2>
        <span className="h-px flex-1 bg-ink-200" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {stats.map((stat) => {
          if (stat.kind === "choice") return <ChoiceChart key={stat.questionId} stat={stat} />
          if (stat.kind === "rating") return <RatingChart key={stat.questionId} stat={stat} />
          return <NpsChart key={stat.questionId} stat={stat} />
        })}
      </div>
    </section>
  )
}

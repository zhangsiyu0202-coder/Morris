"use client"

import { useState } from "react"
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts"
import { ChevronDown, ChevronRight, MessageSquareText } from "lucide-react"
import type { ChoiceDatum, QuestionStat } from "@/lib/mock-report"
import { CHART_RAMP, highlightKeywords } from "./shared"

function ChartFrame({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-mauve-100 p-4">
      <p className="text-caption leading-snug text-ink-500">{caption}</p>
      {children}
    </div>
  )
}

function ChoiceChart({ data }: { data: ChoiceDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 28, left: -20, right: 8, bottom: 8 }}>
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          interval={0}
          height={48}
          tick={{ fill: "var(--color-ink-500)", fontSize: 11 }}
        />
        <YAxis hide />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={44}>
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_RAMP[i % CHART_RAMP.length]} />
          ))}
          <LabelList
            dataKey="pct"
            position="top"
            offset={8}
            content={(props) => {
              const { x, y, width, index } = props as {
                x: number
                y: number
                width: number
                index: number
              }
              const d = data[index]
              return (
                <text
                  x={x + width / 2}
                  y={y - 8}
                  textAnchor="middle"
                  className="font-data"
                  fill="var(--color-ink-700)"
                  fontSize={12}
                  fontWeight={600}
                >
                  {`${d.pct}% (${d.count})`}
                </text>
              )
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function ThemeAccordion({ data }: { data: ChoiceDatum[] }) {
  const [open, setOpen] = useState<string | null>(data[0]?.label ?? null)
  return (
    <ul className="flex flex-col">
      {data.map((d) => {
        const isOpen = open === d.label
        return (
          <li key={d.label} className="border-b border-mauve-300 last:border-b-0">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : d.label)}
              className="flex w-full items-center justify-between gap-3 py-3 text-left"
              aria-expanded={isOpen}
            >
              <span className="text-body-sm font-semibold text-ink-900">{d.label}</span>
              {isOpen ? (
                <ChevronDown className="size-4 shrink-0 text-ink-400" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-4 shrink-0 text-ink-400" aria-hidden="true" />
              )}
            </button>
            {isOpen && d.blurb ? (
              <p className="pb-4 text-body-sm leading-relaxed text-ink-600">
                {highlightKeywords(d.blurb, d.keywords)}
              </p>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function RatingPanel({ stat }: { stat: Extract<QuestionStat, { kind: "rating" }> }) {
  const max = Math.max(...stat.data.map((d) => d.count))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-2">
        <span className="font-data text-4xl font-semibold tracking-tight text-ink-900">{stat.average}</span>
        <span className="text-body-sm text-ink-500">{`/ ${stat.scaleMax} 平均分`}</span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {[...stat.data].reverse().map((d) => (
          <li key={d.score} className="flex items-center gap-3">
            <span className="w-4 shrink-0 font-data text-body-sm text-ink-600">{d.score}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-ink-0">
              <div
                className="h-full rounded-full"
                style={{ width: `${(d.count / max) * 100}%`, background: "var(--color-chart-1)" }}
              />
            </div>
            <span className="w-12 shrink-0 text-right font-data text-caption tabular-nums text-ink-500">
              {`${d.count} 人`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function NpsPanel({ stat }: { stat: Extract<QuestionStat, { kind: "nps" }> }) {
  const segments = [
    { label: "推荐者", count: stat.promoters, color: "var(--color-positive)" },
    { label: "中立者", count: stat.passives, color: "var(--color-neutral)" },
    { label: "贬损者", count: stat.detractors, color: "var(--color-negative)" },
  ]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-2">
        <span className="font-data text-4xl font-semibold tracking-tight text-ink-900">{stat.score}</span>
        <span className="text-body-sm text-ink-500">净推荐值（NPS）</span>
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
      <ul className="flex flex-col gap-2">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-body-sm text-ink-700">
              <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </span>
            <span className="font-data text-caption tabular-nums text-ink-500">
              {`${s.count} 人 · ${Math.round((s.count / stat.total) * 100)}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function QuestionCard({ stat, index }: { stat: QuestionStat; index: number }) {
  const [expanded, setExpanded] = useState(index === 0)
  return (
    <article className="overflow-hidden rounded-lg bg-mauve-50 shadow-[0_2px_4px_rgba(167,133,133,0.08)]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-3 px-5 py-4 text-left"
        aria-expanded={expanded}
      >
        <MessageSquareText className="mt-0.5 size-5 shrink-0 text-mauve-500" aria-hidden="true" />
        <div className="flex flex-1 flex-col gap-1">
          <h3 className="text-pretty text-body font-semibold leading-snug text-ink-900">{stat.questionText}</h3>
          <p className="text-body-sm leading-relaxed text-ink-500">{stat.summary}</p>
        </div>
        {expanded ? (
          <ChevronDown className="mt-1 size-5 shrink-0 text-ink-400" aria-hidden="true" />
        ) : (
          <ChevronRight className="mt-1 size-5 shrink-0 text-ink-400" aria-hidden="true" />
        )}
      </button>

      {expanded ? (
        <div className="grid gap-5 px-5 py-5 shadow-[inset_0_1px_0_var(--color-mauve-300)] lg:grid-cols-2">
          <ChartFrame caption={`报告问题：${stat.reportQuestion}`}>
            {stat.kind === "choice" ? (
              <ChoiceChart data={stat.data} />
            ) : stat.kind === "rating" ? (
              <RatingPanel stat={stat} />
            ) : (
              <NpsPanel stat={stat} />
            )}
          </ChartFrame>

          <div className="flex flex-col">
            {stat.kind === "choice" ? (
              <ThemeAccordion data={stat.data} />
            ) : (
              <div className="flex h-full flex-col justify-center gap-2 rounded-lg bg-mauve-100 p-4">
                <p className="text-body-sm leading-relaxed text-ink-600">{stat.summary}</p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </article>
  )
}

export function FindingsSection({ stats }: { stats: QuestionStat[] }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-semibold tracking-tight text-ink-900">逐题发现</h2>
      <div className="flex flex-col gap-4">
        {stats.map((stat, i) => (
          <QuestionCard key={stat.questionId} stat={stat} index={i} />
        ))}
      </div>
    </section>
  )
}

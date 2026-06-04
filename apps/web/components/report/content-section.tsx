"use client"

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import type { Insight, QuestionSummary, SentimentDatum, SurveyReport, Theme } from "@/lib/mock-report"

const SENTIMENT_COLOR: Record<SentimentDatum["sentiment"], string> = {
  positive: "var(--color-positive)",
  neutral: "var(--color-neutral)",
  negative: "var(--color-negative)",
}

const SENTIMENT_LABEL: Record<SentimentDatum["sentiment"], string> = {
  positive: "正面",
  neutral: "中性",
  negative: "负面",
}

const tooltipStyle = {
  borderRadius: 8,
  border: "1px solid var(--color-ink-200)",
  background: "var(--color-ink-0)",
  fontSize: 12,
  color: "var(--color-ink-800)",
  boxShadow: "var(--shadow-popover)",
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col gap-4 rounded-lg border border-ink-200 bg-ink-0 p-5 shadow-sm ${className}`}>
      {children}
    </section>
  )
}

function SentimentDonut({ data }: { data: SentimentDatum[] }) {
  const total = data.reduce((s, d) => s + d.count, 0)
  return (
    <Card>
      <h3 className="font-ui text-body font-medium text-ink-900">整体情感分布</h3>
      <div className="flex items-center gap-4">
        <ResponsiveContainer width={140} height={140}>
          <PieChart>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, n) => [`${Number(v)} 人`, SENTIMENT_LABEL[n as SentimentDatum["sentiment"]]]}
            />
            <Pie data={data} dataKey="count" nameKey="sentiment" innerRadius={42} outerRadius={64} paddingAngle={2}>
              {data.map((d) => (
                <Cell key={d.sentiment} fill={SENTIMENT_COLOR[d.sentiment]} stroke="var(--color-ink-0)" strokeWidth={2} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-col gap-2">
          {data.map((d) => (
            <div key={d.sentiment} className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: SENTIMENT_COLOR[d.sentiment] }} aria-hidden />
              <span className="text-body-sm text-ink-700">{SENTIMENT_LABEL[d.sentiment]}</span>
              <span className="font-data text-body-sm text-ink-500">{Math.round((d.count / total) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

function ThemeBars({ themes }: { themes: Theme[] }) {
  const max = Math.max(...themes.map((t) => t.mentions))
  return (
    <Card>
      <h3 className="font-ui text-body font-medium text-ink-900">高频主题</h3>
      <ul className="flex flex-col gap-3">
        {themes.map((t) => (
          <li key={t.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-body-sm text-ink-800">{t.label}</span>
              <span className="font-data text-caption text-ink-500">
                {t.mentions} 次 · {t.pct}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-mauve-50">
              <div
                className="h-full rounded-full"
                style={{ width: `${(t.mentions / max) * 100}%`, background: SENTIMENT_COLOR[t.sentiment] }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function InsightList({ insights }: { insights: Insight[] }) {
  return (
    <Card>
      <h3 className="font-ui text-body font-medium text-ink-900">关键洞察</h3>
      <ul className="flex flex-col gap-4">
        {insights.map((i) => (
          <li key={i.id} className="flex flex-col gap-2 border-l-2 border-ink-200 pl-3">
            <p className="text-pretty text-body-sm leading-relaxed text-ink-800">{i.text}</p>
            <div className="flex items-center gap-2">
              <span className="text-caption uppercase tracking-wider text-ink-400">置信度</span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-mauve-50">
                <div
                  className="h-full rounded-full bg-chart-1"
                  style={{ width: `${i.confidence * 100}%`, background: "var(--color-chart-1)" }}
                />
              </div>
              <span className="font-data text-caption text-ink-600">{Math.round(i.confidence * 100)}%</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function SummaryList({ summaries }: { summaries: QuestionSummary[] }) {
  return (
    <Card className="lg:col-span-2">
      <h3 className="font-ui text-body font-medium text-ink-900">逐题摘要</h3>
      <ul className="flex flex-col divide-y divide-ink-100">
        {summaries.map((s) => (
          <li key={s.questionId} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ background: SENTIMENT_COLOR[s.sentiment] }}
                aria-label={SENTIMENT_LABEL[s.sentiment]}
              />
              <span className="text-body-sm font-medium text-ink-900">{s.questionText}</span>
            </div>
            <p className="text-body-sm leading-relaxed text-ink-700">{s.summary}</p>
            {s.citation ? (
              <blockquote className="border-l-2 border-mauve-200 pl-3 text-body-sm italic text-ink-500">
                {s.citation}
              </blockquote>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function ContentSection({ report }: { report: SurveyReport }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-display-sm text-ink-900">内容分析</h2>
        <span className="h-px flex-1 bg-ink-200" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SentimentDonut data={report.sentimentBreakdown} />
        <ThemeBars themes={report.themes} />
        <InsightList insights={report.insights} />
        <SummaryList summaries={report.questionSummaries} />
      </div>
    </section>
  )
}

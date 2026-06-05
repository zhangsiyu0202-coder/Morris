import type { SurveyReport } from "@/lib/mock-report"

function BigKpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1 rounded bg-mauve-50 px-5 py-5 shadow-[0_2px_4px_rgba(167,133,133,0.08)]">
      <span className="font-data text-4xl font-semibold leading-none tracking-tight text-ink-900 sm:text-5xl">
        {value}
      </span>
      <span className="text-body-sm text-ink-500">{label}</span>
    </div>
  )
}

export function SummarySection({ report }: { report: SurveyReport }) {
  const completionRate = Math.round((report.completedRespondents / report.totalRespondents) * 100)

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-semibold tracking-tight text-ink-900">执行摘要</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <BigKpi value={String(report.completedRespondents)} label="完成访谈" />
        <BigKpi value={report.avgDurationLabel} label="平均访谈时长" />
        <BigKpi value={`${completionRate}%`} label="完成率" />
        <BigKpi value={`${report.avgProbeRounds}`} label="平均追问轮次" />
        <BigKpi value={String(report.studyCount)} label="关联研究" />
      </div>

      <div className="rounded bg-mauve-50 px-5 py-4 shadow-[0_2px_4px_rgba(167,133,133,0.08)]">
        <h3 className="mb-3 text-body-sm font-semibold text-ink-800">访谈主题</h3>
        <ul className="grid gap-x-8 gap-y-2 md:grid-cols-2">
          {report.topics.map((topic, i) => (
            <li key={i} className="flex items-start gap-2.5 text-body-sm leading-relaxed text-ink-600">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-mauve-400" aria-hidden="true" />
              <span>{topic}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

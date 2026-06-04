import type { SurveyReport } from "@/lib/mock-report"

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-ink-200 bg-ink-0 px-4 py-3">
      <span className="text-caption uppercase tracking-wider text-ink-400">{label}</span>
      <span className="font-data text-display-sm text-ink-900">{value}</span>
      {hint ? <span className="text-caption text-ink-500">{hint}</span> : null}
    </div>
  )
}

export function ReportHeader({ report }: { report: SurveyReport }) {
  const completionRate = Math.round((report.completedRespondents / report.totalRespondents) * 100)

  return (
    <header className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-caption font-medium uppercase tracking-wider text-ink-400">分析报告</p>
        <h1 className="text-balance font-display text-display-lg text-ink-900">{report.surveyTitle}</h1>
        <p className="text-body-sm text-ink-600">
          {"基于 "}
          {report.completedRespondents}
          {" 份完成访谈的跨受访者聚合分析"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="受访者" value={String(report.totalRespondents)} hint={`${report.completedRespondents} 人完成`} />
        <Kpi label="完成率" value={`${completionRate}%`} />
        <Kpi label="平均时长" value={`${report.avgDurationMin} 分`} hint="每次访谈" />
        <Kpi label="平均追问" value={`${report.avgProbeRounds} 轮`} hint="每题深挖" />
      </div>
    </header>
  )
}

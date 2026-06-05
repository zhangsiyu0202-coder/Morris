import { Clock, Download, RefreshCw } from "lucide-react"
import type { SurveyReport } from "@/lib/mock-report"

export function ReportHeader({ report }: { report: SurveyReport }) {
  return (
    <header className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-caption font-medium uppercase tracking-wider text-ink-400">分析报告</span>
          <h1 className="text-balance font-display text-display-lg text-ink-900">{report.surveyTitle}</h1>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-3.5 py-2 text-body-sm font-medium text-mauve-50 shadow-sm transition-colors hover:bg-ink-800"
        >
          <Download className="size-4" aria-hidden="true" />
          导出报告
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-mauve-50 px-4 py-3 shadow-[0_2px_4px_rgba(167,133,133,0.08)]">
        <div className="flex items-center gap-2.5">
          <Clock className="size-4 text-ink-400" aria-hidden="true" />
          <div className="flex flex-col leading-tight">
            <span className="text-body-sm font-medium text-ink-700">{`上次更新：${report.lastUpdatedLabel}`}</span>
            <span className="text-caption text-ink-400">每收集 10 份回答或每 6 小时自动重新分析一次</span>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-0 px-3 py-1.5 text-body-sm font-medium text-ink-700 shadow-[inset_0_0_0_1px_var(--color-mauve-300)] transition-colors hover:bg-mauve-100"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          立即重新分析
        </button>
      </div>
    </header>
  )
}

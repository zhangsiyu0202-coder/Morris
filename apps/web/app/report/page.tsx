import { MOCK_REPORT } from "@/lib/mock-report"
import { ReportHeader } from "@/components/report/report-header"
import { SummarySection } from "@/components/report/summary-section"
import { HighlightsSection } from "@/components/report/highlights-section"
import { FindingsSection } from "@/components/report/findings-section"
import { AnalysisSection } from "@/components/report/analysis-section"

export const metadata = {
  title: "分析报告 · 协作工具使用体验调研",
  description: "跨受访者聚合的定量统计与 AI 内容分析报告",
}

export default function ReportPage() {
  const report = MOCK_REPORT

  return (
    <main className="min-h-dvh bg-ink-0">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <ReportHeader report={report} />
        <SummarySection report={report} />
        <HighlightsSection insights={report.insights} />
        <FindingsSection stats={report.questionStats} />
        <AnalysisSection sentiment={report.sentimentBreakdown} themes={report.themes} />
      </div>
    </main>
  )
}

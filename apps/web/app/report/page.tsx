import { MOCK_REPORT } from "@/lib/mock-report"
import { ReportHeader } from "@/components/report/report-header"
import { QuantSection } from "@/components/report/quant-section"
import { ContentSection } from "@/components/report/content-section"

export const metadata = {
  title: "分析报告 · 协作工具使用体验调研",
  description: "跨受访者聚合的定量统计与 AI 内容分析报告",
}

export default function ReportPage() {
  const report = MOCK_REPORT

  return (
    <main className="min-h-dvh bg-mauve-50">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10 sm:py-14">
        <ReportHeader report={report} />
        <QuantSection stats={report.questionStats} />
        <ContentSection report={report} />
      </div>
    </main>
  )
}

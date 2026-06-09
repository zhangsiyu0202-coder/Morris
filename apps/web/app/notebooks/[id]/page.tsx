import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { InsightDetail } from "@/components/insights/insight-detail";
import { getInsightById } from "@/lib/actions/insights";
import type { InsightReport } from "@/lib/insights";

export const metadata = {
  title: "洞察详情 · Insights",
  description: "围绕这一聚焦问题、结合调研会话内容的深度分析报告。",
};

export const dynamic = "force-dynamic";

export default async function InsightDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const record = await getInsightById(id);

  if (!record) {
    return (
      <main className="min-h-dvh bg-ink-0">
        <div className="mx-auto max-w-2xl px-6 py-16 text-center">
          <p className="font-display text-h3 text-ink-900">未找到这条洞察</p>
          <p className="mt-2 font-ui text-body-sm leading-6 text-ink-500">
            它可能已被删除,或链接已失效。请回到列表查看。
          </p>
          <Link
            href="/insights"
            className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-4 py-2 font-ui text-body-sm font-medium text-mauve-50 transition-opacity hover:opacity-90"
          >
            <ArrowLeft size={14} /> 返回洞察列表
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-ink-0">
      <InsightDetail
        studyTitle={record.studyTitle}
        question={record.question}
        report={record.report as InsightReport}
      />
    </main>
  );
}

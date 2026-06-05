import { InsightDetail } from "@/components/insights/insight-detail";

export const metadata = {
  title: "洞察详情 · Insights",
  description: "围绕这一聚焦问题、结合调研会话内容的深度分析报告。",
};

export default async function InsightDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="min-h-dvh bg-ink-0">
      <InsightDetail id={id} />
    </main>
  );
}

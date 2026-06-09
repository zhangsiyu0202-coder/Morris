import { InsightsWorkbench } from "@/components/insights/insights-workbench";
import { listStudyOptions } from "@/lib/insights";
import { listInsights } from "@/lib/actions/insights";
import { getCurrentUserId } from "@/lib/queries/auth";

export const metadata = {
  title: "研究洞察 · Insights",
  description: "选择已完成的调研,提出聚焦问题,基于真实访谈数据生成深度分析报告。",
};

// 始终读取最新数据(洞察会被创建/删除)。
export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const ownerUserId = await getCurrentUserId();
  const [studies, cards] = await Promise.all([
    ownerUserId ? listStudyOptions(ownerUserId) : Promise.resolve([]),
    listInsights(),
  ]);

  return (
    <main className="min-h-dvh bg-ink-0">
      <InsightsWorkbench studies={studies} cards={cards} />
    </main>
  );
}

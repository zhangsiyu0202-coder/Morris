import { InsightsWorkbench } from "@/components/insights/insights-workbench";
import { listStudyOptions } from "@/lib/insights";

export const metadata = {
  title: "研究洞察 · Insights",
  description: "选择已完成的调研,提出聚焦问题,基于真实访谈数据生成结构化洞察。",
};

export default function InsightsPage() {
  const studies = listStudyOptions();

  return (
    <main className="min-h-dvh bg-ink-0">
      <InsightsWorkbench studies={studies} />
    </main>
  );
}

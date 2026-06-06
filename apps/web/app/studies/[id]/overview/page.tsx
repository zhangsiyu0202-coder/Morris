import { OverviewView } from "@/components/studies/overview-view";
import { getMockOverview } from "@/lib/mock/workspace";

export default async function OverviewTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const overview = getMockOverview(id);
  return <OverviewView studyId={id} overview={overview} />;
}

import { OverviewView } from "@/components/studies/overview-view";
import { loadStudyOverview } from "@/lib/workspace-data";

export default async function OverviewTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const overview = await loadStudyOverview(id);
  return <OverviewView studyId={id} overview={overview} />;
}

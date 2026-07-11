import { StudyDashboard } from "@/components/dashboard/study-dashboard";
import { loadStudyDashboard } from "@/lib/dashboard/view-data";

export const dynamic = "force-dynamic";

export default async function DashboardTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const view = await loadStudyDashboard(id);
  return <StudyDashboard view={view} />;
}

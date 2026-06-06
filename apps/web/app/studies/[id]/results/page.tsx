import { ResultsTableView } from "@/components/studies/results-table";
import { loadStudyResults } from "@/lib/workspace-data";

export default async function ResultsTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const table = await loadStudyResults(id);
  return <ResultsTableView studyId={id} table={table} />;
}

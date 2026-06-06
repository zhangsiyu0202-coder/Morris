import { ResultsTableView } from "@/components/studies/results-table";
import { getMockResults } from "@/lib/mock/workspace";

export default async function ResultsTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const table = getMockResults(id);
  return <ResultsTableView studyId={id} table={table} />;
}

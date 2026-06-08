import { ResultsTableView } from "@/components/studies/results-table";
import type { Recording } from "@merism/contracts";
import { listRecordingsBySessionIds } from "@/lib/queries/recordings";
import { loadStudyResults } from "@/lib/workspace-data";

export default async function ResultsTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const table = await loadStudyResults(id);

  let recordingsBySessionId: Record<string, Recording> = {};
  try {
    const sessionIds = table.rows.map((r) => r.sessionId);
    const map = await listRecordingsBySessionIds(sessionIds);
    recordingsBySessionId = Object.fromEntries(map);
  } catch {
    recordingsBySessionId = {};
  }

  return (
    <ResultsTableView
      studyId={id}
      table={table}
      recordingsBySessionId={recordingsBySessionId}
    />
  );
}

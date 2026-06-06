import { TranscriptView } from "@/components/studies/transcript-view";
import { loadStudyTranscript } from "@/lib/workspace-data";

export default async function TranscriptPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const transcript = await loadStudyTranscript(sessionId);
  return <TranscriptView studyId={id} transcript={transcript} />;
}

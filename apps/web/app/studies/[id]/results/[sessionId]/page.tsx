import { TranscriptView } from "@/components/studies/transcript-view";
import { getMockTranscript } from "@/lib/mock/workspace";

export default async function TranscriptPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const transcript = getMockTranscript(sessionId);
  return <TranscriptView studyId={id} transcript={transcript} />;
}

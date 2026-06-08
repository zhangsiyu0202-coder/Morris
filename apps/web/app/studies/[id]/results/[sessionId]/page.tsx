import { TranscriptView } from "@/components/studies/transcript-view";
import { listBookmarksBySession } from "@/lib/queries/bookmarks";
import { getCurrentUserId } from "@/lib/queries/auth";
import { getStudy } from "@/lib/queries/studies";
import { loadStudyTranscript } from "@/lib/workspace-data";

export default async function TranscriptPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const ownerUserId = await getCurrentUserId();
  const transcript = await loadStudyTranscript(sessionId);
  const study = ownerUserId ? await getStudy(ownerUserId, id) : null;
  const bookmarks =
    ownerUserId && sessionId ? await listBookmarksBySession(ownerUserId, sessionId) : [];

  return (
    <TranscriptView
      studyId={id}
      studyTitle={study?.survey.title ?? "调研"}
      transcript={transcript}
      bookmarks={bookmarks}
    />
  );
}

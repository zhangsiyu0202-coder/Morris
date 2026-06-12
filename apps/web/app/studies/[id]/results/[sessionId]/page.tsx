import { notFound } from "next/navigation";
import { TranscriptView } from "@/components/studies/transcript-view";
import { listBookmarksBySession } from "@/lib/queries/bookmarks";
import { getCurrentUserId } from "@/lib/queries/auth";
import { getCurrentWorkspaceId } from "@/lib/auth/workspace";
import { getStudyForViewer } from "@/lib/queries/studies";
import { getSessionById } from "@/lib/survey/read";
import { loadStudyTranscript } from "@/lib/workspace/data";

export default async function TranscriptPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const viewerId = await getCurrentUserId();
  if (!viewerId) notFound();

  // Authorize once at the study level: the viewer must be the author or a
  // member of the study's workspace (ADR-0006 read=team). Downstream reads are
  // by session/survey id — gating here also closes direct by-session access.
  const workspaceId = await getCurrentWorkspaceId();
  const study = await getStudyForViewer(id, { userId: viewerId, workspaceId });
  if (!study) notFound();

  const session = await getSessionById(sessionId);
  if (!session || session.surveyId !== id) notFound();

  const transcript = await loadStudyTranscript(sessionId, study.ownerUserId);
  // Bookmarks belong to the study's workspace; a solo study (no workspace)
  // falls back to author-scoped bookmarks.
  const bookmarks = await listBookmarksBySession(
    { ownerUserId: viewerId, workspaceId: study.survey.workspaceId ?? null },
    sessionId,
  );

  return (
    <TranscriptView
      studyId={id}
      studyTitle={study.survey.title}
      transcript={transcript}
      bookmarks={bookmarks}
      currentUserId={viewerId}
    />
  );
}

import { notFound } from "next/navigation";
import { TranscriptView } from "@/components/studies/transcript-view";
import { listBookmarksBySession } from "@/lib/queries/bookmarks";
import { getCurrentUserId } from "@/lib/queries/auth";
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

  // Authorize at the study level via the session client: getStudyForViewer
  // returns the study only if Appwrite lets the caller read it (author or
  // workspace team — ADR-0006 B). Downstream reads are by session/survey id, so
  // this gate also closes direct by-session access.
  //
  // After auth, study / session / bookmarks are all keyed off ids the caller
  // owns. They're independent — run in parallel so the page's TTFB tracks the
  // slowest single read, not the sum. transcript stays sequential because it
  // needs study.ownerUserId to key the analysis-report lookup.
  const [study, session, bookmarks] = await Promise.all([
    getStudyForViewer(id),
    getSessionById(sessionId),
    listBookmarksBySession(sessionId),
  ]);
  if (!study) notFound();
  if (!session || session.surveyId !== id) notFound();

  const transcript = await loadStudyTranscript(sessionId, study.ownerUserId);

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

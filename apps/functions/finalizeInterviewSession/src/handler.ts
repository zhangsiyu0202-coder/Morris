import {
  FinalizeInterviewSessionRequestSchema,
  FinalizeInterviewSessionResponseSchema,
  isBillableInterview,
  usageEventId,
  type FinalizeInterviewSessionResponse,
  type TranscriptSegment,
} from "@merism/contracts";

export interface FinalizeInterviewSessionDeps {
  nowIso(): string;
  resolveSurveyTenancy(surveyId: string): Promise<{ ownerUserId: string | null; workspaceId: string | null }>;
  upsertTranscript(input: {
    sessionId: string;
    segments: TranscriptSegment[];
    language: string;
    finalizedAt: string;
    ownerUserId: string | null;
    workspaceId: string | null;
  }): Promise<void>;
  deleteTranscript(sessionId: string): Promise<void>;
  completeSession(input: {
    sessionId: string;
    state: "completed" | "abandoned";
    collectedAnswers: Record<string, unknown>;
    endedAt: string;
  }): Promise<void>;
  upsertRecording(input: {
    sessionId: string;
    ownerUserId: string;
    workspaceId: string | null;
    storageFileId: string;
    durationMs: number;
    format: "mp3" | "opus" | "wav" | "mp4" | "webm";
  }): Promise<void>;
  createUsageEvent(input: {
    eventId: string;
    workspaceId: string;
    studyId: string;
    sessionId: string;
    occurredAt: string;
  }): Promise<void>;
  triggerPostSessionAnalysis(sessionId: string, surveyId: string): Promise<void>;
}

export type FinalizeInterviewSessionResult =
  | { status: 200; body: FinalizeInterviewSessionResponse }
  | { status: 400 | 500; body: { error: string } };

export async function finalizeInterviewSession(
  rawInput: unknown,
  deps: FinalizeInterviewSessionDeps,
): Promise<FinalizeInterviewSessionResult> {
  const parsed = FinalizeInterviewSessionRequestSchema.safeParse(rawInput);
  if (!parsed.success) return { status: 400, body: { error: "invalid_input" } };

  const input = parsed.data;
  const finalizedAt = deps.nowIso();
  const { ownerUserId, workspaceId } = await deps.resolveSurveyTenancy(input.surveyId);

  try {
    await deps.upsertTranscript({
      sessionId: input.sessionId,
      segments: input.transcript.segments,
      language: input.transcript.language,
      finalizedAt,
      ownerUserId,
      workspaceId,
    });
  } catch {
    return { status: 500, body: { error: "internal_error" } };
  }

  try {
    await deps.completeSession({
      sessionId: input.sessionId,
      state: input.state,
      collectedAnswers: input.collectedAnswers,
      endedAt: finalizedAt,
    });
  } catch {
    // Transcript persistence happened first so analyzeSession can ground on it;
    // if the session row update fails, best-effort remove the transcript to keep
    // finalized artifacts from drifting apart.
    await deps.deleteTranscript(input.sessionId).catch(() => {});
    return { status: 500, body: { error: "internal_error" } };
  }

  if (input.recording) {
    try {
      await deps.upsertRecording({
        sessionId: input.sessionId,
        ownerUserId: input.recording.ownerUserId,
        workspaceId: input.recording.workspaceId ?? null,
        storageFileId: input.recording.storageFileId,
        durationMs: input.recording.durationMs,
        format: input.recording.format,
      });
    } catch {
      return { status: 500, body: { error: "internal_error" } };
    }
  }

  if (
    input.state === "completed" &&
    workspaceId &&
    isBillableInterview({
      state: input.state,
      durationMs: input.durationMs,
      answeredCount: input.answeredCount,
    })
  ) {
    await deps
      .createUsageEvent({
        eventId: usageEventId(input.sessionId),
        workspaceId,
        studyId: input.surveyId,
        sessionId: input.sessionId,
        occurredAt: finalizedAt,
      })
      .catch(() => {});
  }

  if (input.state === "completed") {
    await deps.triggerPostSessionAnalysis(input.sessionId, input.surveyId).catch(() => {});
  }

  const body = FinalizeInterviewSessionResponseSchema.parse({
    sessionId: input.sessionId,
    state: input.state,
  });
  return { status: 200, body };
}

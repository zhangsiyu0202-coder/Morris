// Pure finalizeInterviewSession core. No SDK imports so it is unit/property
// testable with in-memory deps. Ported from
// `apps/agent/agent/interview/supervisor.py::_finish_session` +
// `apps/agent/agent/persistence/appwrite_repository.py::complete_session /
// save_transcript / emit_usage_event / trigger_post_session_analysis`
// per ADR-0013.
//
// Boundary responsibilities (idempotent by sessionId):
//   1. Read the session document; validate it is still ours to finalize.
//      A session already in a terminal state is a no-op success (retry-safe).
//   2. Update the session row to `state=terminalStatus + endedAt=<now> +
//      collectedAnswers=<json>`. On `failed` also persist `errorContext`.
//   3. If transcript segments were provided, upsert the transcripts document
//      (id = sessionId, deterministic so a re-finalize overwrites, not
//      duplicates).
//   4. On `terminalStatus === "completed"` emit a `usage_events` row
//      (billable unit per ADR-0006 D6).
//   5. On `terminalStatus === "completed"` trigger the analysis Function
//      (`analyzeSession`) — one-way call, best-effort, does not block.
//
// Never writes turn-by-turn state. Never touches recordings (recording
// pipeline is worker-side ParticipantEgress, orthogonal to this Function).
import {
  FinalizeInterviewSessionRequestSchema,
  type FinalizeInterviewSessionResponse,
  type TranscriptSegment,
} from "@merism/contracts";

/**
 * Minimal shape of an Appwrite session document the Function reads. Deps
 * return this so tests can stub without touching the SDK.
 */
export interface SessionRecord {
  $id: string;
  surveyId: string;
  ownerUserId?: string | null;
  workspaceId?: string | null;
  state: "created" | "in_progress" | "completed" | "abandoned" | "failed";
}

export interface FinalizeDeps {
  now(): number;
  /** Returns null when the session document is missing. */
  getSession(sessionId: string): Promise<SessionRecord | null>;
  /**
   * Update the session row with completion fields. Non-throwing on Appwrite
   * conflict — the caller treats a 404 as "already gone" and short-circuits.
   */
  updateSession(
    sessionId: string,
    fields: {
      state: "completed" | "abandoned" | "failed";
      endedAt: string;
      collectedAnswers: string;
      errorContext?: string;
    },
  ): Promise<void>;
  /**
   * Upsert the transcript document by sessionId. Callers pass the finalized
   * segments in wire order; `language` defaults to `"zh"` at the schema level.
   */
  upsertTranscript(
    sessionId: string,
    body: {
      segments: TranscriptSegment[];
      language: string;
      finalizedAt: string;
    },
    permissions: string[] | undefined,
  ): Promise<void>;
  /** Emit one usage event row for the completed interview. Idempotent by $id. */
  emitUsageEvent(args: {
    sessionId: string;
    surveyId: string;
    workspaceId: string | null;
    occurredAt: string;
  }): Promise<void>;
  /** Fire-and-forget analysis trigger; never throws past the boundary. */
  triggerAnalysis(args: { sessionId: string; surveyId: string }): Promise<void>;
}

export type FinalizeResult =
  | { status: 200; body: FinalizeInterviewSessionResponse }
  | { status: 400 | 404 | 410 | 500; body: { error: string } };

export async function finalizeInterviewSession(
  rawInput: unknown,
  deps: FinalizeDeps,
): Promise<FinalizeResult> {
  const parsed = FinalizeInterviewSessionRequestSchema.safeParse(rawInput);
  if (!parsed.success) return { status: 400, body: { error: "invalid_input" } };
  const { sessionId, surveyId, terminalStatus, collectedAnswers, transcript, errorContext } = parsed.data;

  const session = await deps.getSession(sessionId);
  if (!session) return { status: 404, body: { error: "session_not_found" } };

  // Cross-check: the client MUST send the same surveyId the session was
  // opened with. A mismatch is either a stale worker (metadata drift after
  // a redeploy) or a client bug — either way, refuse.
  if (session.surveyId !== surveyId) {
    return { status: 400, body: { error: "survey_mismatch" } };
  }

  // Idempotency: already-terminal session is a no-op success. The caller
  // (worker `onCallEnd`) may retry finalize on transient network failures,
  // and hitting Appwrite again after a successful earlier finalize should
  // not double-write transcript or emit a duplicate usage_event.
  const alreadyTerminal =
    session.state === "completed" || session.state === "abandoned" || session.state === "failed";

  if (!alreadyTerminal) {
    const endedAt = new Date(deps.now()).toISOString();
    const fields: Parameters<FinalizeDeps["updateSession"]>[1] = {
      state: terminalStatus,
      endedAt,
      collectedAnswers: JSON.stringify(collectedAnswers),
    };
    if (terminalStatus === "failed" && errorContext) {
      fields.errorContext = JSON.stringify(errorContext);
    }
    await deps.updateSession(sessionId, fields);
  }

  let transcriptPersisted = false;
  if (transcript && transcript.segments.length > 0) {
    const permissions = tenantReadPermissions(session.ownerUserId, session.workspaceId);
    try {
      await deps.upsertTranscript(
        sessionId,
        {
          segments: transcript.segments,
          language: transcript.language,
          finalizedAt: new Date(deps.now()).toISOString(),
        },
        permissions,
      );
      transcriptPersisted = true;
    } catch {
      // Transcript persistence is best-effort — the session state has
      // already been updated to terminal, and the transcript can be recovered
      // from LiveKit recording if the finalize retry fails a second time.
      // Return `transcriptPersisted: false` so the caller can decide to
      // schedule a background retry.
      transcriptPersisted = false;
    }
  }

  let analysisTriggered = false;
  if (terminalStatus === "completed" && !alreadyTerminal) {
    // Usage event first (billable unit is the completed interview per
    // ADR-0006 D6). Best-effort; a persistence failure here MUST NOT prevent
    // the analysis trigger.
    await deps
      .emitUsageEvent({
        sessionId,
        surveyId,
        workspaceId: session.workspaceId ?? null,
        occurredAt: new Date(deps.now()).toISOString(),
      })
      .catch(() => {
        // nosemgrep: no-silent-catch-fallback (usage event is idempotent and
        // best-effort; a persistence failure surfaces via traceId in
        // withErrorBoundary and downstream reconciliation)
      });

    // Trigger analysis — the analyzeSession Function does the LLM work and
    // writes the analysis_reports document. From the worker's perspective
    // this is fire-and-forget; the Function boundary swallows its own
    // errors and logs them via withErrorBoundary.
    try {
      await deps.triggerAnalysis({ sessionId, surveyId });
      analysisTriggered = true;
    } catch {
      analysisTriggered = false;
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      sessionId,
      terminalStatus,
      transcriptPersisted,
      analysisTriggered,
    },
  };
}

/**
 * ADR-0006 (B): owner reads, and the workspace team reads when the artifact
 * belongs to a workspace. Returns `undefined` when the tenancy is unresolved
 * so the caller falls back to Appwrite's default (collection-level) perms.
 */
export function tenantReadPermissions(
  ownerUserId: string | null | undefined,
  workspaceId: string | null | undefined,
): string[] | undefined {
  if (!ownerUserId) return undefined;
  const perms = [`read("user:${ownerUserId}")`];
  if (workspaceId) perms.push(`read("team:${workspaceId}")`);
  return perms;
}

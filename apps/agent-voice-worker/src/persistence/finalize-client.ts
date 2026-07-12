import type { SessionLogger } from "../observability/session-logger.js";

/**
 * Client that invokes the `finalizeInterviewSession` Appwrite Function.
 * This is the ONLY path from the voice worker to Appwrite, per
 * `architecture.md` § Realtime ↔ persistence boundary. All finalized
 * artifacts (transcript, collectedAnswers, qualityFlags, recording) cross
 * through this Function; no direct SDK writes from the worker process.
 *
 * The Function itself is built following the `issueLivekitToken` shape:
 *   - `apps/functions/finalizeInterviewSession/src/handler.ts` (pure core)
 *   - `apps/functions/finalizeInterviewSession/src/main.ts` (SDK wrapper)
 *   - `apps/functions/finalizeInterviewSession/src/deps.ts` (typed effects)
 *
 * Wire-up lands in the same PR as this ADR (iteration 2 of the migration).
 * Until the Function ships, this stub logs and returns without throwing so
 * a session in this transitional state can still exit cleanly.
 */
export interface FinalizeInterviewSessionArgs {
  sessionId: string;
  surveyId: string;
  collectedAnswers: Record<string, Record<string, unknown>>;
  terminalStatus: "completed" | "abandoned" | "failed";
  log: SessionLogger;
}

export async function finalizeInterviewSession(args: FinalizeInterviewSessionArgs): Promise<void> {
  const endpoint = process.env.MERISM_FINALIZE_FUNCTION_URL;
  if (!endpoint) {
    args.log.warn("finalize endpoint not configured; skipping persistence", {
      terminalStatus: args.terminalStatus,
      answeredCount: Object.keys(args.collectedAnswers).length,
    });
    return;
  }

  const apiKey = process.env.MERISM_FINALIZE_FUNCTION_KEY;
  if (!apiKey) {
    args.log.error("finalize endpoint configured but MERISM_FINALIZE_FUNCTION_KEY missing", {
      terminalStatus: args.terminalStatus,
    });
    return;
  }

  const body = JSON.stringify({
    sessionId: args.sessionId,
    surveyId: args.surveyId,
    terminalStatus: args.terminalStatus,
    collectedAnswers: args.collectedAnswers,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-appwrite-key": apiKey,
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "<no body>");
    throw new Error(
      `finalizeInterviewSession returned ${response.status}: ${detail.slice(0, 500)}`,
    );
  }

  args.log.info("interview finalized via function", {
    terminalStatus: args.terminalStatus,
    answeredCount: Object.keys(args.collectedAnswers).length,
    status: response.status,
  });
}

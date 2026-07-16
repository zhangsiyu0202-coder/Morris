import { FinalizeInterviewSessionResponseSchema, type TranscriptSegment } from "@merism/contracts";
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
 * The worker invokes the Function through Appwrite's authenticated execution
 * API using the same server configuration it already needs for local runtime.
 * Do not add a second `MERISM_FINALIZE_*` configuration surface: it drifts
 * from the Function deployment and can silently skip terminal persistence.
 */
export interface FinalizeInterviewSessionArgs {
  sessionId: string;
  surveyId: string;
  collectedAnswers: Record<string, Record<string, unknown>>;
  transcript?: {
    language: string;
    segments: TranscriptSegment[];
  };
  terminalStatus: "completed" | "abandoned" | "failed";
  log: SessionLogger;
}

interface AppwriteExecution {
  status?: unknown;
  responseStatusCode?: unknown;
  responseBody?: unknown;
}

function requiredFinalizeConfig(): {
  endpoint: string;
  projectId: string;
  apiKey: string;
} {
  const missing = ["APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_API_KEY"].filter(
    (name) => !process.env[name],
  );
  if (missing.length > 0) {
    throw new Error(`finalize_not_configured:${missing.join(",")}`);
  }
  return {
    endpoint: process.env.APPWRITE_ENDPOINT!.replace(/\/$/, ""),
    projectId: process.env.APPWRITE_PROJECT_ID!,
    apiKey: process.env.APPWRITE_API_KEY!,
  };
}

export async function finalizeInterviewSession(args: FinalizeInterviewSessionArgs): Promise<void> {
  let config: ReturnType<typeof requiredFinalizeConfig>;
  try {
    config = requiredFinalizeConfig();
  } catch (error) {
    args.log.error("finalize configuration missing", {
      terminalStatus: args.terminalStatus,
      error: error instanceof Error ? error.message : "finalize_not_configured",
    });
    throw error;
  }

  const functionBody = JSON.stringify({
    sessionId: args.sessionId,
    surveyId: args.surveyId,
    terminalStatus: args.terminalStatus,
    collectedAnswers: args.collectedAnswers,
    transcript: args.transcript,
  });

  const response = await fetch(`${config.endpoint}/functions/finalizeInterviewSession/executions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Appwrite-Project": config.projectId,
      "X-Appwrite-Key": config.apiKey,
    },
    body: JSON.stringify({
      body: functionBody,
      async: false,
      path: "/",
      method: "POST",
    }),
  });

  if (!response.ok) {
    throw new Error(`finalizeInterviewSession execution API returned ${response.status}`);
  }

  const execution = (await response.json()) as AppwriteExecution;
  if (execution.status !== "completed" || typeof execution.responseStatusCode !== "number") {
    throw new Error("finalizeInterviewSession returned an invalid execution response");
  }
  if (execution.responseStatusCode >= 400 || typeof execution.responseBody !== "string") {
    throw new Error(`finalizeInterviewSession returned ${execution.responseStatusCode}`);
  }

  let responseBody: unknown;
  try {
    responseBody = JSON.parse(execution.responseBody);
  } catch {
    throw new Error("finalizeInterviewSession returned invalid JSON");
  }
  const parsed = FinalizeInterviewSessionResponseSchema.safeParse(responseBody);
  if (!parsed.success) {
    throw new Error("finalizeInterviewSession returned an invalid response body");
  }

  args.log.info("interview finalized via function", {
    terminalStatus: args.terminalStatus,
    answeredCount: Object.keys(args.collectedAnswers).length,
    transcriptSegmentCount: args.transcript?.segments.length ?? 0,
    transcriptPersisted: parsed.data.transcriptPersisted,
    status: execution.responseStatusCode,
  });
}

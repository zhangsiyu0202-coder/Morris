import { fileURLToPath } from "node:url";

import { inference } from "@livekit/agents";
import { createLiveKitWorker, runLiveKitWorker } from "@mastra/livekit/worker";

import type {
  InterviewRuntimeQuestion,
  InterviewRuntimeStudy,
} from "@merism/contracts";

import { mastra } from "./index.js";
import {
  buildMerismVoiceAgent,
  flowConfigFromMerismRoomMetadata,
  parseMerismRoomMetadata,
  type RoomMetadataParseResult,
} from "./merism-room-metadata.js";
import { buildVoiceWorkerSpeechProviders } from "./speech.js";
import { FlowEngineDriver } from "../interview/flow-driver.js";
import { registerSubmitAnswerRpc } from "../transport/submit-answer-rpc.js";
import { createSessionLogger } from "../observability/session-logger.js";
import { installDrainHandler, startHealthServer } from "../health.js";
import { finalizeInterviewSession } from "../persistence/finalize-client.js";

/**
 * Worker entrypoint. Post ADR-0013 iteration 5 (flow-engine cutover per
 * HANDOFF.md 2026-07-09) this is the ONLY production interview worker,
 * and it consumes the `flowConfig` shape exclusively. `issueLivekitToken`
 * always dispatches `merism-mastra-voice-worker` and always emits
 * `flowConfig` alongside the legacy `runtimeStudy` / `workflowConfig`
 * fields; the worker fail-closes if `flowConfig` is missing.
 *
 * Turn-detector: `v1-mini` is pinned explicitly. `inference.TurnDetector`
 * without an explicit `version` auto-selects the cloud-hosted `v1` model
 * whenever `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` are present in dev mode --
 * it does not distinguish self-hosted LiveKit server keys from LiveKit Cloud
 * keys. MerismV2 runs self-hosted only, so those env vars are always present
 * but never valid for LiveKit Inference; the result is a 401 → sticky
 * fallback to VAD-only interruption. Pin `v1-mini` to skip the cloud attempt
 * entirely.
 */

// Session-scoped drivers keyed by JobContext.job.id, so `onCallEnd`
// can pull the same driver instance `onSessionStart` created. Cleaned
// up in `onCallEnd`.
const driversByJobId = new Map<string, FlowEngineDriver>();

// Session-scoped loggers, same lifetime as drivers.
const loggersByJobId = new Map<string, ReturnType<typeof createSessionLogger>>();

/**
 * Build the `questionId → InterviewRuntimeQuestion` index the
 * `InterviewStatePublisher` uses to enrich `merism.interviewState`
 * payloads with the structured UI control. Pulls from `runtimeStudy`
 * which `issueLivekitToken` continues to emit alongside `flowConfig` per
 * `buildInterviewRoomMetadataFromDraft`.
 */
function indexRuntimeQuestions(
  study: InterviewRuntimeStudy | undefined,
): Map<string, InterviewRuntimeQuestion> {
  const map = new Map<string, InterviewRuntimeQuestion>();
  if (!study) return map;
  for (const section of study.sections) {
    for (const question of section.questions) {
      map.set(question.questionId, question);
    }
  }
  return map;
}

/**
 * Refuse a job with a logged reason. Called when metadata is malformed —
 * the Python worker would fall through to an idle "no-op" state, but
 * ADR-0013 § Migration completeness bar §7 requires fail-closed: log at
 * `error` and refuse the job rather than starting a generic assistant on an
 * unknown room.
 */
function refuseJob(
  reason: string,
  detail: string | undefined,
  ctx: { room?: { name?: string }; job?: { id?: string } },
): never {
  const log = createSessionLogger("agent.main", { sessionId: ctx.room?.name });
  log.error("agent job refused: metadata failed to parse", {
    reason,
    detail,
    room: ctx.room?.name ?? null,
    jobId: ctx.job?.id ?? null,
  });
  throw new Error(`agent-voice-worker: refusing job — ${reason}${detail ? ` (${detail})` : ""}`);
}

/**
 * Parse a metadata string, returning:
 *   - `null` when the input is empty (caller should try the fallback source)
 *   - `{ ok: true, metadata }` on success
 *   - `{ ok: false, reason }` on a concrete parse failure (invalid_json /
 *     schema_mismatch) — this is a hard fail, no fallback should be tried
 *     because the caller-provided metadata is malformed.
 */
function tryParse(raw: string): Exclude<RoomMetadataParseResult, { reason: "empty" }> | null {
  const result = parseMerismRoomMetadata(raw);
  if (result.ok) return result;
  if (result.reason === "empty") return null;
  return result;
}

/**
 * Resolve the room-metadata payload from a LiveKit job context, preferring
 * dispatch metadata (`ctx.job.metadata`) over room metadata (`ctx.room.metadata`).
 *
 * The preference is not stylistic — it is required by the mastra/livekit
 * lifecycle: in the `agent:` resolver, `ctx.room` is a stub with
 * `name === null` and `metadata === ""` (room state has not yet been synced
 * to the worker). Only `ctx.job.metadata` is populated at that point,
 * because it rides the dispatch RPC. The room-metadata fallback is kept for
 * legacy dispatchers that only set room metadata; new dispatchers
 * (including `issueLivekitToken`) MUST embed `flowConfig` + `runtimeStudy`
 * in the dispatch metadata payload.
 *
 * Callers should refuse the job on `!parseResult.ok` (via `refuseJob`).
 */
function resolveIncomingMetadata(ctx: {
  room?: { metadata?: string };
  job?: { metadata?: string };
}): RoomMetadataParseResult {
  const rawJobMetadata = ctx.job?.metadata ?? "";
  const rawRoomMetadata = ctx.room?.metadata ?? "";
  return tryParse(rawJobMetadata) ?? parseMerismRoomMetadata(rawRoomMetadata);
}

export default createLiveKitWorker({
  mastra,

  // Per-session Mastra agent — built from the flow config resolved from
  // dispatch metadata (with room metadata as fallback for legacy).
  // Fail-closed on any parse error OR missing flowConfig. See
  // `resolveIncomingMetadata` docstring for the timing rationale.
  agent: ({ ctx }) => {
    const parseResult = resolveIncomingMetadata(ctx);
    if (!parseResult.ok) {
      refuseJob(parseResult.reason, parseResult.detail, ctx);
    }
    const flowConfig = flowConfigFromMerismRoomMetadata(parseResult.metadata);
    if (!flowConfig) {
      refuseJob(
        "missing_flow_config",
        "room metadata has no flowConfig (post flow-engine cutover the legacy runtimeStudy/workflowConfig paths are not consumed)",
        ctx,
      );
    }
    return buildMerismVoiceAgent(flowConfig, parseResult.metadata.sessionId);
  },

  ...buildVoiceWorkerSpeechProviders(),
  turnDetection: new inference.TurnDetector({ version: "v1-mini" }),

  // NB: no static `greeting`. The Python worker did not have one — the flow
  // engine's `run_flow` publishes the first step and the Mastra agent asks
  // it. The TS worker does the same via `driver.begin()`.

  async onSessionStart({ ctx, session }) {
    const parseResult = resolveIncomingMetadata(ctx);
    if (!parseResult.ok) {
      // Already caught above in `agent:` resolver, but re-check for
      // narrowing; `refuseJob` throws.
      refuseJob(parseResult.reason, parseResult.detail, ctx);
    }
    const flowConfig = flowConfigFromMerismRoomMetadata(parseResult.metadata);
    if (!flowConfig) {
      refuseJob("missing_flow_config", "room metadata has no flowConfig", ctx);
    }

    const sessionId = parseResult.metadata.sessionId;
    const log = createSessionLogger("agent.session", {
      sessionId,
      surveyId: parseResult.metadata.surveyId,
    });
    loggersByJobId.set(ctx.job.id, log);

    log.info("agent session started", {
      room: ctx.room.name ?? null,
      jobId: ctx.job.id,
    });

    const driver = new FlowEngineDriver({
      // `ctx.room` in `@livekit/agents` is a `@livekit/rtc-node` Room, which
      // is what our transport modules type against.
      room: ctx.room as unknown as import("@livekit/rtc-node").Room,
      log,
      agent: buildMerismVoiceAgent(flowConfig, sessionId),
      config: flowConfig,
      runtimeQuestions: indexRuntimeQuestions(parseResult.metadata.runtimeStudy),
    });
    driversByJobId.set(ctx.job.id, driver);

    // Register `merism.submit_answer` RPC handler BEFORE begin() so a
    // fast-clicking interviewee can never race the handler registration.
    registerSubmitAnswerRpc({
      room: ctx.room as unknown as import("@livekit/rtc-node").Room,
      log,
      getCurrentQuestionId: () => driver.currentQuestionId,
      hasActiveTask: () => driver.hasActiveTask,
      onAcceptedAnswer: (answer) => driver.handleUiSubmission(answer),
    });

    // Publish `merism.interviewState` for the first step and fire the
    // flow engine's main loop.
    await driver.begin();

    session; // suppress unused-var lint until the tool-loop lands
  },

  async onCallEnd({ ctx, roomName, memory }) {
    const driver = driversByJobId.get(ctx.job.id);
    const log = loggersByJobId.get(ctx.job.id) ?? createSessionLogger("agent.session");
    driversByJobId.delete(ctx.job.id);
    loggersByJobId.delete(ctx.job.id);

    if (!driver) {
      log.warn("call ended but no driver present", { roomName, jobId: ctx.job.id });
      return;
    }

    const snapshot = driver.snapshot;
    const terminalStatus = snapshot.isComplete ? "completed" : "abandoned";
    await driver.shutdown(terminalStatus);

    log.info("agent session ended", {
      terminalStatus,
      answeredCount: Object.keys(snapshot.collectedAnswers).length,
    });

    // One-way append-only persistence per architecture.md § Realtime ↔
    // persistence boundary. The Function boundary is the only path from the
    // worker to Appwrite.
    try {
      await finalizeInterviewSession({
        sessionId: snapshot.sessionId,
        surveyId: snapshot.surveyId,
        collectedAnswers: snapshot.collectedAnswers,
        terminalStatus,
        log,
      });
    } catch (error) {
      log.error("finalize failed after session end", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Mastra's memory hook: nothing to persist beyond the LiveKit transcript
    // for now (transcript segments are streamed live). Left for parity with
    // future memory-persisting agents.
    void memory;
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Health + drain: install BEFORE runLiveKitWorker so /_livez answers as
  // soon as the process is up, even if the LiveKit worker's own boot fails.
  startHealthServer();
  installDrainHandler();

  runLiveKitWorker({
    entry: import.meta.url,
    agentName: "merism-mastra-voice-worker",
  });
}

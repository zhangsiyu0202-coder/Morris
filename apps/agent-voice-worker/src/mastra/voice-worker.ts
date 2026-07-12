import { fileURLToPath } from "node:url";

import { inference } from "@livekit/agents";
import { createLiveKitWorker, runLiveKitWorker } from "@mastra/livekit/worker";

import { mastra } from "./index.js";
import {
  buildMerismVoiceAgent,
  parseMerismRoomMetadata,
  workflowConfigFromMerismRoomMetadata,
  type RoomMetadataParseResult,
} from "./merism-room-metadata.js";
import { buildVoiceWorkerSpeechProviders } from "./speech.js";
import { InterviewOrchestrator, indexRuntimeQuestions } from "../interview/orchestrator.js";
import { registerSubmitAnswerRpc } from "../transport/submit-answer-rpc.js";
import { createSessionLogger } from "../observability/session-logger.js";
import { installDrainHandler, startHealthServer } from "../health.js";
import { finalizeInterviewSession } from "../persistence/finalize-client.js";

/**
 * Worker entrypoint. Post ADR-0013 this is the ONLY production interview
 * worker. `issueLivekitToken` dispatches `merism-mastra-voice-worker` on
 * every token issuance; the Python worker (`apps/agent/`) has been deleted.
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

// Session-scoped orchestrators keyed by JobContext.job.id, so `onCallEnd`
// can pull the same orchestrator instance `onSessionStart` created. Cleaned
// up in `onCallEnd`.
const orchestratorsByJobId = new Map<string, InterviewOrchestrator>();

// Session-scoped loggers, same lifetime as orchestrators.
const loggersByJobId = new Map<string, ReturnType<typeof createSessionLogger>>();

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

export default createLiveKitWorker({
  mastra,

  // Per-session Mastra agent — built from the workflow config resolved from
  // room metadata. Fail-closed on any parse error.
  agent: ({ ctx }) => {
    const parseResult: RoomMetadataParseResult = parseMerismRoomMetadata(ctx.room.metadata);
    if (!parseResult.ok) {
      refuseJob(parseResult.reason, parseResult.detail, ctx);
    }
    const workflowConfig = workflowConfigFromMerismRoomMetadata(parseResult.metadata);
    if (!workflowConfig) {
      refuseJob(
        "missing_workflow_config",
        "room metadata has neither workflowConfig nor runtimeStudy",
        ctx,
      );
    }
    return buildMerismVoiceAgent(workflowConfig, parseResult.metadata.sessionId);
  },

  ...buildVoiceWorkerSpeechProviders(),
  turnDetection: new inference.TurnDetector({ version: "v1-mini" }),

  // NB: no static `greeting`. The Python worker did not have one — its
  // Supervisor's first action was to publish the first question and let the
  // LLM ask it. The Mastra worker does the same via
  // `orchestrator.begin()` inside `onSessionStart`.

  async onSessionStart({ ctx, session }) {
    const parseResult = parseMerismRoomMetadata(ctx.room.metadata);
    if (!parseResult.ok) {
      // Already caught above in `agent:` resolver, but re-check for
      // narrowing; `refuseJob` throws.
      refuseJob(parseResult.reason, parseResult.detail, ctx);
    }
    const workflowConfig = workflowConfigFromMerismRoomMetadata(parseResult.metadata);
    if (!workflowConfig) {
      refuseJob(
        "missing_workflow_config",
        "room metadata has neither workflowConfig nor runtimeStudy",
        ctx,
      );
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

    const orchestrator = new InterviewOrchestrator({
      // `ctx.room` in `@livekit/agents` is a `@livekit/rtc-node` Room, which
      // is what our transport modules type against.
      room: ctx.room as unknown as import("@livekit/rtc-node").Room,
      log,
      workflowConfig,
      runtimeQuestions: indexRuntimeQuestions(parseResult.metadata.runtimeStudy),
    });
    orchestratorsByJobId.set(ctx.job.id, orchestrator);

    // Register `merism.submit_answer` RPC handler BEFORE begin() so a
    // fast-clicking interviewee can never race the handler registration.
    registerSubmitAnswerRpc({
      room: ctx.room as unknown as import("@livekit/rtc-node").Room,
      log,
      getCurrentQuestionId: () => orchestrator.currentQuestionId,
      hasActiveTask: () => orchestrator.hasActiveTask,
      onAcceptedAnswer: (answer) => orchestrator.handleUiSubmission(answer),
    });

    // Publish `merism.interviewState` for the first question so the UI
    // renders its structured control immediately. The LLM starts speaking
    // on the first turn LiveKit's turn detector allows.
    await orchestrator.begin();

    // TODO(agent-voice-worker/interview-tool-loop): register the
    // `complete_question` + `record_probe_round` tools on the Mastra Agent
    // built above so the voice path can complete questions from the model
    // side. Iteration 2 wave; the UI-click path already lands answers via
    // the RPC handler above.
    session; // suppress unused-var lint until the tool-loop lands
  },

  async onCallEnd({ ctx, roomName, memory }) {
    const orchestrator = orchestratorsByJobId.get(ctx.job.id);
    const log = loggersByJobId.get(ctx.job.id) ?? createSessionLogger("agent.session");
    orchestratorsByJobId.delete(ctx.job.id);
    loggersByJobId.delete(ctx.job.id);

    if (!orchestrator) {
      log.warn("call ended but no orchestrator present", { roomName, jobId: ctx.job.id });
      return;
    }

    const snapshot = orchestrator.snapshot;
    const terminalStatus = snapshot.isComplete ? "completed" : "abandoned";
    await orchestrator.shutdown(terminalStatus);

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

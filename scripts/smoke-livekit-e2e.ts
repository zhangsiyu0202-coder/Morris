/**
 * LiveKit e2e smoke — real LiveKit + real worker + real composer + simulated
 * interviewee.
 *
 * This variant exercises the production `SurveyDraft` → composer →
 * `InterviewRoomMetadata` → worker → flow-engine chain end-to-end:
 *
 *   T1. Composer offline assertion:
 *       buildInterviewRoomMetadataFromDraft on a SurveyDraft with
 *       branchRules produces a `flowConfig` whose `steps` include a
 *       ConditionStep. Prior to fix 34ff5aa the mapper dropped
 *       branchRules; the composer would still be given [] and produce a
 *       purely linear flow.
 *   T2. Room + dispatch: LiveKit accepts the composed metadata,
 *       dispatches to worker.
 *   T3. onSessionStart wires driver + publisher: agent joins room and
 *       publishes merism.interviewState via participant attributes.
 *   T4. merism.submit_answer RPC for the first question. flow-engine's
 *       ConditionStep is executed transparently (LLM eval, no publish);
 *       either edge lands on the same target here so the smoke is
 *       deterministic regardless of the LLM verdict.
 *   T5. Continuation: after T4 the client reads the new currentQuestionId
 *       from the attribute and submits again, driving the flow to
 *       completion.
 *   T5b. TTS audio track: worker's agent publishes an audio track (Qwen
 *        TTS pipeline reaches the point of publishing) — we don't play
 *        the audio, just observe the track subscribed event. Currently
 *        expected to be 0 because the voice-completion tool loop is
 *        not implemented yet; this observation is informational, not a
 *        failure condition.
 *
 * Not covered here (harder infra, no interview-user-input mechanism yet):
 *   T6. ASR: needs to publish real audio bytes from interviewee to
 *       worker.
 *   T7. finalize Function e2e (finalize Function is TS but hosted in
 *       OpenRuntimes; the worker calls it via HTTP, verifying that route
 *       requires the Function to be deployed which is a separate
 *       concern).
 *
 * Assumes:
 *   - LiveKit up on ws://localhost:7880 (from `pnpm stack:up`)
 *   - Worker background-running via HEALTH_PORT=9091 pnpm dev:worker
 *   - .env sourced (LIVEKIT_URL/KEY/SECRET + DASHSCOPE_API_KEY)
 *
 * Run:
 *   set -a && source .env && set +a
 *   pnpm tsx scripts/smoke-livekit-e2e.ts
 */

import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
} from "livekit-server-sdk";
import {
  Room,
  RoomEvent,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TextStreamReader,
} from "@livekit/rtc-node";
import {
  buildInterviewRoomMetadataFromDraft,
  type SurveyDraft,
} from "@merism/contracts";

// ---------------------------------------------------------------------------
// Env + config
// ---------------------------------------------------------------------------

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const LIVEKIT_WS_URL = must("LIVEKIT_URL");
const LIVEKIT_HTTP_URL = LIVEKIT_WS_URL.replace(/^ws/, "http");
const API_KEY = must("LIVEKIT_API_KEY");
const API_SECRET = must("LIVEKIT_API_SECRET");
const AGENT_NAME = process.env.MERISM_TS_VOICE_AGENT_NAME ?? "merism-mastra-voice-worker";

const stamp = Date.now();
const roomName = `smoke-e2e-${stamp}`;
const sessionId = `sess-${stamp}`;
const surveyId = `surv-${stamp}`;

// ---------------------------------------------------------------------------
// SurveyDraft — same shape the guide editor produces. Two questions plus a
// branchRule so the composer emits a ConditionStep. `jumpToQuestionId` and
// the default outgoingEdge both land on the same target (q2), which makes
// the runtime behavior deterministic regardless of the LLM's yes/no verdict
// on the condition. The smoke is proving structural chain integrity, not
// LLM condition-eval correctness (which the runFlow real-LLM smoke covers).
// ---------------------------------------------------------------------------

const draft: SurveyDraft = {
  title: "e2e smoke study",
  researchGoal: "verify SurveyDraft → composer → worker → flow-engine chain integrity",
  targetAudience: "internal dev, LiveKit e2e harness",
  introScript: "This is an automated smoke run — you can respond with any short answer.",
  moderatorInstruction:
    "You are a warm, professional interviewer running a smoke test. Keep responses brief.",
  sections: [
    {
      title: "Only Section",
      objective: "verify structural chain works with a two-question graph containing a ConditionStep",
      questions: [
        {
          stableId: "q1",
          questionText: "smoke: 请描述一下你现在的工作日常。",
          questionType: "open_ended",
          probeLevel: "standard",
          probeInstruction: "",
          options: [],
          allowSkip: false,
          branchRules: [
            {
              // The condition text is deliberately generic — the smoke does
              // not depend on whether the LLM answers yes or no because
              // both edges (branch + default) go to q2.
              condition: "The respondent mentions working in software engineering.",
              jumpToQuestionId: "q2",
            },
          ],
        },
        {
          stableId: "q2",
          questionText: "smoke: 你最常用的工具是什么?",
          questionType: "open_ended",
          probeLevel: "standard",
          probeInstruction: "",
          options: [],
          allowSkip: false,
          branchRules: [],
        },
      ],
    },
  ],
};

const roomMetadata = buildInterviewRoomMetadataFromDraft({
  surveyId,
  sessionId,
  draft,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(section: string, msg: string, extras?: Record<string, unknown>) {
  const tag = `[${new Date().toISOString().substring(11, 19)}] ${section}`;
  const line = extras ? `${tag}  ${msg}  ${JSON.stringify(extras)}` : `${tag}  ${msg}`;
  console.log(line);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor<T>(check: () => T | undefined, label: string, timeoutMs = 20000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = check();
    if (v !== undefined) return v;
    await sleep(200);
  }
  throw new Error(`waitFor timeout: ${label}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log("=".repeat(72));
  console.log(`LiveKit e2e smoke  |  room=${roomName}  |  session=${sessionId}`);
  console.log(`ws=${LIVEKIT_WS_URL}  http=${LIVEKIT_HTTP_URL}  agent=${AGENT_NAME}`);
  console.log("=".repeat(72));

  // ------------------------------------------------------------ Phase T1 --
  // Composer offline assertion. If this fails, the SurveyDraft is missing
  // stableId or branchRules — regressed the fix in 34ff5aa.
  log("T1", "Asserting composer output has ConditionStep …");
  const flowConfig = roomMetadata.flowConfig;
  if (!flowConfig) {
    throw new Error("Composer produced no flowConfig — buildInterviewRoomMetadataFromDraft regression");
  }
  const conditionSteps = flowConfig.steps.filter((s) => s.kind === "condition");
  if (conditionSteps.length === 0) {
    throw new Error(
      `Composer produced flow with 0 ConditionSteps despite draft having branchRules. Steps: ${JSON.stringify(flowConfig.steps.map((s) => ({ id: s.stepId, kind: s.kind })))}`,
    );
  }
  log("T1", `Composer chain OK ✅`, {
    stepCount: flowConfig.steps.length,
    stepKinds: flowConfig.steps.map((s) => s.kind),
    conditionStepIds: conditionSteps.map((s) => s.stepId),
  });

  // ------------------------------------------------------------ Phase T2 --
  const roomSvc = new RoomServiceClient(LIVEKIT_HTTP_URL, API_KEY, API_SECRET);
  const dispatchSvc = new AgentDispatchClient(LIVEKIT_HTTP_URL, API_KEY, API_SECRET);
  const metadataJson = JSON.stringify(roomMetadata);

  log("T2", "Creating room with composed metadata …", { metadataBytes: metadataJson.length });
  await roomSvc.createRoom({ name: roomName, metadata: metadataJson });
  log("T2", "Room created ✅");

  log("T2", "Dispatching worker to room …");
  // Push the same composed payload into dispatch metadata. In the
  // mastra/livekit worker lifecycle, `ctx.job.metadata` (from dispatch) is
  // available at `agent:` resolve time, while `ctx.room.metadata` is not
  // yet synced. The worker prefers dispatch metadata for that reason
  // (see docs/adr/0014-declarative-flow-engine.md § Room-metadata
  // precedence).
  const dispatch = await dispatchSvc.createDispatch(roomName, AGENT_NAME, {
    metadata: metadataJson,
  });
  log("T2", "Dispatch created ✅", { dispatchId: dispatch.id });

  // ------------------------------------------------------------ Phase T3 --
  log("T3", "Signing interviewee token + connecting …");
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: "interviewee-smoke",
    ttl: 60 * 10,
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  const token = await at.toJwt();

  const room = new Room();

  interface Event {
    at: number;
    type: string;
    details: Record<string, unknown>;
  }
  const events: Event[] = [];
  const record = (type: string, details: Record<string, unknown>) =>
    events.push({ at: Date.now(), type, details });

  room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
    record("participant_connected", { identity: p.identity, kind: p.kind });
    log("T3", `Participant connected: ${p.identity} (kind=${p.kind})`);
  });
  room.on(
    RoomEvent.ParticipantAttributesChanged,
    (changed: Record<string, string>, p: RemoteParticipant) => {
      record("attrs_changed", { identity: p.identity, changed });
      log("T3", `attrs changed from ${p.identity}`, { keys: Object.keys(changed) });
    },
  );
  room.on(
    RoomEvent.TrackSubscribed,
    (_track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      record("track_subscribed", {
        identity: participant.identity,
        kind: publication.kind,
        sid: publication.sid,
      });
      log("T5b", `Track subscribed from ${participant.identity}`, { kind: publication.kind });
    },
  );
  room.on(RoomEvent.TextStreamReceived, (reader: TextStreamReader) => {
    record("text_stream", { topic: reader.info?.topic });
  });

  await room.connect(LIVEKIT_WS_URL, token, { autoSubscribe: true });
  log("T3", `Interviewee connected as ${room.localParticipant?.identity}`);

  log("T3", "Waiting for agent to join …");
  const agentP = await waitFor(
    () => {
      return [...room.remoteParticipants.values()].find(
        (p) => p.kind === 4 /* AGENT */ || p.identity.toLowerCase().includes("agent"),
      );
    },
    "agent participant",
    20000,
  );
  log("T3", `Agent joined: ${agentP.identity} ✅`);

  // Helper: read current merism.interviewState from the agent's attributes.
  // Returns { status, currentQuestionId, currentSectionId } or undefined.
  interface InterviewState {
    status: string;
    currentQuestionId?: string;
    currentSectionId?: string;
    updatedAt?: string;
  }
  function readState(): InterviewState | undefined {
    const raw = agentP.attributes?.["merism.interviewState"];
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as InterviewState;
    } catch {
      return undefined;
    }
  }

  // Wait for the first `collecting` publish (askQuestion sets pending
  // then publishes — this is the earliest an RPC will be accepted).
  log("T3", "Waiting for merism.interviewState status=collecting …");
  const firstState = await waitFor(
    () => {
      const s = readState();
      return s?.status === "collecting" ? s : undefined;
    },
    "status=collecting for first question",
    15000,
  );
  log("T3", `Interview state received ✅`, firstState);

  // ------------------------------------------------------------ Phase T4/5-
  // Interview loop: while status is "collecting", submit an answer for the
  // current question. When status flips to "completed" we exit. This works
  // for any flow-engine graph (linear, branched, probed) because we react
  // to the worker's authoritative cursor.
  interface RpcResponse {
    ok: boolean;
    accepted: boolean;
    nextQuestionId?: string;
    completed?: boolean;
  }

  const submissions: Array<{
    questionId: string;
    accepted: boolean;
    nextQuestionId?: string;
    completed?: boolean;
  }> = [];

  let currentQuestionId = firstState.currentQuestionId;
  const answersByQuestion: Record<string, string> = {
    q1: "smoke e2e: 我在一家互联网公司做软件工程师,每天早上开站会、下午写代码、晚上跑测试。",
    q2: "smoke e2e: 我最常用的工具是 VS Code + git,配合 zsh 和 tmux。",
  };
  const MAX_TURNS = 5;

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    if (!currentQuestionId) {
      throw new Error(`Turn ${turn}: no currentQuestionId in state (state=${JSON.stringify(readState())})`);
    }
    const answerText = answersByQuestion[currentQuestionId] ?? `smoke e2e fallback answer for ${currentQuestionId}`;

    log("T4", `Turn ${turn}: submitting answer for ${currentQuestionId}`);
    const rpcPayload = {
      answer: {
        questionId: currentQuestionId,
        // sectionId is required by the schema; the composer emits one
        // section (`sec-1` by convention). The worker doesn't strictly
        // require it to match — first-writer-wins keys on questionId —
        // but supply a value that satisfies the schema.
        sectionId: "sec-1",
        questionType: "open_ended",
        source: "ui",
        text: answerText,
        selectedOptions: [],
        ranking: [],
      },
    };
    const rpcRaw = await room.localParticipant!.performRpc({
      destinationIdentity: agentP.identity,
      method: "merism.submit_answer",
      payload: JSON.stringify(rpcPayload),
    });
    const rpcResp = JSON.parse(rpcRaw) as RpcResponse;
    log("T4", `Turn ${turn}: RPC response`, rpcResp);
    submissions.push({
      questionId: currentQuestionId,
      accepted: rpcResp.accepted,
      nextQuestionId: rpcResp.nextQuestionId,
      completed: rpcResp.completed,
    });
    if (!rpcResp.ok || !rpcResp.accepted) {
      throw new Error(`Turn ${turn}: RPC not accepted: ${JSON.stringify(rpcResp)}`);
    }

    // After a submit that advanced the flow, the worker either:
    //   (a) transitions to the next question → publishes status=collecting
    //       with a new currentQuestionId, OR
    //   (b) reaches end of flow → publishes status=completed.
    // Wait for one of the two.
    const submittedId = currentQuestionId;
    const nextState = await waitFor(
      () => {
        const s = readState();
        if (!s) return undefined;
        if (s.status === "completed") return s;
        if (s.status === "collecting" && s.currentQuestionId && s.currentQuestionId !== submittedId) {
          return s;
        }
        return undefined;
      },
      `next state after submitting ${submittedId}`,
      20000,
    );
    log("T5", `Turn ${turn}: next state`, nextState);

    if (nextState.status === "completed") {
      log("T5", `Flow completed after ${turn} submission(s) ✅`);
      break;
    }
    currentQuestionId = nextState.currentQuestionId;
    if (turn === MAX_TURNS) {
      throw new Error(`Reached MAX_TURNS=${MAX_TURNS} without status=completed`);
    }
  }

  const finalState = await waitFor(
    () => {
      const s = readState();
      return s?.status === "completed" ? s : undefined;
    },
    "final status=completed",
    5000,
  );

  // Wait a beat, then observe track presence (agent-side TTS/output).
  await sleep(500);
  const audioTracks = events.filter(
    (e) =>
      e.type === "track_subscribed" &&
      (e.details.kind === 0 /* audio */ || e.details.kind === "audio"),
  );
  log("T5b", `agent audio tracks observed: ${audioTracks.length}`, {
    tracks: audioTracks.map((e) => e.details),
  });

  // ------------------------------------------------------------ Cleanup ---
  log("cleanup", "Disconnecting interviewee …");
  await room.disconnect();
  await sleep(1000);

  log("cleanup", "Deleting room (forces onCallEnd on worker) …");
  await roomSvc.deleteRoom(roomName);

  // Summary
  console.log("");
  console.log("=".repeat(72));
  console.log("SUMMARY");
  console.log("=".repeat(72));
  console.log(`T1 composer offline check:  ✅  ${conditionSteps.length} ConditionStep(s) in composed flow`);
  console.log(`T2 dispatch:                ✅  dispatchId=${dispatch.id}`);
  console.log(`T3 first attribute publish: ✅  status=collecting q=${firstState.currentQuestionId}`);
  console.log(`T4 submit_answer RPC turns: ${submissions.length}`);
  for (const s of submissions) {
    console.log(`   - ${s.questionId} accepted=${s.accepted} next=${s.nextQuestionId ?? "-"} completed=${s.completed}`);
  }
  console.log(`T5 flow completed publish:  ✅  final status=${finalState.status}`);
  const audioLabel = audioTracks.length > 0 ? "✅" : "⚠️  0 (TTS may not have spoken; agent still valid)";
  console.log(`T5b audio tracks observed:   ${audioLabel}  count=${audioTracks.length}`);
  console.log("=".repeat(72));
})().catch((err) => {
  console.error("SMOKE FAILED:");
  console.error(err);
  process.exit(1);
});

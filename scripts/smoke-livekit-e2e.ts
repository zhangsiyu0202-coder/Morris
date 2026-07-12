/**
 * LiveKit e2e smoke — real LiveKit + real worker + simulated interviewee.
 *
 * Verifies HANDOFF § P5b runtime harness that the runFlow LLM smoke can't
 * cover:
 *   T2. Room + dispatch: LiveKit accepts metadata, dispatches to worker
 *   T3. onSessionStart wires driver + publisher: agent joins room and
 *       publishes merism.interviewState via participant attributes
 *   T4. merism.submit_answer RPC: worker registers it, interviewee can
 *       call it, driver.handleUiSubmission runs, flow advances
 *   T5. TTS audio track: worker's agent publishes an audio track (Qwen TTS
 *       pipeline reaches the point of publishing) — we don't play the audio,
 *       just observe the track subscribed event.
 *
 * Not covered here (harder infra):
 *   T6. ASR: needs to publish real audio bytes from interviewee to worker
 *   T7. finalize Function e2e (finalize Function is TS but hosted in
 *       OpenRuntimes; the worker calls it via HTTP, verifying that route
 *       requires the Function to be deployed which is a separate concern)
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
// flowConfig + runtimeStudy for a minimal 1-step flow
// ---------------------------------------------------------------------------

const flowConfig = {
  surveyId,
  sessionId,
  moderatorInstruction:
    "你是一个亲切、专业的访谈员,面向早期用户做半结构化访谈。语气温和,不做评判。",
  startStepId: "q1",
  steps: [
    {
      stepId: "q1",
      kind: "question",
      questionType: "open_ended",
      content: "smoke test:请描述一下你现在的工作日常。",
      options: [],
      outgoingEdgeId: null,
    },
  ],
  edges: [],
};

const runtimeStudy = {
  surveyId,
  studyTitle: "e2e smoke",
  researchGoal: "verify livekit pipeline",
  targetAudience: "internal dev",
  introScript: "smoke intro placeholder",
  sections: [
    {
      sectionId: "s1",
      title: "Only Section",
      objective: "smoke section objective",
      questions: [
        {
          questionId: "q1",
          sectionId: "s1",
          sectionTitle: "Only Section",
          orderInSection: 0,
          questionText: "smoke test:请描述一下你现在的工作日常。",
          questionType: "open_ended",
          probeLevel: "standard",
          probeInstruction: "",
          options: [],
          responseMode: "voice_only",
        },
      ],
    },
  ],
};

const roomMetadata = {
  sessionId,
  surveyId,
  runtimeStudy,
  flowConfig,
};

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

async function waitFor<T>(check: () => T | undefined, label: string, timeoutMs = 15000): Promise<T> {
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

  const roomSvc = new RoomServiceClient(LIVEKIT_HTTP_URL, API_KEY, API_SECRET);
  const dispatchSvc = new AgentDispatchClient(LIVEKIT_HTTP_URL, API_KEY, API_SECRET);

  // ------------------------------------------------------------ Phase T2 --
  log("T2", "Creating room with flowConfig metadata …");
  await roomSvc.createRoom({
    name: roomName,
    metadata: JSON.stringify(roomMetadata),
  });
  log("T2", "Room created ✅");

  log("T2", "Dispatching worker to room …");
  // Push the full room-metadata payload (flowConfig + runtimeStudy) into
  // dispatch metadata as well as into the room's metadata field. In the
  // mastra/livekit worker lifecycle, `ctx.job.metadata` (from dispatch) is
  // available at `agent:` resolve time, while `ctx.room.metadata` is not
  // yet synced. The worker prefers dispatch metadata for that reason.
  const dispatch = await dispatchSvc.createDispatch(roomName, AGENT_NAME, {
    metadata: JSON.stringify(roomMetadata),
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

  interface Event { at: number; type: string; details: Record<string, unknown> }
  const events: Event[] = [];
  const record = (type: string, details: Record<string, unknown>) =>
    events.push({ at: Date.now(), type, details });

  room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
    record("participant_connected", { identity: p.identity, kind: p.kind });
    log("T3", `Participant connected: ${p.identity} (kind=${p.kind})`);
  });
  room.on(RoomEvent.ParticipantAttributesChanged, (changed: Record<string, string>, p: RemoteParticipant) => {
    record("attrs_changed", { identity: p.identity, changed });
    log("T3", `attrs changed from ${p.identity}`, { keys: Object.keys(changed) });
  });
  room.on(RoomEvent.TrackSubscribed, (_track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
    record("track_subscribed", { identity: participant.identity, kind: publication.kind, sid: publication.sid });
    log("T5", `Track subscribed from ${participant.identity}`, { kind: publication.kind });
  });
  room.on(RoomEvent.TextStreamReceived, (reader: TextStreamReader) => {
    record("text_stream", { topic: reader.info?.topic });
  });

  await room.connect(LIVEKIT_WS_URL, token, { autoSubscribe: true });
  log("T3", `Interviewee connected as ${room.localParticipant?.identity}`);

  // Wait for the agent (a remote participant with kind=agent) to appear.
  log("T3", "Waiting for agent to join …");
  const agentP = await waitFor(() => {
    return [...room.remoteParticipants.values()].find(
      (p) => (p.kind === 4 /* AGENT */ || p.identity.toLowerCase().includes("agent")),
    );
  }, "agent participant", 20000);
  log("T3", `Agent joined: ${agentP.identity} ✅`);

  // Wait for merism.interviewState attribute with status=collecting (the
  // publisher publishes "ready" from driver.begin(), then "collecting" from
  // host.askQuestion() which is where the pending-answer slot is armed —
  // only after collecting is the RPC guaranteed to be accepted).
  log("T3", "Waiting for merism.interviewState status=collecting …");
  let lastSeenAttrRaw = "";
  const parsedState = await waitFor(
    () => {
      const attrs = agentP.attributes ?? {};
      const raw = attrs["merism.interviewState"] ?? "";
      if (raw !== lastSeenAttrRaw) {
        log("T3", `attribute snapshot`, {
          all_keys: Object.keys(attrs),
          merism_len: raw.length,
          merism_head: raw.substring(0, 120),
        });
        lastSeenAttrRaw = raw;
      }
      if (!raw) return undefined;
      const s = JSON.parse(raw);
      return s.status === "collecting" ? s : undefined;
    },
    "merism.interviewState status=collecting",
    15000,
  );
  log("T3", `merism.interviewState received ✅`, parsedState);

  // ------------------------------------------------------------ Phase T4 --
  log("T4", "Calling merism.submit_answer RPC …");
  const rpcPayload = {
    answer: {
      questionId: "q1",
      sectionId: "s1",
      questionType: "open_ended",
      source: "ui",
      text: "smoke e2e: 我目前的工作日常是每天早上开会、下午写代码、晚上跑测试。",
      selectedOptions: [],
      ranking: [],
    },
  };
  const rpcRaw = await room.localParticipant!.performRpc({
    destinationIdentity: agentP.identity,
    method: "merism.submit_answer",
    payload: JSON.stringify(rpcPayload),
  });
  const rpcResp = JSON.parse(rpcRaw);
  log("T4", `RPC response received`, rpcResp);
  if (!rpcResp.ok || !rpcResp.accepted) {
    throw new Error(`RPC not accepted: ${JSON.stringify(rpcResp)}`);
  }
  log("T4", `submit_answer accepted=true ✅`);

  // ------------------------------------------------------------ Phase T5 --
  // After submit, driver advances; runFlow reaches end-of-graph (no next
  // step), onFlowCompleted fires, publisher publishes status=completed.
  log("T5", "Waiting for status=completed publish …");
  const completedAttr = await waitFor(() => {
    const a = agentP.attributes?.["merism.interviewState"];
    if (!a) return undefined;
    const parsed = JSON.parse(a);
    return parsed.status === "completed" ? parsed : undefined;
  }, "status=completed", 15000);
  log("T5", `flow completed ✅`, completedAttr);

  // Wait a beat, then observe track presence (agent-side TTS/output).
  await sleep(500);
  const audioTracks = events.filter((e) => e.type === "track_subscribed" && (e.details.kind === 0 /* audio */ || e.details.kind === "audio"));
  log("T5", `agent audio tracks observed: ${audioTracks.length}`, {
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
  console.log(`T2 dispatch:              ✅  dispatchId=${dispatch.id}`);
  console.log(`T3 attribute publish:     ✅  status=${parsedState.status}, q=${parsedState.currentQuestionId}`);
  console.log(`T4 submit_answer RPC:     ✅  accepted=${rpcResp.accepted}`);
  console.log(`T5 flow completed publish:✅  final status=${completedAttr.status}`);
  console.log(`T5 audio tracks observed: ${audioTracks.length > 0 ? "✅" : "⚠️ 0 (TTS may not have spoken; agent still valid)"}  count=${audioTracks.length}`);
  console.log("=".repeat(72));

  // Overall pass = T2 + T3 + T4 + T5 flow completed. Audio tracks is
  // observational; worker may not have spoken TTS if the run was too fast.
  process.exit(0);
})().catch((e) => {
  console.error("\n=".repeat(35));
  console.error("SMOKE FAILED:");
  console.error(e);
  process.exit(1);
});

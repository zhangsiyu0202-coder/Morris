# Merism Agent Voice Worker (TypeScript / Mastra + LiveKit)

A TypeScript LiveKit Agents worker built on `@mastra/livekit`. It is a second,
parallel production interview worker alongside the Python worker in
`apps/agent`:

- `apps/agent/agent/main.py` — Python LiveKit Supervisor / TaskGroup /
  AgentTask worker (original production path).
- `apps/agent-voice-worker` (this directory) — TypeScript Mastra worker
  (production path, dispatched by `issueLivekitToken` when
  `MERISM_TS_VOICE_AGENT_NAME` is set).

Both read the same `InterviewRoomMetadata` JSON that `issueLivekitToken`
writes to the LiveKit room, so either worker can join and run a session
against the same survey/session data.

This worker does three Merism-specific things:

- reads `InterviewRoomMetadata` from `ctx.room.metadata`
- builds a session-scoped Mastra agent from required `flowConfig`; `runtimeStudy`
  remains a structural companion for progress and question indexing
- runs an independent TS speech stack:
  `FunASR websocket ASR + Qwen realtime TTS + Qwen compat LLM`

## Sources

- Mastra LiveKit quickstart:
  `https://mastra.ai/docs/voice/livekit`
- Mastra manual install:
  `https://mastra.ai/docs/getting-started/manual-install`

## Workspace

- Listed in the root `pnpm-workspace.yaml`; installs via the root `pnpm install`.
- Depends on `@merism/contracts` (workspace package) for `InterviewRoomMetadata`,
  `InterviewFlowConfig`, and `InterviewRuntimeStudy`.

## Required env

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `QWEN_API_KEY` or `DASHSCOPE_API_KEY`

Optional overrides:

- `QWEN_LLM_MODEL` default `qwen-plus`
- `QWEN_ASR_MODEL` default `paraformer-realtime-v2`
- `QWEN_TTS_MODEL` default `qwen3-tts-flash-realtime`
- `QWEN_TTS_VOICE` default `Cherry`
- `DASHSCOPE_FUN_ASR_ENDPOINT` default `wss://dashscope.aliyuncs.com/api-ws/v1/inference`
- `DASHSCOPE_QWEN_TTS_ENDPOINT` default `wss://dashscope.aliyuncs.com/api-ws/v1/realtime`
- `DASHSCOPE_COMPAT_BASE_URL` default `https://dashscope.aliyuncs.com/compatible-mode/v1`

## Commands

From the repo root (workspace-aware):

```bash
pnpm install
pnpm -F @merism/agent-voice-worker typecheck
pnpm -F @merism/agent-voice-worker probe:llm
pnpm -F @merism/agent-voice-worker probe:tts
pnpm -F @merism/agent-voice-worker probe:stt
```

Run the Mastra server:

```bash
cd apps/agent-voice-worker
set -a
source ../../.env.example
source ../../.env.local
set +a
pnpm dev
```

Run the worker in a second shell:

```bash
cd apps/agent-voice-worker
set -a
source ../../.env.example
source ../../.env.local
set +a
pnpm dev:worker
```

Verified locally on 2026-07-11:

- the connection route is `POST /voice/livekit/connection-details`
- the route is not mounted under `/api/voice/...`
- the worker uses `inference.TurnDetector({ version: "v1-mini" })`
  (see "Turn detection" below) — self-hosted, on-CPU, no cloud auth
- the worker can read and use Merism room metadata from `ctx.room.metadata`
- `pnpm probe:llm` returns text from DashScope compat `qwen-plus`
- `pnpm probe:tts` returns PCM frames from `qwen3-tts-flash-realtime`
- `pnpm probe:stt` returns incremental + final transcripts from
  `paraformer-realtime-v2`

## Turn detection

`voice-worker.ts` pins `inference.TurnDetector({ version: "v1-mini" })` from
`@livekit/agents` (bundled since 1.4.7, no separate plugin or extra). This is
LiveKit's current audio-native end-of-turn model, distinct from the
deprecated text-based `MultilingualModel`/`EnglishModel` in
`@livekit/agents-plugin-livekit` (which needs an HTTP HuggingFace download of
`livekit/turn-detector` ONNX weights and an STT feed — see "Why FunASR/Qwen
realtime speech, not the OpenAI-compatible routes" for the class of bug that
pattern causes).

Why `version` is pinned instead of left on auto-select: `inference.TurnDetector`
without an explicit `version` auto-selects the cloud-hosted `v1` model
whenever `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` are present in dev mode. It
cannot distinguish a self-hosted LiveKit server key from a LiveKit Cloud key
— MerismV2 runs self-hosted LiveKit only (per `architecture.md`), so those
env vars are always present but never valid for LiveKit Inference (LiveKit's
cloud endpoint). The result: the worker tries the cloud model, gets a 401
from LiveKit Inference, and falls back to `v1-mini` — but that fallback is
**one-way and sticky for the session**, and is exactly what a
"401 → auto-downgrade to VAD-only interruption" log line means. Pinning
`version: "v1-mini"` skips the cloud attempt (and its 401) entirely, matching
LiveKit's own recommendation for any agent not deployed to LiveKit Cloud.

`v1-mini` requires VAD with `min_silence_duration >= 0.25s`; Mastra's worker
defaults `vad` to `'silero'` (already a dependency here), and Silero's
default (`0.55s`) already satisfies this — no extra VAD config needed.

## Why FunASR/Qwen realtime speech, not the OpenAI-compatible routes

An earlier TS attempt routed ASR/TTS through the wrong protocol layer:

- Qwen LLM works over DashScope's OpenAI-compatible HTTP API
- `FunASR` realtime ASR uses DashScope's native websocket inference protocol
- `Qwen realtime TTS` uses DashScope's native websocket realtime protocol

Sending ASR/TTS traffic to the OpenAI-compatible speech routes is the wrong
transport and returns 404s for the tested models. This worker's
`dashscope-funasr-stt.ts` / `dashscope-qwen-tts.ts` speak the native websocket
protocols directly.

## Dispatch from `issueLivekitToken`

`issueLivekitToken` explicitly dispatches this worker into a room when
`MERISM_TS_VOICE_AGENT_NAME` is set on the Function runtime:

```bash
MERISM_TS_VOICE_AGENT_NAME=merism-mastra-voice-worker
```

`issueLivekitToken` keeps writing the normal Merism room metadata regardless,
and additionally creates an explicit LiveKit agent dispatch for this worker's
registered `agentName` (`merism-mastra-voice-worker`, matching
`liveKitConnectionRoute()` in `src/mastra/index.ts` and `runLiveKitWorker()`
in `src/mastra/voice-worker.ts`). Leave the env var unset to keep the Python
worker as the only dispatch target.

If you want the deprecated text turn detector instead (needs a live STT feed
and an HF model download, not recommended for new setups — see "Turn
detection" above), switch the worker to `turnDetection: "multilingual"` per
the Mastra docs and download the model files first:

```bash
pnpm download:models
```

After both processes are running, test with the LiveKit Agents Playground:

- `https://agents-playground.livekit.io`

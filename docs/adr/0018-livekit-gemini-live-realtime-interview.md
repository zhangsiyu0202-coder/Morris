# ADR 0018: Run realtime interviews on LiveKit + Gemini Live

Date: 2026-07-16

## Status

Superseded by ADR-0019. ADR-0013 remains authoritative for the Morris page
assistant.

## Context

The prior realtime worker combined `@mastra/livekit`, Mastra `Agent`, Qwen
ASR/TTS, and a Qwen-compatible text model. That put an orchestration framework
between LiveKit and the realtime model and left the flow-engine's questions
without a direct native-audio Gemini path.

Merism already owns a declarative flow-engine, room metadata contract, LiveKit
RPC/attribute transport, and one-way finalization Function. Those are product
behaviours, not Mastra behaviours, and must remain intact during the provider
replacement.

## Decision

- Use the official `@livekit/agents` Node runtime with the official
  `@livekit/agents-plugin-google` plugin.
- Use `google.realtime.RealtimeModel` backed by Gemini Live native audio for
  microphone input, server-side turn-taking, and spoken output. The worker
  explicitly sets `vad: null`; it must not run a competing local VAD.
- Default to `gemini-2.5-flash-native-audio-preview-12-2025`. LiveKit's Google
  plugin documents that Gemini 3.1 Live does not currently support the
  programmatic `generateReply()` calls required to speak flow-engine-owned
  questions.
- Keep Gemini text (`gemini-2.5-flash` by default) behind a narrow adapter for
  bounded condition and probe decisions. The flow-engine still owns cursor,
  edges, round limits, and first-writer-wins semantics; no prompt chooses the
  next step.
- Keep `InterviewRoomMetadata`, `merism.interviewState`,
  `merism.submit_answer`, transcript collection, explicit dispatch, and
  `finalizeInterviewSession` unchanged at their contracts.
- Route each final Gemini user transcription through the same pending-answer
  slot as `merism.submit_answer`, preserving first-writer-wins while allowing
  spoken answers to advance the flow. The structured UI remains the source of
  option selections for option-specific edges.
- Explicit dispatch uses `merism-gemini-live-voice-worker`. The legacy Mastra
  name is removed, so a stale worker cannot silently join a production room.
- Enable Gemini Live context-window compression to make the provider compress
  prior turns during interviews longer than its base audio session window.

## Consequences

- `@mastra/livekit`, `@mastra/core`, Qwen realtime speech adapters, local
  Silero VAD, and their probes are removed from `apps/agent-voice-worker`.
- The worker needs `GEMINI_API_KEY` or `GOOGLE_API_KEY`; keys remain server-only
  and are never passed to browser clients or logged.
- Gemini Live remains a preview API. Its official session-duration and resume
  behaviour is provider-managed, so production monitoring must retain the
  existing session error and finalization signals.

## Verification

On 2026-07-16, the project-local `pnpm -F @merism/agent-voice-worker
probe:gemini-live` established a real Gemini Live WebSocket, sent a request,
and received native-audio model output using the selected default model. The
probe prints model and elapsed time only; it never prints a credential or model
content.

## References

- LiveKit Google plugin guide:
  https://docs.livekit.io/agents/models/llm/gemini/
- LiveKit Node Google plugin reference:
  https://docs.livekit.io/reference/agents-js/modules/plugins_agents_plugin_google.html
- Gemini Live API capabilities and native audio:
  https://ai.google.dev/gemini-api/docs/live-api/capabilities
- Gemini Live WebSocket API:
  https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket

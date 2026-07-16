# ADR 0019: Use the Python LiveKit Gemini plugin for realtime video interviews

Date: 2026-07-16

## Status

Accepted. Supersedes ADR-0018's Node-worker decision and the realtime-worker
portion of ADR-0013. ADR-0013 remains authoritative for Morris.

## Context

The official LiveKit Gemini plugin forwards LiveKit camera and screen-share
tracks to Gemini Live in Python through `RoomOptions(video_input=True)`. The
Node plugin exposes Gemini native audio but its video push implementation is
not available. Merism's interviewee surface already has camera and screen-share
input, so retaining Node would leave a product-visible modality disconnected.

## Decision

- `apps/agent` is the only realtime worker and registers as
  `merism-gemini-live-video-worker` by default. `issueLivekitToken` dispatches
  that exact name via `MERISM_VOICE_AGENT_NAME`.
- Use `livekit-agents[google,images]` and `google.realtime.RealtimeModel` with
  `RoomOptions(video_input=True)`. LiveKit selects the latest camera or screen
  track, JPEG-encodes sampled frames, and forwards them to Gemini Live.
- Keep Gemini 2.5 native audio as the default because the graph-controlled
  interviewer uses programmatic `generate_reply()` calls. A separate
  `gemini-2.5-flash` text adapter performs bounded condition/probe judgments.
- The Python `FlowRunner` owns graph cursor, edges, bounded probe rounds, and
  first-writer-wins between final voice transcript and UI RPC. Gemini never
  selects the next step.
- Keep existing JSON contracts as the source of truth. The Python boundary only
  validates the subset of room metadata and RPC payload it consumes; it never
  creates a second public contract.
- Preserve `merism.interviewState`, `merism.submit_answer`, final transcript
  capture, explicit dispatch, and one-way `finalizeInterviewSession` Function
  persistence. No direct Appwrite document writes occur in the worker.

## Consequences

- Local development now requires Python 3.11+ and `uv`; `pnpm dev:up` starts
  the Python worker through `uv run --project apps/agent`.
- The Node worker and its historical flow tests are removed. The only realtime
  implementation and test target is `apps/agent`.
- Audio+video Gemini Live sessions have tighter provider session limits than
  audio-only sessions. Context-window compression is enabled; reconnect and
  finalization errors remain observable operational events.

## Verification

On 2026-07-16 a real local LiveKit run registered the Python worker, explicitly
dispatched it, published synthetic camera frames before and after agent join,
received the authoritative interview state, accepted two UI RPC answers through
the graph, completed the flow, and observed Gemini native-audio output. The
same test initially exposed the missing Pillow dependency in the actual
`_forward_video_task`; a codec-import test now prevents that regression.

## References

- https://docs.livekit.io/agents/models/realtime/plugins/gemini/
- https://docs.livekit.io/agents/multimodality/vision/video/
- https://ai.google.dev/gemini-api/docs/live-api/capabilities

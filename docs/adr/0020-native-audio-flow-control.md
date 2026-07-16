# ADR 0020: Use Gemini Live native audio for bounded flow control

Date: 2026-07-16

## Status

Accepted. Supersedes only ADR-0019's separate `gemini-2.5-flash` text-adapter
decision; ADR-0019 remains authoritative for the Python worker, video input,
explicit dispatch, room contracts, and one-way finalization.

## Context

The Python worker used native-audio Gemini Live for the interviewee-facing
session but created a second standard Gemini text-model client for FlowRunner's
bounded probe generation and condition decisions. That split introduced a
hidden `GEMINI_FLOW_MODEL` default and an independent provider failure path: a
real browser interview reached Gemini Live audio successfully but its FlowRunner
failed when the text adapter exhausted retries.

The product has one realtime provider and one selected native-audio model. A
flow decision must remain private: emitting a YES/NO judgment through the room
would speak an implementation detail to the interviewee.

## Decision

- `GEMINI_LIVE_MODEL` is the only Gemini model setting consumed by the Python
- The room-facing `AgentSession` is the only Gemini Live session per
  interview. It registers one private `merism_flow_control` function tool.
- `LiveKitFlowHost` sends a bounded instruction through that existing session
  when FlowRunner needs a condition result or one probe question. Gemini calls
  the function with typed `condition` or `probe_question` data; the host gives
  the result only to FlowRunner. `StopResponse` prevents a follow-up spoken
  reply for this private control turn.
- The control gate accepts exactly one result for the active requested kind.
  Incorrect, stale, or concurrently submitted calls are rejected. No mutable
  process-global state or second session is introduced.
- FlowRunner still owns the graph cursor, loop bounds, first-writer-wins gate,
  and all next-step selection. The model only supplies a probe string or a
  YES/NO judgment. Provider failures continue to propagate to the existing flow
  boundary rather than silently choosing an edge.

## Alternatives considered

### Create a private second Gemini Live session

Rejected. It retains two independent provider sessions and turns the bounded
control path into a second model-call chain. The LiveKit Gemini plugin supports
session-level function tools, so a typed, silent handoff within the room-facing
session meets the privacy constraint without a second connection.

### Retain the standard `gemini-2.5-flash` adapter

Rejected. It creates a second model configuration and an independent failure
surface without a product requirement.

### Replace model judgments with deterministic rules

Rejected. Researcher-authored natural-language branch conditions and probe
objectives require bounded semantic interpretation. Deterministic graph
traversal remains in FlowRunner; only the language judgment is model-assisted.

## Consequences

- The worker maintains one Gemini Live WebSocket session per interview. A
  condition/probe control turn is a normal generation turn on that same model
  session, not a separate client, model, or connection.
- Private control data is never published as agent speech or persisted as a
  transcript segment. It cannot be heard by the interviewee.
- A semantic condition or a generated probe still consumes a model turn; making
  it zero-turn would require replacing natural-language judgments with
  deterministic rules, which is a different product behaviour.

## Verification

- Unit tests verify the one-result control gate and that the host waits for a
  matching in-session function result rather than parsing free-form text.
- Local live verification dispatches the Python worker through LiveKit and
  exercises native-audio conditions/probes with a real Gemini Live key.

## References

- https://docs.livekit.io/agents/models/realtime/plugins/gemini/
- https://docs.livekit.io/agents/models/realtime/
- https://ai.google.dev/gemini-api/docs/live-api/capabilities

# ADR 0008: ParticipantEgress for 1-on-1 interview recording

Date: 2026-06-15

## Status

**Accepted** (2026-06-15). Approved by the product owner (Jia).

Supersedes the implicit choice in ADR 0001 (LiveKit Supervisor /
TaskGroup workflow) — that ADR did not specify the egress mode and the
initial implementation used `RoomCompositeEgressRequest` by analogy
with LiveKit's "meeting recording" tutorial. This ADR replaces that
default with `ParticipantEgressRequest`.

## Context

A Merism interview is a single anonymous interviewee in a LiveKit room
with the AI agent. The agent publishes its TTS audio; the interviewee
publishes camera + mic, optionally a screen share. The session lasts
1-60 minutes. We need an mp4 of the session for the researcher to
review afterwards (and for `analyzeSessionVisual` to ingest).

LiveKit offers four recording modes (per its egress overview):

1. **RoomComposite** - spawns a headless Chromium that joins the room
   as a recorder participant, navigates to a composite layout template,
   re-renders the participant grid, and captures the rendered viewport
   + mixed audio.
2. **Participant** - server-side ffmpeg/gstreamer subscribes directly
   to one participant's audio + video tracks (and optional screen
   share) and muxes them into a single output.
3. **TrackComposite** - same as Participant but specified via raw
   track ids; requires the tracks to be published before egress
   starts.
4. **Track** - single-track passthrough (no transcoding).

The initial implementation picked RoomComposite because it was the
default in LiveKit's published examples. The product owner observed
during code review that this was architecturally suspect - it runs
the entire web rendering pipeline twice for every session (once for
the interviewee, once for the recorder), which is heavy for a 1-on-1
shape that doesn't need a custom layout.

## Decision

### D1: Use `ParticipantEgressRequest` for every interview recording

The agent worker's `EgressRecorder.start()` constructs
`ParticipantEgressRequest(room_name=..., identity="interviewee:<sid>",
screen_share=True, file_outputs=[...])` and dispatches via
`lk.egress.start_participant_egress(...)`. Identity matches the value
set on the LiveKit access token by the `issueLivekitToken` Function,
so the egress and the joining participant always agree on identity
without an out-of-band coordination step.

`screen_share=True` ensures any screenshare the interviewee opens
during the interview lands in the same mp4 alongside camera + mic;
research-grade screenshare context (e.g. a researcher watching the
respondent navigate a prototype) is core to the product, not optional.

### D2: No fallback to RoomComposite

We do not preserve a runtime switch between modes. RoomComposite is
removed from `EgressRecorder.start()` entirely. A regression test
(`apps/agent/tests/test_egress_request_shape.py`) instantiates a fake
`LiveKitAPI` whose `start_room_composite_egress` raises
AssertionError, locking the migration in code review.

If a future product change introduces multi-participant interviews
(focus group, panel) - explicitly out of scope per `scope.md` - that
change will need its own ADR plus a switch back to (or alongside)
RoomComposite. Until then, every recording is a participant egress.

### D3: Trade-offs accepted

Per the LiveKit egress overview the comparison is:

|                       | RoomComposite (was) | ParticipantEgress (now) |
|---|---|---|
| Process model         | spawn headless Chromium | server-side ffmpeg / gstreamer |
| Startup latency       | 5-10 s | <1 s |
| CPU / RAM / session   | ~1 CPU + 2 GB | ~0.1 CPU + 200 MB |
| Mute / unmute         | requires layout-template handler | auto |
| Participant leaves    | manual `StopEgress` | auto-stops |
| Track publish wait    | implicit (chrome connects) | implicit (egress waits) |

We give up: the recording does not match the exact pixel layout the
interviewee saw (no Merism logo overlay, no per-question stimulus
panel, no transcript ribbon). A researcher reviewing the mp4 sees the
participant's own camera + their screenshare - same content, simpler
frame.

We gain: instant start, no Chromium overhead, automatic state-change
handling, lower self-host resource budget, no separate
"composite-template" URL to maintain.

## Consequences

- Egress containers no longer launch headless Chrome instances during
  recording. The `livekit-egress` service still pulls
  `livekit/egress:v1.10` (which bundles Chrome) because LiveKit doesn't
  ship a Chrome-less variant; the binary just isn't invoked. Memory
  ceiling on the host drops from ~2.5 GB per concurrent recording to
  ~200 MB.
- Recording starts the moment the interviewee publishes their first
  track. The first 1-2 seconds of the interview, which were previously
  lost while Chromium was initializing, are now captured.
- `analyzeSessionVisual` continues to consume the same mp4. No change
  to the visual analysis pipeline; the format is identical.
- The `egress.yaml` config mounted at `/etc/egress.yaml` still applies
  (api_key, ws_url, redis address, log level). Nothing in our config
  was Chrome-specific.

## Alternatives considered and rejected

- **TrackCompositeEgress**: Functionally equivalent for our 1-on-1
  case, but requires the caller to know `audioTrackId` + `videoTrackId`
  before dispatch. ParticipantEgress takes only the participant
  identity and resolves tracks server-side. Simpler API for the same
  result.
- **TrackEgress (raw)**: Two separate output files (one audio, one
  video) is wrong for our researcher review surface and for
  analyzeSessionVisual which expects a muxed mp4.
- **Keep RoomComposite + load a custom Merism layout template**: We
  did briefly consider serving a composite-template URL from
  `apps/web/app/recorder-template/page.tsx` so the recording would
  match Merism's visual language. Rejected because (a) the audience
  for the recording is a researcher reviewing transcripts + clips,
  not a viewer who needs Merism branding; (b) maintaining a separate
  recorder template is a perpetual second front-end surface.

## References

- LiveKit Egress overview:
  https://docs.livekit.io/transport/media/ingress-egress/egress/
- ParticipantEgress detail:
  https://docs.livekit.io/transport/media/ingress-egress/egress/participant/
- Egress examples (the SRT streaming with thumbnails example uses
  `ParticipantEgressRequest` and shows the canonical Python shape):
  https://docs.livekit.io/reference/other/egress/examples/
- ADR 0001 (interview controller): the recording mode was unspecified
  there; this ADR fills that gap.
- ADR 0005 (visual analysis durability): consumer of the recording
  artifact; format unchanged.

# ADR 0007: Gemini Live as an opt-in realtime interview provider

Date: 2026-06-13

## Status

**Accepted** (2026-06-13). Approved by the product owner (Jia).

This ADR is the gate required by `.kiro/steering/architecture.md` ("Globally
forbidden: A second LLM provider beyond DeepSeek **without ADR**; A second
ASR/TTS provider beyond Qwen **without ADR**"). It authorizes a **second
realtime LLM + ASR provider (Google Gemini Live)** as an **opt-in, reversible**
mode. It does **not** change the default, and it does **not** add a second TTS
(Qwen TTS still speaks in both modes).

## Context

The realtime interview (ADR-0001) runs a LiveKit Supervisor + ordered
TaskGroups + focused AgentTasks, wired today as a cascade:
`AgentSession(stt=Qwen, llm=DeepSeek, tts=Qwen, vad=silero)`.

Gemini Live is a bidirectional realtime model (speech in, audio or text out)
with native turn-taking and lower latency than a discrete STT→LLM→TTS cascade.
The product owner wants the option to run interviews on Gemini Live while
keeping the existing DeepSeek+Qwen path, switchable per deployment. The Gemini
API may be reached through a Cloudflare proxy.

Two facts established this is a small, contained change rather than a rewrite:

1. **LiveKit's `beta.workflows` AgentTask/TaskGroup formally accept a
   `RealtimeModel`** (signature `llm: llm.LLM | llm.RealtimeModel`). The
   interview's `LiveKitQuestionTask` already completes via function-tool calls
   (`record_probe_round` / `complete_question` → `self.complete(...)`), which is
   model-agnostic — so the Supervisor, TaskGroup, `workflow.py` state machine,
   probe-round ceiling, and `collected_answers_map` are unchanged.
2. **2.x Gemini Live models keep `mutable_chat_context=True`** (only "3.1"
   models disable it), so the question task's `on_enter` `generate_reply` works
   without modification on the targeted `gemini-2.5-*` models.

## Decisions

### D1: Gemini Live is opt-in via `MERISM_GEMINI_LIVE`, default stays DeepSeek+Qwen

A single env flag (`MERISM_GEMINI_LIVE`, strict `"1"` per the steering flag
convention; unset → off) selects the realtime mode. Default/unset preserves the
current DeepSeek+Qwen cascade exactly. The switch lives in the provider/settings
layer + the `engine.py` `AgentSession` construction; nothing else branches.

### D2: Gemini Live runs in TEXT modality + Qwen TTS speaks ("Live API + TTS")

In Gemini mode the session is `AgentSession(llm=Gemini RealtimeModel(modalities=["TEXT"]), tts=Qwen)`.
Gemini Live is the **ears + brain** (ASR + understanding + response text); **Qwen
TTS still produces the voice**. No local silero VAD runs in this mode — Gemini
Live does its own server-side turn detection (`server_turn_detection=True`), so a
client-side VAD would be a redundant/conflicting second detector and an
unnecessary per-session model load. (The default cascade mode keeps silero VAD;
it has no server-side detection.) This keeps Chinese voice quality (cosyvoice) and
leaves the transcript/quality-flag pipeline intact: the engine forwards the
AgentSession's `conversation_item_added` events (a model-agnostic, session-level
event) to the transcript buffer, and `build_realtime_llm` explicitly enables the
model's input audio transcription so interviewee turns still become text.
Consequence: this ADR adds a second realtime **LLM + ASR**
provider, but **no second TTS** — the "single TTS provider (Qwen)" posture holds.

### D3: Architecture compatibility — no controller change

ADR-0001's Supervisor/TaskGroup/AgentTask controller is retained as-is. The
question task's tool-call completion is model-agnostic, so per-question
structured `QuestionTaskResult` extraction, probe-round ceilings, section
ordering, progress publishing, and `collectedAnswers` projection all continue to
work. Only the session's `stt`/`llm` wiring differs by mode.

### D4: Cloudflare proxy via `http_options.base_url`

When `GEMINI_BASE_URL` is set, the google-genai client (inside the LiveKit
google plugin) is pointed at it via `HttpOptions(base_url=..., headers=...)`; the
Live WebSocket endpoint is derived from the base URL. Cloudflare AI Gateway
officially supports the Gemini Live WebSocket API; an optional `CF_AIG_TOKEN`
sets the `cf-aig-authorization` header. A hand-rolled Cloudflare Worker proxy
also works **only if** it forwards the WebSocket upgrade (the Live API is WSS,
not REST). Secrets are read in the provider layer, never in pure cores.

### D5: Session-duration cap is lifted via context-window compression; resumption is the plugin's job

Gemini Live caps an audio session at ~15 min (audio+video 2 min) and a single
WebSocket connection at ~10 min; exceeding either terminates the session unless
mitigated. A real interview exceeds 15 min, so `build_realtime_llm` sets
`context_window_compression=ContextWindowCompressionConfig(sliding_window=...)`,
which extends the session to unlimited duration.

Session **resumption** (surviving the ~10-min connection `GoAway`) is NOT
configured by us. The livekit google plugin (`realtime_api.py`) already captures
the `SessionResumptionUpdate` handle from server updates and reuses it on every
reconnect — including the `GoAway`-triggered reconnect, which re-injects the
chat context — so within one interview it is auto-managed. Passing our own
`session_resumption` would only seed an initial handle for resuming a *prior*
`RealtimeModel` instance, which we never do. Caveat: the plugin's `GoAway`
reconnect is marked "not seamless yet", so the ~10-min connection boundary may
produce a brief audio glitch (session continuity is preserved via the handle).

## Alternatives rejected

- **Gemini Live native audio (speech-to-speech, no external TTS)** — simplest,
  but Gemini's built-in voices are weaker for Chinese than Qwen cosyvoice, and
  it would replace the TTS too. Kept available (set `modalities=["AUDIO"]`) but
  not the default Gemini-mode wiring.
- **Replacing DeepSeek+Qwen outright** — rejected; the cascade stays the default
  and the change must be reversible per deployment.
- **3.1 Live models** — `mutable_chat_context=False` breaks `generate_reply` and
  limits mid-session updates, which would force question-task changes. Targeting
  2.5 avoids that.
- **Adding a second TTS provider** — out of scope; Qwen remains the only TTS.

## Consequences

- A latency/naturalness option without touching the interview controller; fully
  reversible (flip the flag).
- New optional dependency `livekit-plugins-google` (realtime extra) and a new
  external provider (Google) gated behind the flag + this ADR.
- The DeepSeek key is not required to run Gemini mode; the availability gate is
  mode-aware (Gemini mode needs Gemini + Qwen; default needs DeepSeek + Qwen).
- Live voice end-to-end testing still depends on the realtime extra + a running
  LiveKit stack (and, for determinism, the planned `MERISM_FAKE_PROVIDERS`).
- The "single LLM/ASR/TTS provider" steering rules now read: DeepSeek+Qwen is
  the default; Gemini Live is permitted **only** as the ADR-0007 opt-in realtime
  mode. Any further provider change still requires a new ADR.

## Review notes (2026-06-14)

Code review of the implementing commits (`a44061a..eac99c2`). Verdict: pass.

**Verified (was the load-bearing risk):** `RealtimeModel(modalities=["TEXT"])` +
an external `tts=` is a documented, supported LiveKit `AgentSession` pattern
(official community example uses `RealtimeModel(modalities=["text"])` with a
separate Cartesia TTS). The "Live API (TEXT) + external Qwen TTS" design is
therefore sound, not speculative.

**Follow-ups (not yet implemented — optional hardenings):**

- *[low] Modality literal.* `build_realtime_llm` passes the string `"TEXT"`,
  which matches the google plugin's `types.Modality` enum value (the openai
  plugin's lowercase `"text"` would NOT). Correct as-is; passing
  `types.Modality.TEXT` would be unambiguous and case-change-proof.
- *[low] `ProviderSettings` invariant is convention-only.* `llm` is now optional;
  the default branch calls `build_llm(self._settings.llm)`. Only
  `resolve_provider_settings` constructs the dataclass and guarantees
  "gemini None ⟺ llm set". A guard in `engine._build_session` (raise a clear
  error if both `llm` and `gemini` are None) would make the invariant explicit.

**Known (not defects):**

- The `gemini.py` build path has no unit coverage (SDK wrappers are
  integration-only per `testing.md`); the actual `RealtimeModel(...)`
  construction + end-to-end audio remain unexercised until a live run with the
  `realtime` extra + a Gemini key/Cloudflare gateway.
- Gemini mode drops DeepSeek from the **agent realtime** availability gate, but
  `analyzeSession` / `analyzeSurvey` still use DeepSeek for post-session
  analysis — a Gemini-mode deployment still needs a DeepSeek key for analysis.

## References

- `.kiro/steering/architecture.md` — provider rules (the gate this ADR opens).
- `.kiro/steering/errors-and-observability.md` — feature-flag table (`MERISM_GEMINI_LIVE`), provider adapter rules, secret masking.
- ADR-0001 (interview controller — retained), ADR-0004/0005 (Gemini for visual analysis — separate use).
- LiveKit Agents `plugins.google.beta.realtime.RealtimeModel`; Cloudflare AI Gateway Realtime WebSockets API (Gemini Live).
- Gemini Live session management (duration caps, context-window compression, session resumption, `GoAway`): https://ai.google.dev/gemini-api/docs/live-api/session-management

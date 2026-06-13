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

In Gemini mode the session is `AgentSession(llm=Gemini RealtimeModel(modalities=["TEXT"]), tts=Qwen, vad=silero)`.
Gemini Live is the **ears + brain** (ASR + understanding + response text); **Qwen
TTS still produces the voice**. This keeps Chinese voice quality (cosyvoice) and
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

## References

- `.kiro/steering/architecture.md` — provider rules (the gate this ADR opens).
- `.kiro/steering/errors-and-observability.md` — feature-flag table (`MERISM_GEMINI_LIVE`), provider adapter rules, secret masking.
- ADR-0001 (interview controller — retained), ADR-0004/0005 (Gemini for visual analysis — separate use).
- LiveKit Agents `plugins.google.beta.realtime.RealtimeModel`; Cloudflare AI Gateway Realtime WebSockets API (Gemini Live).

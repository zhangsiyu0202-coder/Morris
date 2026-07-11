# ADR 0011: Qwen-VL as the default cascade LLM

Date: 2026-06-25

## Status

**Accepted** (2026-06-25). Approved by the product owner (Jia).

This ADR is the gate required by `.kiro/steering/architecture.md` ("A second LLM
provider beyond DeepSeek (without ADR)"). It authorizes **Qwen-VL** as the
**default** cascade LLM, replacing DeepSeek in that slot. DeepSeek is kept
dormant in the codebase as a revert path; it is no longer the primary LLM.

## Context

The realtime interview agent (ADR-0001) runs a LiveKit Supervisor + ordered
TaskGroups + focused AgentTasks. The cascade LLM slot (`AgentSession(llm=...)`)
was DeepSeek (text-only). This had two problems:

1. **Multimodal blindness:** Researchers configure image stimuli on survey
   questions, but a text-only LLM cannot see them. Qwen-VL is a multimodal model
   that understands images embedded in the chat context, enabling the agent to
   "look at" the same image stimulus the respondent sees.

2. **Vestigial TTS coupling:** `resolve_provider_settings` unconditionally
   resolved Qwen speech settings even in Gemini Live mode (where Gemini Live
   emits audio itself and no external TTS is wired in). The swap provided the
   right moment to decouple: Gemini mode now returns `speech=None` and never
   calls `resolve_speech_settings`.

Choosing Qwen-VL specifically was motivated by:

- **Zero new credentials.** Qwen ASR/TTS already use DashScope
  (`DASHSCOPE_API_KEY`). Qwen-VL speaks the OpenAI chat-completions protocol
  through the same DashScope OpenAI-compatible gateway. The existing
  `DEFAULT_QWEN_BASE_URL` (`https://dashscope.aliyuncs.com/compatible-mode/v1`)
  and the same API key cover both LLM and ASR/TTS.
- **Minimal code footprint.** Qwen-VL's adapter (`qwen_llm.py`) is a 40-line
  file with an identical signature to the DeepSeek adapter. The `livekit`
  `openai` plugin is reused without modification because Qwen-VL emits
  `image_url` content parts the plugin already serializes.
- **DeepSeek remains dormant.** `deepseek.py` stays in the codebase untouched.
  Reverting to DeepSeek is a one-line `__init__.py` import change. This
  preserves the architecture.md principle that the default LLM must be
  documented, while acknowledging that defaults can change.

## Decisions

### D1: Qwen-VL is the default cascade LLM

The `AgentSession(llm=...)` slot in the default (non-Gemini) mode points to
Qwen-VL via DashScope's OpenAI-compatible endpoint. The `resolve_llm_settings`
function resolves `DASHSCOPE_API_KEY` (or `QWEN_API_KEY` as alias) and defaults
to model `qwen3-vl-plus`, overridable via `QWEN_VL_MODEL` env var.

### D2: DeepSeek is dormant, not deleted

`deepseek.py` and its constants (`DEFAULT_DEEPSEEK_BASE_URL`,
`DEFAULT_DEEPSEEK_MODEL`) remain in `settings.py`. They are not consumed by any
code path but exist as a drop-in revert path.

### D3: Gemini Live mode no longer requires Qwen speech

`resolve_provider_settings` in Gemini mode (`MERISM_GEMINI_LIVE=1`) returns
`speech=None` and never calls `resolve_speech_settings`. Gemini Live emits audio
itself. `ProviderSettings.speech` type annotation is `SpeechSettings | None`.

### D4: Steering rules are updated

The rule "DeepSeek is the only LLM" in `architecture.md`, `scope.md`,
`errors-and-observability.md`, and `apps/agent/AGENTS.md` is amended to
"Qwen-VL is the primary cascade LLM; DeepSeek is a dormant secondary".
This ADR is the record of that amendment.

## Consequences

### Positive

- Image stimuli on survey questions are now visible to the interview agent
  (via `inject_visual_stimulus_into_chat_ctx` → `ImageContent` on `ChatContext`).
- Operators only need a single DashScope API key for the full stack
  (LLM + ASR + TTS).
- Gemini Live mode is self-contained (Gemini key only, no Qwen key needed).
- `pnpm test:py` (without `--extra realtime`) stays green — lazy imports and
  pure helpers are testable.

### Negative / risk

- **Qwen-VL is not DeepSeek.** Qualitative interview prompts were tuned on
  DeepSeek's personality. Qwen-VL may ask questions differently. This should be
  validated through qualitative A/B in the local Docker stack before production
  deployment.
- **DashScope is the new single point of failure.** LLM, ASR, and TTS share one
  provider. An outage takes down the entire cascade. Reverting to DeepSeek
  (`__init__.py` import + `DEEPSEEK_API_KEY` env var) is the documented
  contingency.
- **Multilingual support.** Qwen-VL's Chinese-language capabilities are strong
  (the primary use case), but English-language interview quality should be
  smoke-tested.

## Compliance

| Steering file | Rule updated? |
|---|---|
| `architecture.md` — "A second LLM provider beyond DeepSeek (without ADR)" | Yes — amended to mention Qwen-VL as primary, DeepSeek as dormant |
| `scope.md` — "A second LLM provider beyond DeepSeek ... without an ADR" | Yes — same amendment |
| `errors-and-observability.md` — "DeepSeek is the only LLM" | Yes — replaced with "Qwen-VL is the primary cascade LLM" |
| `apps/agent/AGENTS.md` — "DeepSeek is the only LLM" | Yes — replaced with "Qwen-VL is the primary cascade LLM" |
| `qwen_llm.py` — ADR-0011 (TODO) | Yes — changed to settled reference |

All steering amendments are in the same commit as this ADR.

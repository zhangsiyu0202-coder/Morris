---
id: SPEC-qwen-vl-llm-swap
companions:
  - requirements.md
  - design.md
  - tasks.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Qwen-VL LLM Swap

## Why

The realtime interview agent (`apps/agent`) currently uses DeepSeek (text-only) as its cascade LLM, which cannot consume image stimuli attached to survey questions. Researchers who configure visual stimuli on questions get blind LLM responses — the agent asks about an image it never sees. At the same time, the Gemini Live code path has a vestigial coupling: `resolve_provider_settings` unconditionally resolves Qwen speech settings, forcing operators to supply a Qwen key even though Gemini Live emits audio itself and never touches Qwen TTS. Both issues have a narrow, mechanical fix: swap the cascade LLM slot to Qwen-VL (which shares the DashScope key already used for ASR/TTS) and decouple Gemini mode from Qwen speech.

**Force type:** pain to solve (broken visual stimulus support) + opportunity to capture (zero-new-keys multimodal via shared DashScope key).

## Capabilities

- id: CAP-1
  intent: `resolve_llm_settings` resolves the cascade LLM to Qwen-VL using `DASHSCOPE_API_KEY` (or `QWEN_API_KEY` as alias), with `DEFAULT_QWEN_VL_MODEL` (`qwen3-vl-plus`) as default, overridable via `QWEN_VL_MODEL` env var.
  success: Calling `resolve_llm_settings(env)` with only `DASHSCOPE_API_KEY` set returns `LLMSettings(model="qwen3-vl-plus")`; calling with no Qwen/DashScope key raises `ProviderConfigError`.

- id: CAP-2
  intent: `qwen_llm.build_llm(LLMSettings)` returns a `livekit.plugins.openai.LLM` pointed at DashScope's OpenAI-compatible endpoint, with `livekit.plugins` imported lazily so the module loads without the `realtime` extra.
  success: `from agent.providers import build_llm` succeeds outside a LiveKit runtime; calling `build_llm(settings)` returns an `LLM` whose model matches the settings.

- id: CAP-3
  intent: Stimulus attached to `InterviewRuntimeQuestion` flows through `_section_config_from_runtime` into `QuestionTaskConfig.stimulus` (fixing the current hardcoded `None`), and `build_question_instructions` emits type-appropriate guidance: text stimuli inline the content with "Reference it directly"; image stimuli use "(image) / attached frame" semantics; video stimuli use "(video) / not attached" semantics.
  success: A runtime question with `stimulus={type:"text", text:"Read this passage"}` produces a `QuestionTaskConfig` whose `stimulus.text` equals `"Read this passage"`, and `build_question_instructions` output contains "Reference it directly" and the passage text.

- id: CAP-4
  intent: When a question's stimulus is `type="image"`, `LiveKitQuestionTask.on_enter` injects the image URL into the multimodal chat context as a `role="user"` message with an `ImageContent` block, labeled as stage context (not respondent speech).
  success: On entering an image-stimulus question, `chat_ctx` contains a user message with `ImageContent(image=stim.url)` and a label distinguishing it from respondent input.

- id: CAP-5
  intent: Gemini Live mode (`MERISM_GEMINI_LIVE="1"`) returns `ProviderSettings(llm=None, speech=None, gemini=...)` from `resolve_provider_settings` — no Qwen speech resolution, no Qwen key requirement.
  success: With only `GEMINI_API_KEY` set (no Qwen/DashScope key), `resolve_provider_settings` succeeds and returns `speech is None`; `provider_settings_available` returns `True`.

- id: CAP-6
  intent: `InterviewEngine._build_session` asserts `llm is not None` and `speech is not None` before building the cascade `AgentSession`, and uses `qwen_llm.build_llm` for the LLM slot. Gemini branch unchanged.
  success: A regression that causes `llm=None` in cascade mode produces a clear `AssertionError` at engine startup rather than a cryptic `AttributeError` deep in LiveKit internals.

## Constraints

- No deletion of `providers/deepseek.py` (dormant, retained for rollback).
- No modification to `providers/gemini.py` or `apps/agent/agent/contracts.py`.
- `pnpm test:py` must stay green without `--extra realtime` installed.
- All `livekit.plugins` imports must be lazy (function-body), keeping modules importable without the `realtime` extra.
- `ProviderSettings.speech` type annotation must be `SpeechSettings | None` (currently `SpeechSettings`, a pre-existing bug).

## Non-goals

- Video frame extraction into chat context (deferred — `ImageContent` does not carry video).
- Deleting or refactoring the DeepSeek adapter.
- Renaming `LLMSettings` (shape is sufficiently generic).
- Authoring ADR-0011 (separate document covering the architecture.md "DeepSeek-only" rule update).
- Changing Gemini Live's own LLM/ASR/TTS configuration.

## Success signal

`pnpm test:py` passes with zero realtime extras, and a manual default-mode smoke produces `llm.model == "qwen3-vl-plus"` / `speech is not None` / `gemini is None`, while a Gemini-mode smoke produces `llm is None` / `speech is None` / `gemini is not None` — with only `GEMINI_API_KEY` set and no Qwen key present.

## Assumptions

- DashScope OpenAI-compatible endpoint is stable and Qwen-VL model (`qwen3-vl-plus`) is available through it.
- The existing `Stimulus` model in `contracts.py` has the correct shape and needs no modification.
- `qwenvl_llm.py` may already exist in the tree; T2 is "verify or create."

## Open Questions

- Has `qwenvl_llm.py` already been created in a prior partial implementation? (T2 says "核对" / verify-or-create.)

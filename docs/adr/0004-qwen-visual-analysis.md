# ADR 0004: Qwen for Post-Session Visual Analysis

Date: 2026-06-08

## Status

Accepted

## Context

MerismV2 records completed LiveKit interviews and stores private video artifacts in Appwrite Storage. The analysis-report pipeline already generates session-level text analysis from transcripts with DeepSeek.

We need PostHog-style video-based session review: analyze visual behavior in the interview recording, attach time-coded observations to the session report, and let the researcher jump to those moments in the private replay. The UI must not expose backend analysis progress.

ADR 0001 and the project rules previously reserved Qwen for ASR/TTS only. The product now explicitly needs a visual-language model for recordings, and Gemini is not allowed for this module.

## Decision

Qwen is allowed for post-session visual understanding in addition to ASR/TTS.

The provider boundary is:

- DeepSeek remains the text LLM for transcript/report prose generation.
- Qwen ASR/TTS remains in the realtime agent provider layer.
- Qwen-VL/DashScope is used only by the post-session visual-analysis adapter in `analyzeSession`.

The visual-analysis adapter is optional and must be enabled explicitly with `QWEN_VISUAL_ANALYSIS_ENABLED=true`. Existing Qwen speech keys do not enable visual analysis by themselves.

## Consequences

- Session reports may include `visualAnalysis`, a structured object with time-coded segments, key moments, sentiment, and tags.
- Frontend surfaces only final visual-analysis results and private replay seeking. It does not show progress, upload status, model stages, or backend workflow internals.
- Appwrite remains the storage source of truth. No new backend platform is introduced.
- If the Qwen visual adapter is enabled and fails, `analyzeSession` returns `visual_analysis_failed`; if it is disabled or no video recording exists, text analysis still works.


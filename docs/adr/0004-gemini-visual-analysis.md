# ADR 0004: Gemini for Post-Session Visual Analysis

Date: 2026-06-08 (initial), 2026-06-09 (revised — provider locked to Gemini)

## Status

Accepted (revised). Supersedes the earlier draft of this ADR that proposed Qwen-VL for post-session video.

## Context

MerismV2 records completed LiveKit interviews and stores private video artifacts in Appwrite Storage. The analysis-report pipeline already generates session-level text analysis from transcripts with DeepSeek.

Two visual workloads exist in this codebase, with **different purposes** and therefore different provider choices:

1. **Realtime visual understanding during the interview** — the agent (LiveKit Supervisor) takes a single still frame at a trigger point during the live conversation and asks a vision model to describe it in natural language, which is then injected back into the DeepSeek conversation context. Latency-sensitive, frame-by-frame, conversational. This workload uses **Qwen-VL via DashScope OpenAI-compatible endpoints**, sharing key/billing infrastructure with the existing Qwen ASR/TTS providers (see `docs/design/multimodal-interview-and-structured-rendering.md` §4 for the design and §6 for triggers).

2. **Post-session visual analysis of the full recording** — after the session is `state=completed` and the recording is uploaded to Appwrite Storage, `analyzeSession` runs an offline pass on the entire video to produce time-coded segments, key moments, sentiment, and tags for the session report. Throughput-friendly, multi-segment, batch-style. This workload uses **Google Gemini Files API** (`gemini-3-flash-preview` / `gemini-2.5-flash`).

This ADR governs (2). The realtime path (1) is governed by the multimodal-interview design and is out of scope here.

## Decision

Use **Google Gemini Files API** as the provider for post-session visual analysis in `analyzeSession`.

The provider boundary across the codebase is now:

| Workload | Provider | Where |
|---|---|---|
| Text LLM (transcript analysis, report prose, theme extraction, etc.) | DeepSeek | `analyzeSession` / `analyzeSurvey` / Morris ToolLoopAgent |
| Realtime ASR / TTS during interview | Qwen DashScope (speech) | `apps/agent` realtime providers |
| Realtime visual understanding during interview | Qwen-VL DashScope (vision) | `apps/agent` realtime providers (per multimodal design) |
| **Post-session visual analysis of recording** | **Google Gemini Files API** | `apps/functions/analyzeSession/src/gemini-visual-analyzer.ts` + `gemini/*.ts` |

The post-session adapter is optional and must be enabled explicitly with `GEMINI_VISUAL_ANALYSIS_ENABLED=true` plus `GEMINI_API_KEY` / `GEMINI_API_BASE_URL`. Realtime Qwen speech keys do not enable post-session visual analysis. The two workloads share no credentials.

### Why Gemini for this specific workload

- **Files API supports direct video upload (mp4/webm) up to 2 GB / 1 hour** — `analyzeSession` uploads the full Appwrite-stored recording once, then issues per-segment queries with `video_metadata { start_offset, end_offset }`. Qwen-VL has no equivalent video upload API; it accepts only base64 images / image URLs, which would force client-side frame extraction at high ingestion cost for hour-long sessions.
- **1M-token context window** is sufficient to consume an entire interview's transcript + multiple video segments in a single consolidation pass.
- **Per-segment offsets** map cleanly onto the segmented analysis pipeline already shipped in `b9e65f5` (`a4 analyze_video_segment` style).
- Consolidation is done by **DeepSeek** (not Gemini) on the per-segment outputs — this keeps Gemini scope-limited to "video → text observations" and reuses the project's primary LLM for prose generation. See `apps/functions/analyzeSession/src/gemini/deepseek-consolidator.ts`.

### Why not Qwen-VL for this workload

Qwen-VL's strengths (low-latency single-frame visual reasoning, OpenAI-compatible call shape) match the realtime path but not the offline path. Forcing Qwen-VL onto post-session would require building a frame-extraction sidecar (FPS sampling, scene change detection, S3 buffering) that PostHog-style Gemini Files API removes entirely. The latency budget for post-session is minutes, not milliseconds — the trade-off favors the higher-fidelity batch path.

## Consequences

- Session reports may include `visualAnalysis`, a structured object with time-coded segments, key moments, sentiment, and tags. Schema is owned by `packages/contracts`.
- Frontend surfaces only final visual-analysis results and private replay seeking. It does not show progress, upload status, model stages, or backend workflow internals.
- Appwrite remains the storage source of truth. No new backend platform is introduced.
- If the Gemini visual adapter is enabled and fails, `analyzeSession` returns `visual_analysis_failed` and text analysis still completes; if it is disabled or no recording exists, text analysis runs as the only path.
- Realtime Qwen-VL adapter (multimodal design) and post-session Gemini adapter are independent. Either can fail without affecting the other; both can be disabled independently.
- The earlier draft of this ADR that proposed Qwen-VL for post-session is **superseded**; the live shipped implementation in commit `b9e65f5` (Gemini Files API) is the canonical path.

## References

- `apps/functions/analyzeSession/src/gemini-visual-analyzer.ts` (orchestrator)
- `apps/functions/analyzeSession/src/gemini/{client,upload-video,analyze-segment,consolidate,deepseek-consolidator,types}.ts` (adapter)
- `apps/functions/analyzeSession/src/prompts/visual-segment-analysis.ts` (per-segment prompt)
- `apps/functions/analyzeSession/src/prompts/visual-consolidation.ts` (DeepSeek consolidation prompt)
- `docs/design/multimodal-interview-and-structured-rendering.md` (governs the realtime Qwen-VL path, **not** this ADR)
- ADR 0001 (LiveKit Supervisor workflow)
- ADR 0003 (analysis-report architecture)

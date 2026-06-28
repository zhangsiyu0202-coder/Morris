# ADR 0010: Qwen3.5-Omni for Post-Session Visual Analysis

Date: 2026-06-22

## Status

Accepted. Supersedes ADR-0004 (provider locked to Gemini) and ADR-0005 D2 (Gemini file lifecycle).

## Context

`analyzeSessionVisual` currently uses Google Gemini Files API for post-session visual analysis (ADR-0004 / ADR-0005). This path depends on three Gemini-specific mechanisms: `files.upload()` for video, per-segment `videoMetadata {startOffset, endOffset}` offset slicing, and `files.delete()` + `sweepGeminiFiles` orphan GC.

Three forces drive this ADR:

1. **Provider convergence.** The project already uses Qwen DashScope for ASR/TTS (`apps/agent/agent/providers/qwen.py`), sharing credentials and billing. Adding visual analysis to the same DashScope account simplifies key management and vendor surface area.
2. **Gemini reachability is not controllable.** Long-term access to the Gemini Files API is outside our control. A domestic provider path (DashScope) adds operational resilience.
3. **POC verified feasibility.** `scripts/poc-qwen-omni-video/` demonstrates that Qwen3.5-Omni via DashScope SDK + OpenAI-compatible endpoint correctly analyzes real interview recordings (18 MB mp4, 4 minutes), producing structured JSON output with timestamps, sentiment, and key moments. The SDK's `oss_utils.upload_file` auto-stages videos to temporary OSS (48h auto-purge), eliminating the need for a managed file lifecycle.

## Decision

Replace Gemini with **Qwen3.5-Omni** as the post-session visual analysis provider. The `analyzeSessionVisual` Function is migrated from TypeScript (Node runtime) to **Python 3.12** (same stack as `apps/agent`) to natively use the `dashscope` Python SDK for video upload and analysis.

### D1: Provider — Qwen3.5-Omni via DashScope

**Why Qwen3.5-Omni (not qwen-vl-max or another model):**

- Qwen3.5-Omni is a true multimodal model that accepts video input natively, producing text output with visual+audio understanding. POC confirmed it reads both the video track and audio dialogue from the same recording.
- `qwen-vl-max` is image-only (frames). Client-side frame extraction at ingestion scale for hour-long sessions is prohibitive (ADR-0004 already rejected this for the same reason).
- Qwen3.5-Omni shares the same DashScope account as the existing ASR/TTS providers (`DASHSCOPE_API_KEY`), so no new credential surface.

**How the call works (POC-verified):**

1. `dashscope.utils.oss_utils.upload_file(model, "file://<abs_path>", api_key)` uploads the local recording to DashScope-managed temporary OSS (`oss://dashscope-instant/...`), 48h auto-purge, account-scoped.
2. OpenAI-compatible endpoint at `https://dashscope.aliyuncs.com/compatible-mode/v1` with `extra_headers={"X-DashScope-OssResourceResolve": "enable"}` resolves the `oss://` URL at inference time.
3. Omni models require `stream=True` + `modalities=["text"]` (non-streaming returns 400 — tested and handled in the POC wrapper).
4. The model returns structured JSON (summary, sentiment, keyMoments with timestamps, tags, etc.) as a single integrated pass over the full recording.

**Why Python (not TS + SDK subprocess):**

- The `dashscope` Python SDK's `oss_utils.upload_file` is the only production-ready path for `file://` → `oss://` auto-staging. The REST API for file upload is not documented as a public stable interface.
- Pip-installing `dashscope` inside the Python openruntimes container is trivial; embedding a Python subprocess in a Node Function to call the SDK is fragile (serialization, error propagation, timeout coordination).
- The `openruntimes/python:v4-3.12` image is already present in the local Docker stack (`OPR_EXECUTOR_RUNTIMES: node-22.0,python-3.12` in `docker-compose.yml`) and Appwrite 1.6 natively supports Python Functions.

### D2: Slicing strategy — Plan A (single integrated pass)

The Gemini path slices the video into 60s offset segments and runs per-segment Gemini calls + DeepSeek consolidation. Qwen3.5-Omni has no `startOffset`/`endOffset` parameter — the SDK exposes no time-window slicing API.

**Plan A (this ADR):** Feed the entire recording to Qwen3.5-Omni in a single call. The model produces:
- A single `segment` covering [0, durationMs] (instead of multiple offset segments)
- `keyMoments[]` with **inferred** timestamps (model watches the video and estimates when key events occur), not deterministically derived from offset boundaries

**Plan B (deferred to `qwen-visual-analysis-segmented` sub-spec):** Client-side ffmpeg slicing → per-chunk Qwen-Omni calls. Only justified if T5.2 precision sampling shows >30% timestamp drift.

**Trade-off acknowledged:** Inferred timestamps are less precise than deterministic offset boundaries. For recordings under 30 minutes this is imperceptible; for longer recordings, drift may reach several seconds. The `VisualAnalysisOutput.segments[]` field retains its array shape for backward compatibility (single element in Plan A, multi-element in Plan B). `keyMoments[].timestampMs` is clamped to `[0, durationMs]` and sorted.

### D3: Durability model — simplified (no long-lived file handle)

Qwen temporary OSS files are auto-purged by DashScope at 48 hours. MerismV2 holds no persistent file reference — the upload handle is ephemeral to the Function invocation.

Consequences:
- `sweepGeminiFiles` Function is **deleted** (no orphan files to GC).
- `visual_analysis_jobs.geminiFileName` / `geminiUploadedAt` fields are **deprecated** (retained one sub-spec cycle, then removed from Appwrite schema).
- If a retry is needed beyond 48 hours (the recording was deleted from OSS), the Function must re-upload from Appwrite Storage — which `analyzeSessionVisual`'s handler already does (re-fetches bytes on each attempt). The 3-attempt retry cap within 24 hours covers all normal cases.
- ADR-0005 D1 (async Function) and D3 (deterministic id + 409 CAS concurrency) are **retained unchanged**.

### D4: Security — no public network window for recordings

| Concern | Plan A posture | Risk delta vs Gemini |
|---|---|---|
| Recording content leaves our infra | DashScope OSS-instant temporary space, account-scoped, 48h auto-purge | Equivalent — Gemini stores in Google's Files API |
| Recording has a public download URL | **None** — `oss://` is NOT a resolvable public URL; only our API key + `X-DashScope-OssResourceResolve` header makes it accessible to the model | Safer than the Gemini path (where `fileUri` is also credential-gated but the file itself lives in a different cloud) |
| API key in logs/snapshots | `mask_secret(api_key)` → `sk-7***`; key only read from env in `deps.py` (never reaches `handler.py` pure core) | Same pattern as existing Qwen ASR/TTS |
| Appwrite Storage stays private | `getFileDownload` fetches bytes inside the Function container; no presigned URL, no public exposure | Best-in-path — the Gemini path also fetches this way, no change |

### D5: Rate limiting — single-tenant safe

DashScope temporary OSS has a 100 QPS upload limit per account. MerismV2 is single-tenant with async, serialized visual analysis (one Function execution per session, no concurrent storm). The 100 QPS ceiling is not a practical constraint. If future multi-tenancy or bulk re-analysis triggers it, the mitigation path is self-hosted AliCloud OSS + presigned URL (deferred to `qwen-visual-self-hosted-oss` sub-spec).

## Consequences

### Provider surface

| Workload | Provider | Where |
|---|---|---|
| Text LLM | DeepSeek | `analyzeSession` / `analyzeSurvey` / Morris |
| Realtime ASR/TTS | Qwen DashScope (speech) | `apps/agent` |
| Realtime visual (single frame) | Qwen-VL DashScope | `apps/agent` |
| **Post-session visual analysis** | **Qwen3.5-Omni DashScope** | `apps/functions/analyzeSessionVisual` (Python) |

### What changes

- `apps/functions/analyzeSessionVisual/` → Python Function (`dashscope` SDK + OpenAI-compatible endpoint)
- `apps/functions/sweepGeminiFiles/` → **deleted** (R4)
- `packages/contracts`: `VisualAnalysisOutput.segments[]` now single-element in Plan A (schema unchanged); `geminiFileName`/`geminiUploadedAt` deprecated
- `packages/appwrite-schema`: `visual_analysis_jobs` fields deprecated (removed next cycle)
- New env: `QWEN_VISUAL_ANALYSIS_ENABLED`, `QWEN_VISUAL_MODEL`, `QWEN_VISUAL_MAX_BYTES`; `GEMINI_VISUAL_*` deprecated
- `errors-and-observability.md` steering updated

### What stays the same

- `analyzeSession` TS Function: enqueue + createVisualAnalysisJob interface unchanged
- `VisualAnalysisOutput` contract shape: all field names/types nullable unchanged (backward compatible)
- ADR-0005 D1 (async Function) and D3 (deterministic id + 409 CAS) retained
- `analyzeSurvey/aggregate-visual.ts`, `visual-analysis-panel.tsx`, `visual-rollup-section.tsx` — zero consumer changes

### Future work (not in this spec)

- Plan B (ffmpeg slicing for precise keyMoments) → `qwen-visual-analysis-segmented` sub-spec, triggered only if T5.2 sampling shows >30% timestamp drift
- `geminiFileName`/`geminiUploadedAt` attribute removal → `qwen-visual-analysis-cleanup` (one sub-spec cycle later)
- Transcript correction (Omni re-watches video to correct realtime ASR) → `transcript-correction` sub-spec (independent, feasibility-first)
- Self-hosted OSS for >100 QPS → `qwen-visual-self-hosted-oss` (single-tenant not needed today)

## References

- Spec: `.kiro/specs/qwen-visual-analysis/` (requirements.md, design.md, tasks.md)
- POC: `scripts/poc-qwen-omni-video/` (qwen_video.py, test_qwen_video.py — all live tests green with real DASHSCOPE_API_KEY)
- Supersedes: ADR-0004 (provider), ADR-0005 D2 (file lifecycle)
- Retains: ADR-0005 D1 (async Function), D3 (409 CAS concurrency)

## Implementation Notes

- **2026-06-22 — Python Function smoke verified.** Hello-world Python Function (`python-3.12` runtime, `src/main.py`, `requirements.txt`) deployed to local Appwrite 1.6 stack and tested via both sync and async `createExecution`. Sync: `{"ok": true, "ping": "{\"hello\":\"world\"}"}`; async: `processing → completed`. Confirms `openruntimes/python:v4-3.12` image builds and executes correctly in our stack. The POC script was deleted after verification (per T0.3).
- **2026-06-22 — POC origin.** The Qwen video analysis wrapper in Wave 2 (T2.2) is promoted from `scripts/poc-qwen-omni-video/qwen_video.py` (commit to be recorded after PR).

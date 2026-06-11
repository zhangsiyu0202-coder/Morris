# ADR 0005: Post-Session Visual Analysis — Durability, File Lifecycle, and Dedup

Date: 2026-06-11

## Status

Accepted. Extends ADR 0004 (which locked the provider to Gemini Files API). This ADR governs the *execution and lifecycle* of that workload; it does not change the provider decision.

## Context

ADR 0004 shipped post-session visual analysis as a sub-flow **inside the synchronous `analyzeSession` Appwrite Function** (`gemini-visual-analyzer.ts` + `gemini/*.ts`), enabled by `GEMINI_VISUAL_ANALYSIS_ENABLED`. A comparison against PostHog's production Gemini video pipeline (`posthog/temporal/session_replay/session_summary/*` + the `gemini_cleanup_sweep` workflow) surfaced three operational gaps that the code-level hardening (prompt-injection defense, output clamping, consolidation retry — shipped separately) does **not** close:

1. **Execution durability.** The visual pipeline = Files API upload + poll for `ACTIVE` (up to 300 s) + N per-segment Gemini calls (parallelism 4) + DeepSeek consolidation. For a 30-minute interview at 60 s chunks that is ~30 segments across ~8 waves — minutes of wall-clock inside one synchronous Function invocation. This risks hitting the Appwrite Function execution-time limit, and on timeout/OOM/crash there is **no resume** and the just-uploaded Gemini file can leak.
2. **Orphan-file lifecycle.** Today the only cleanup is a best-effort `finally` delete plus Google's 48 h auto-purge. If the process is hard-killed before `finally` runs, the file lives until the 48 h backstop. PostHog defends this with track-before-wait + a scheduled sweep classified by owning-job status. MerismV2 has no equivalent.
3. **Concurrency dedup.** Two concurrent `analyzeSession` calls for the same session each upload and run the full Gemini pass (double spend). The report row upsert is idempotent, but the expensive visual sub-flow is not guarded.

These are architecture + Appwrite-schema changes, so per `pre-implementation.md` and `architecture.md` they require this ADR before implementation. PostHog's shape is borrowed; MerismV2 names the artifacts for its own use case and substitutes an Appwrite collection for PostHog's Redis tracking (Appwrite is the only sanctioned backend store — `architecture.md` Globally forbidden).

## Decisions

### D1: Decouple the visual pipeline into its own asynchronous Function `analyzeSessionVisual`

`analyzeSession` (synchronous, text path) stops running the visual sub-flow inline. After it persists the text report it **enqueues** `analyzeSessionVisual` via Appwrite async execution and returns immediately. `analyzeSessionVisual` runs the upload → per-segment → consolidation pipeline off the request path and **patches** its `visualAnalysis` result back into the existing `AnalysisReport(scope=session)` row.

Consequences:
- The synchronous report is never blocked or timed out by the video pass.
- `analyzeSession`'s `visual_analysis_failed` 500 path is removed; visual failure now lives on the job row (D2 `status=failed` + `errorContext`), and the text report still ships.
- `gemini-visual-analyzer.ts` orchestrator logic is reused verbatim — only its trigger and its result sink change.

Rejected — **Option B (per-phase checkpoint/resume)**: a mid-flight crash would resume from `uploaded`/`segments-done` rather than restart. More machinery (per-phase state transitions, partial-result persistence) than a feature-flagged enhancement layer warrants today. The D2 job row's `status` field is the foundation to add this later under a follow-up ADR without reshaping the collection.

Rejected — **Option C (stay synchronous, raise the timeout)**: does not close D1; a long enough session still times out, and the leak/dedup gaps remain.

### D2: Track Gemini uploads in a `visual_analysis_jobs` collection + a scheduled `sweepGeminiFiles` Function

A new owner-scoped Appwrite collection `visual_analysis_jobs` is the single source of truth for both the async job (D1) and the Gemini file record (this decision). One row per session:

- `$id = vis_${sessionId}` (deterministic — also the D3 dedup gate)
- `sessionId`, `surveyId`, `ownerUserId`
- `status`: `queued | uploading | analyzing | consolidating | succeeded | failed`
- `geminiFileName` (nullable; set immediately after upload returns a name, **before** the ACTIVE-wait, mirroring PostHog track-before-wait)
- `geminiUploadedAt` (ISO 8601; drives the sweep age threshold)
- `attemptCount`, `errorContext`, `createdAt`, `updatedAt`

`analyzeSessionVisual` writes `geminiFileName` the moment the upload returns a name; on its own success it deletes the file and clears `geminiFileName` (the existing best-effort `finally` delete is kept as the fast path).

A new scheduled Function `sweepGeminiFiles` (CRON, owner = server key) reclaims orphans: scan rows where `geminiFileName` is set AND (`status` is terminal OR `geminiUploadedAt` older than `SWEEP_MIN_AGE`), delete the Gemini file, clear `geminiFileName`. Delete failures are counted and left for the next cycle; Google's 48 h auto-purge is the final backstop. The sweep never throws out of its boundary.

Rejected — **status quo (best-effort + 48 h only)**: acceptable only if D1 guaranteed the process stays alive, which async execution does not.

### D3: Concurrency dedup via deterministic `$id` + 409 CAS

`analyzeSessionVisual` first attempts `createDocument("visual_analysis_jobs", "vis_${sessionId}", { status: "queued" })`. A second concurrent invocation collides on the unique `$id` (Appwrite 409) and treats the slot as already claimed — it exits without uploading. This is the canonical concurrency pattern from `architecture.md` (deterministic id + 409 as CAS); **no in-memory locks, no counters**. Re-runs (the researcher's "重新生成") reset a terminal row to `queued` in the same CAS-guarded write.

## Consequences

### Cross-module change order (single PR, per `architecture.md`)

1. `packages/contracts` — add `VisualAnalysisJobSchema` (entities) + status enum + any request/response shape for `analyzeSessionVisual`. No Python mirror (the agent does not touch this; leave the documented NOTE).
2. `packages/appwrite-schema` — declare `visual_analysis_jobs` collection (attributes, indexes on `status`+`geminiUploadedAt`, owner-read permission) and the `sweepGeminiFiles` schedule. `pnpm schema:apply && pnpm schema:verify` against the local stack.
3. `apps/functions/analyzeSessionVisual` — new Function (pure core `handler.ts` + SDK wrapper `main.ts` + `deps.ts`), reusing `gemini-visual-analyzer.ts`. `analyzeSession` changes from "run inline" to "enqueue".
4. `apps/functions/sweepGeminiFiles` — new scheduled Function.
5. Tests in the same PR: dedup (N concurrent → one upload), rollback (track-fail deletes the file), sweep (terminal/aged orphan reclaimed, running job skipped), enqueue (text report ships even when visual is queued/failed).

### Permissions
- Agent server key / researcher gets `functions.execute` on `analyzeSessionVisual` (parallel to ADR 0003's `analyzeSession`/`analyzeSurvey` grants).
- `sweepGeminiFiles` runs under the server key only; never interviewee-reachable.
- `visual_analysis_jobs` grants owner-read; writes are Function-only.

### Scope / cost
- One extra collection and two Function deployments. No new backend platform, no new provider, no Redis (Appwrite-only preserved).
- The feature stays behind `GEMINI_VISUAL_ANALYSIS_ENABLED`; when off, neither new Function does work and the collection stays empty.

## References

- ADR 0004 (provider locked to Gemini Files API — this ADR extends it)
- ADR 0003 (analysis-report architecture; Function trigger + permissions pattern)
- `apps/functions/issueLivekitToken` (canonical deterministic-id + 409 CAS concurrency pattern)
- PostHog `posthog/temporal/session_replay/session_summary/activities/video_based/a2_upload_video_to_gemini.py` (track-before-wait + inline rollback) and `gemini_cleanup_sweep/{activities,tracking}.py` (scheduled orphan sweep) — borrowed shape, reimplemented on Appwrite
- `.kiro/steering/architecture.md` (Concurrency contract, Cross-module change order)

## Update 2026-06-11 — retry/reaper implemented (Option B-lite)

The "Rejected — Option B (per-phase checkpoint/resume)" note above stands for *per-phase* resume, but **bounded automatic retry is now implemented** (closing the original Gap B against PostHog's Temporal RetryPolicy):

- `analyzeSession` creates the `queued` job row **before** firing the async execution (durable trigger) — a dropped `createExecution` no longer means "no visual analysis", because the row remains for the reaper.
- `analyzeSessionVisual` claims via a pure `decideClaim` state machine: create/claim a `queued`/`failed`-under-cap/stuck-aged job, skip an active or succeeded one, and fail-permanent a stuck job at the cap (`MAX_VISUAL_ANALYSIS_ATTEMPTS`).
- `sweepGeminiFiles` gained a second pass (`decideReap`): aged `queued`/in-progress/`failed`-under-cap jobs are re-enqueued; stuck non-terminal jobs at the cap are failed permanently. The scheduled run is now a **reconciler** (orphan-file GC + stalled-job retry).

Per-phase checkpoint resume (re-using an already-uploaded file / already-analyzed segments across attempts) remains deferred; a retry currently re-runs the whole pipeline. The `status` field on the job row is the foundation to add that later without reshaping the collection.

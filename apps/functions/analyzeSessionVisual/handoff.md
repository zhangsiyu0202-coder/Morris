# Handoff — Post-Session Visual Analysis Durability (ADR 0005)

Deployment + operational handoff for the visual-analysis pipeline hardening
(PostHog-parity gaps A–E). Code is merged and tested; the steps below require a
running Appwrite/LiveKit stack and **cannot be done from the dev sandbox**.

> Spec: `docs/adr/0004-gemini-visual-analysis.md` (provider), `docs/adr/0005-visual-analysis-durability-and-file-lifecycle.md` (this work).

## What changed (artifacts to deploy)

| Artifact | Path | Role |
|---|---|---|
| Collection `visual_analysis_jobs` | `packages/appwrite-schema/src/schema.ts` | Durable job row + Gemini-file tracking + dedup gate |
| Function `analyzeSessionVisual` | `apps/functions/analyzeSessionVisual` | Async Gemini visual pipeline (upload → per-segment → consolidate → patch report) |
| Function `sweepGeminiFiles` | `apps/functions/sweepGeminiFiles` | Scheduled reconciler: orphan-file GC + stalled-job retry |
| `analyzeSession` (changed) | `apps/functions/analyzeSession` | Now creates the `queued` job row + enqueues `analyzeSessionVisual` (no longer runs visuals inline) |

## Prerequisites

The whole pipeline is **off by default**. It only runs when:

- `GEMINI_VISUAL_ANALYSIS_ENABLED=true`
- `GEMINI_API_KEY` set (and `GEMINI_API_BASE_URL` if proxied)
- `ANALYZE_SESSION_VISUAL_FUNCTION_ID` set on `analyzeSession` and `sweepGeminiFiles`

With these unset, `analyzeSession` ships the text report exactly as before and no
visual work happens.

## Deployment steps (in order)

### 1. Apply the schema
```bash
pnpm stack:up                 # if not already running
pnpm schema:apply             # creates visual_analysis_jobs (idempotent, non-destructive)
pnpm schema:verify            # must exit 0 — confirms live state matches the declaration
```
Expected new collection: `visual_analysis_jobs` (server-write only, document
security on, index `by_status_uploaded`).

### 2. Deploy the two new Functions
Build + deploy via your usual Appwrite Functions deploy path:
```bash
pnpm -F @merism/fn-analyze-session-visual build
pnpm -F @merism/fn-sweep-gemini-files build
# then deploy each dist/ to Appwrite (appwrite CLI / console)
```
Note the **function id** Appwrite assigns to `analyzeSessionVisual` — needed in step 4.

### 3. Set the schedule on sweepGeminiFiles
There is no schedule-declaration mechanism in the repo (by design). Set the
Appwrite Function **schedule (CRON)** at deploy time, e.g. every 30 min:
```
*/30 * * * *
```

### 4. Wire environment variables

`analyzeSession` Function:
| Var | Value |
|---|---|
| `ANALYZE_SESSION_VISUAL_FUNCTION_ID` | the id from step 2 |
| (existing) `APPWRITE_*`, `DEEPSEEK_*` | unchanged |

`analyzeSessionVisual` Function:
| Var | Value |
|---|---|
| `GEMINI_VISUAL_ANALYSIS_ENABLED` | `true` |
| `GEMINI_API_KEY` | provider key |
| `GEMINI_API_BASE_URL` | proxy base (optional) |
| `GEMINI_VISUAL_MODEL` | optional, default `gemini-2.5-flash-lite` |
| `GEMINI_SEGMENT_PARALLELISM` | optional, default 4 |
| `GEMINI_MIN_SUCCESS_RATIO` | optional, default 0.5 |
| `GEMINI_UPLOAD_MAX_WAIT_SEC` | optional, default 300 |
| `GEMINI_VIDEO_MAX_BYTES` | optional, default 2 GB |
| `GEMINI_VISUAL_STUCK_AFTER_MS` | optional, default 900000 (15 min) — claim staleness |
| `APPWRITE_*`, `DEEPSEEK_*` | required (Appwrite SDK + consolidator) |

`sweepGeminiFiles` Function:
| Var | Value |
|---|---|
| `GEMINI_API_KEY` (+ `GEMINI_API_BASE_URL`) | to delete files |
| `ANALYZE_SESSION_VISUAL_FUNCTION_ID` | to re-fire stalled jobs (reaper) |
| `GEMINI_SWEEP_MIN_AGE_MS` | optional, default 1800000 (30 min) — orphan-file age |
| `GEMINI_VISUAL_STUCK_AFTER_MS` | optional, default 900000 (15 min) — stalled-job age |
| `APPWRITE_*` | required |

### 5. Permissions
- `analyzeSession`'s API key needs **write** on `visual_analysis_jobs` and
  `functions.execute` on `analyzeSessionVisual`.
- `sweepGeminiFiles`'s API key needs **read/write** on `visual_analysis_jobs`
  and `functions.execute` on `analyzeSessionVisual`.
- `visual_analysis_jobs` grants owner-read per document; **no anonymous access**.

## How it behaves once live

1. Session completes → `analyzeSession` writes the text report, creates the
   `queued` job row (`vis_<sessionId>`), and fires `analyzeSessionVisual` async.
2. `analyzeSessionVisual` claims the job (409-CAS dedup), uploads the recording
   to Gemini (file tracked **before** the ACTIVE-wait), analyzes per-segment,
   consolidates on DeepSeek (frustration score + tags + highlight), and patches
   `visualAnalysis` into the report row. Status: `queued → analyzing → succeeded|failed`.
3. `sweepGeminiFiles` (CRON) reclaims orphaned Gemini files and re-fires stalled
   jobs (crashed/dropped) up to `MAX_VISUAL_ANALYSIS_ATTEMPTS` (3); stuck jobs at
   the cap are marked `failed`.

## Verification on the stack

```bash
# after a session completes with the flag on:
#  - a visual_analysis_jobs row exists for the session and reaches status=succeeded
#  - the AnalysisReport(scope=session) insights bucket has a visualAnalysis object
#  - no Gemini files linger (check provider console or wait one sweep cycle)
MERISM_LIVE_TESTS=1 pnpm test:properties   # if live coverage is added later
```

Local (no stack) gate already passing:
```bash
pnpm -F @merism/contracts build
# typecheck: contracts, appwrite-schema, fn-analyze-session, fn-analyze-session-visual, fn-sweep-gemini-files
# tests: 14 files / 164 tests green
```

## Rollback / kill switch

Set `GEMINI_VISUAL_ANALYSIS_ENABLED=false` (or unset `ANALYZE_SESSION_VISUAL_FUNCTION_ID`
on `analyzeSession`). The text report path is unaffected; existing job rows go
idle and the sweep leaves them alone (the reaper only fires when the function id
is set). The `visual_analysis_jobs` collection is additive and safe to leave in place.

## Known follow-ups (not blocking)

- Per-phase checkpoint resume (re-use an already-uploaded file / analyzed
  segments across retries) is deferred — a retry currently re-runs the whole
  pipeline. See ADR 0005 "Update 2026-06-11".
- Surfacing `frustrationScore` / `outcome` / `tagsFixed` / `highlighted` in the
  report UI (`apps/web/components/studies/visual-analysis-panel.tsx`) — fields
  persist now but the panel does not render them yet.
- Live-integration (Layer 4) tests against the Docker stack.

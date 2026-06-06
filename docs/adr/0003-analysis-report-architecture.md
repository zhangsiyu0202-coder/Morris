# ADR 0003: Analysis Report Architecture

## Status

Accepted (2026-06-06).

## Context

The `analysis-report` sub-spec turns completed interview sessions into structured reports the researcher can read, and replaces the mock data sources currently backing the page assistant ("Morris") tools and the `/report` page (`apps/web/lib/agent-data.ts`, `apps/web/lib/mock-report.ts`).

Five design questions had to be answered before the spec could be written.

## Decisions

### D1: Survey-level rollup trigger — auto on every session completion

After each session reaches `state=completed`, the agent worker triggers `analyzeSession` (per-session report) and then chains a call to `analyzeSurvey` (rolls every existing session-level report for that survey into a single `AnalysisReport(scope=survey)`). The researcher sees the latest report on every visit without manual refresh.

Cost: every completion pays for one DeepSeek aggregation pass. Acceptable because (a) researchers expect the report to be up-to-date, (b) MerismV2 is not high-throughput SaaS — sample sizes are dozens, not millions.

Alternatives rejected:

- Lazy-on-view: first viewer pays multi-second latency.
- Manual-only: a stale report is the worst failure mode for a research tool.

### D2: Insights persistence — new `Insight` collection in Appwrite

`apps/web/lib/actions/insights.ts` currently writes to a Drizzle/Postgres `insight` table. This sub-spec migrates the storage to a new Appwrite `Insight` collection, keeping the same domain shape but aligning with the backend single-source-of-truth rule.

`Insight` and `AnalysisReport` stay separate collections because:

- An Insight is researcher-authored (focused question + AI answer).
- An AnalysisReport is auto-generated from a session/survey.
- Their lifecycle, permissions, and lookup keys differ.

Alternatives rejected: reusing `AnalysisReport` with `scope="ad_hoc"` conflates two domain concepts; punting leaves Drizzle outside the editor.

### D3: Report route — `/reports/[surveyId]`

Independent route namespace. Decoupled from `/studies/[id]` (currently the editor draft, will be redone). The list page `/reports` shows surveys that have at least one completed session.

Alternatives rejected: `/studies/[id]/report` couples to editor route shape; `/report?surveyId=…` has no static route.

### D4: `analyzeSurvey` Function trigger — agent worker chain on session completion

The agent worker, after writing `state=completed` and finalizing transcripts, invokes `analyzeSession` and on its success invokes `analyzeSurvey`. Both Functions are also callable from the web by the owner researcher (via "重新生成" button) — same Function, idempotent.

Required permissions: agent server key gets `functions.execute` for both Functions plus `AnalysisReport` write permission.

Alternatives rejected: researcher-only trigger (incompatible with D1); agent writing the row directly (risks two write paths for the same row).

### D5: Empty / loading / rendered triptych for the report page

When `getLatestAnalysisReport(surveyId, scope=survey)` returns nothing AND zero completed sessions exist, the page shows a "尚无完成的访谈" empty state. When sessions exist but no report has been generated (transient window between completion and rollup finishing), the page shows loading. When a report exists, the page shows it with a "重新生成" action.

Combines cleanly with D1=auto: a report exists shortly after the first completion. The triptych covers all three windows without surprising the researcher.

## Consequences

### Contract changes (`packages/contracts`)

The existing `AnalysisReportSchema` predates the survey-level case and needs to be tightened:

- `AnalysisReportSchema.sessionId` becomes optional and required-by-superRefine when `scope="session"`.
- `AnalysisReportSchema.surveyId` becomes required-by-superRefine when `scope="survey"`.
- A `SurveyAnalysisReportOutputSchema` covers the survey-level shape: aggregated `questionStats / sentimentBreakdown / themes / insights` with rolled-up citations.
- New `InsightSchema` entity with its own zod schema and Python mirror in `apps/agent/agent/contracts.py`.

### New code surfaces

- `apps/functions/analyzeSession/` — per-session analyzer (pure handler + SDK wrapper).
- `apps/functions/analyzeSurvey/` — survey-level rollup (pure handler + SDK wrapper).
- `apps/web/lib/queries/` — Appwrite read layer used by Morris tools and the report viewer.
- `apps/web/app/reports/[surveyId]/page.tsx` and `apps/web/app/reports/page.tsx` — viewer routes.
- `apps/agent/agent/persistence/` gains a Function dispatcher for `analyzeSession` + `analyzeSurvey`.

### Code removed / migrated

- `apps/web/lib/agent-data.ts` — removed.
- `apps/web/lib/mock-report.ts` — removed; types absorbed into contracts.
- `apps/web/lib/insights.ts: buildStudyContext` — rewritten to use real transcript queries.
- `apps/web/lib/actions/insights.ts` — Drizzle replaced with Appwrite.
- `apps/web/lib/db/schema.ts` `insight` table — removed (Drizzle remains only for the editor `study` table until the editor sub-spec).
- `apps/web/app/report/page.tsx` — replaced by `/reports/[surveyId]`.

### Out of scope

- PDF / Markdown export of reports (spec leaves `rendered` nullable).
- Streaming UI for the analyze Functions (request/response only).
- The editor-side Drizzle `study` table migration — owned by `survey-editor`.
- The page assistant tool `createStudyDraft` — stays mock until `survey-editor` lands a creation flow.
- Multi-language analysis prompts — Chinese only for v1.

## References

- `.kiro/specs/analysis-report/{requirements,design,tasks}.md` — the spec this ADR backs.
- `packages/contracts/src/{entities,api}.ts` — current contract surface.
- `apps/agent/agent/persistence/appwrite_repository.py` — repository the agent uses to write transcripts; will be extended to dispatch the analyze Functions.

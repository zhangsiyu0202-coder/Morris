# MerismV2

AI-driven voice interview qualitative research platform. Researchers design
structured interview surveys; anonymous interviewees join via a link and talk to
an AI interviewer over LiveKit; transcripts are analyzed into structured reports.

This repo is the **foundation-setup** baseline: infrastructure, shared contracts,
app scaffolds, Appwrite schema/permissions, the `issueLivekitToken` function,
observability, a four-layer test harness, and CI. Feature surfaces land in
sub-specs (see [Sub-spec roadmap](#sub-spec-roadmap)).

## Architecture

- **Backend (single source of truth):** self-hosted **Appwrite** — Auth, Database,
  Storage, Realtime, Functions.
- **Realtime media:** self-hosted **LiveKit** + a Python **LiveKit Agent Worker**
  hosting a LiveKit **Supervisor / TaskGroup / AgentTask** interview workflow.
  Media/turn state never routes through Appwrite.
- **Web:** Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui, with a
  **Vercel AI SDK 6 `ToolLoopAgent`** ("Morris") page assistant — sidebar dock
  + standalone `/assistant` page, model = DeepSeek. See
  `docs/adr/0002-page-assistant-vercel-ai-sdk.md`.
- **Contracts:** `packages/contracts` (zod) is the cross-module boundary; Python
  mirrors the needed subset in `apps/agent/agent/contracts.py`.

See `.kiro/specs/foundation-setup/design.md` for the full architecture.

## Prerequisites

Node 22 + pnpm 10, Python 3.11 + [uv](https://docs.astral.sh/uv/), Docker.

## Quickstart

```bash
cp .env.example .env        # fill in real Appwrite project/key + provider keys
pnpm install
pnpm stack:up               # Appwrite + LiveKit via Docker (waits for health)
pnpm schema:apply           # create collections / indexes / buckets (idempotent)
pnpm smoke                  # end-to-end: researcher -> survey -> link -> token
```

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Run the Next.js app |
| `pnpm build` / `pnpm typecheck` / `pnpm lint` | Build / typecheck / lint all packages |
| `pnpm test` | Vitest (unit + property) across the workspace |
| `pnpm test:properties` | Property-based tests in `tests/properties/` |
| `pnpm test:py` | Python (pytest + hypothesis) suites |
| `pnpm e2e` | Playwright E2E (web) |
| `pnpm stack:up` / `stack:down` / `stack:reset` | Local stack lifecycle |
| `pnpm schema:apply` / `schema:verify` | Apply / diff Appwrite schema |
| `pnpm smoke` | Local-stack smoke test |
| `pnpm scope-guard` | Fail on out-of-scope concepts |

Run live integration tests (permission matrix etc.) with a running stack:
`MERISM_LIVE_TESTS=1 pnpm test:properties`.

## Structure

```
apps/
  web/                     Next.js 15 (App Router) — researcher UI, page assistant
                           Morris (/assistant), interviewee landing (/interview)
  agent/                   Python LiveKit Agent Worker — Supervisor / TaskGroup /
                           AgentTask workflow + DeepSeek LLM + Qwen ASR/TTS
  functions/
    issueLivekitToken/     Appwrite Function: validate link, create session, sign JWT
packages/
  contracts/               zod schemas + TS types (cross-module contract)
  appwrite-schema/         declarative collections/buckets + apply/verify tools
  observability/           logger, retry, function error boundary
infra/docker/              docker-compose: Appwrite + LiveKit
scripts/                   stack / env / smoke / scope-guard helpers
tests/properties/          shared property-based tests (fast-check)
docs/
  adr/                     architecture decision records (0001 interview controller,
                           0002 page assistant stack)
  design/                  cross-cutting design notes (e.g. multimodal interview)
  sub-spec-template.md     starter checklist for new sub-specs
```

## Sub-spec roadmap

Each sub-spec references this foundation as a prerequisite (see
`docs/sub-spec-template.md`). Scope/dependencies per `design.md §10`:

| Spec | Scope | Depends on |
|---|---|---|
| **survey-editor** | three-column editor, question types, skip logic, page-assistant tools | foundation-setup |
| **interviewee-portal** | `/i/[linkToken]` landing, consent, device test, session join, reconnect | foundation-setup |
| **ai-interview-engine** | Agent Worker, LiveKit Supervisor/TaskGroup/AgentTask workflow, STT/TTS providers, transcript/recording | foundation-setup, survey-editor, interviewee-portal |
| **analysis-report** ✅ | DeepSeek thematic coding via `analyzeSession` + `analyzeSurvey` Functions, citations, report viewer at `/reports/[surveyId]`, Morris read tools, Insights migrated to Appwrite. PDF/MD rendering deferred. See `.kiro/specs/analysis-report/` and `docs/adr/0003-analysis-report-architecture.md`. | foundation-setup, ai-interview-engine |

## Scope (permanent exclusions)

No teams, collaboration, sharing, comments, billing, subscriptions, quotas,
plans, seats, or usage metering. Enforced by `pnpm scope-guard` in CI.

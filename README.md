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
| **survey-editor** ✅ | three-column editor, question types, page-assistant tools, **AI moderator instruction** (`Survey.moderatorInstruction` → composed into `supervisorInstruction`). No declarative skip logic — the AI moderator decides coverage dynamically. See `.kiro/specs/survey-editor/`. | foundation-setup |
| **interviewee-portal** ✅ | `/interview?link=<token>` landing, pre-interview flow (screen-share permission, device check, consent), camera self-view + screen share, two-pane interview room (transcript + stimulus), session join, reconnect — live-wired via `lib/interview/transport.ts`. Spec governs the existing impl; **no per-interviewee personalization** (interviewees are anonymous). Receiver-side live e2e tracked as NEXT. See `.kiro/specs/interviewee-portal/` and `docs/design/multimodal-interview-and-structured-rendering.md §9`. | foundation-setup |
| **ai-interview-engine** ✅ | Agent Worker, LiveKit Supervisor/TaskGroup/AgentTask workflow, DeepSeek LLM + Qwen STT/TTS, transcript/recording. Spec governs the existing impl + pins non-goals (no declarative skip logic, no LangGraph, no second provider, no Vapi/webhook). `moderatorInstruction` reaches the agent via `supervisorInstruction` (no agent change). Live voice e2e (fake providers + realtime extra) tracked as NEXT. See `.kiro/specs/ai-interview-engine/`. | foundation-setup, survey-editor, interviewee-portal |
| **analysis-report** ✅ | DeepSeek thematic coding via `analyzeSession` + `analyzeSurvey` Functions, citations, report viewer at `/reports/[surveyId]`, Morris read tools, Insights migrated to Appwrite. PDF/MD rendering deferred. See `.kiro/specs/analysis-report/` and `docs/adr/0003-analysis-report-architecture.md`. | foundation-setup, ai-interview-engine |
| **morris-tool-metadata** ✅ | Per-tool metadata (annotations / scopes / enrichUrl / enabled) drives system prompt + UI + approval. Borrowed from PostHog `tools.yaml` shape. See `.kiro/specs/morris-tool-metadata/`. | foundation-setup |
| **morris-llm-observability** ✅ | `withLLMCall` + `llmObservabilityMiddleware` 集中观测 LLM 调用 (latency/tokens/error). 借鉴 PostHog `ai_observability/llm/Client + AnalyticsContext`. 仅基础设施层. See `.kiro/specs/morris-llm-observability/`. | foundation-setup |
| **morris-memory** ✅ | Morris 用户长期记忆 — Appwrite morris_memories collection + 5 actions discriminated union (create/query/update/delete/list) + Qwen embedding cosine 检索 + fulltext fallback + system prompt `<long_term_memory>` 段. 借鉴 PostHog Max AI `manage_memories.py` 形态 (拒绝 LangGraph 6 节点 onboarding / ClickHouse / team-shared). See `.kiro/specs/morris-memory/`. | foundation-setup |
| **morris-conversation-persistence** ✅ | Morris 对话持久化 — Appwrite Conversation collection + Server Actions + URL `/assistant?conversationId=<id>` + 历史抽屉 + HistoryPreview 起始页 + Title 自动生成. 借鉴 PostHog Max AI Conversation model 形态 (拒绝 22 字段含 team/agent_mode/share_token, 我们 stack 用 useChat 序列化非 LangGraph checkpoint). See `.kiro/specs/morris-conversation-persistence/`. | foundation-setup |

## Scope (permanent exclusions)

No teams, collaboration, sharing, comments, billing, subscriptions, quotas,
plans, seats, or usage metering. Enforced by `pnpm scope-guard` in CI.

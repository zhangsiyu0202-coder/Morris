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
  Media/turn state never routes through Appwrite. Per-session recording
  uses LiveKit `ParticipantEgressRequest` (server-side ffmpeg, no Chromium
  re-render); see `docs/adr/0008-participant-egress-for-interview-recording.md`.
- **Functions:** Appwrite Functions deployed via OpenRuntimes. Core interview /
  analysis path includes `issueLivekitToken`, `finalizeInterviewSession`,
  `analyzeSession`, `analyzeSurvey`, and `analyzeSessionVisual`; workspace/
  billing Functions live alongside them. Local-stack deploy steps in
  `docs/dev/deploy-functions.md`.
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
pnpm smoke                  # end-to-end: researcher -> survey -> link -> token -> finalize
```

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Run the Next.js app in dev mode |
| `pnpm -F @merism/web start` | Run the standalone production server after `pnpm -F @merism/web build` |
| `pnpm build` / `pnpm typecheck` / `pnpm lint` | Build / typecheck / lint all packages |
| `pnpm test` | Vitest (unit + property) across the workspace |
| `pnpm test:properties` | Property-based tests in `tests/properties/` |
| `pnpm test:py` | Python (pytest + hypothesis) suites |
| `pnpm e2e` | Playwright E2E (web) |
| `pnpm stack:up` / `stack:down` / `stack:reset` | Local stack lifecycle |
| `pnpm schema:apply` / `schema:verify` | Apply / diff Appwrite schema |
| `pnpm smoke` | Local-stack smoke test (`issueLivekitToken` + `finalizeInterviewSession`) |
| `pnpm scope-guard` | Fail on out-of-scope concepts |

Run live integration tests (permission matrix etc.) with a running stack:
`MERISM_LIVE_TESTS=1 pnpm test:properties`.

## Structure

```
apps/
  web/                     Next.js 15 (App Router) — researcher UI, page assistant
                           Morris (/assistant), interviewee landing (/interview)
  agent/                   Python LiveKit Agent Worker — Supervisor / TaskGroup /
                           AgentTask workflow + Qwen-VL LLM + Qwen ASR/TTS
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
| **ai-interview-engine** ✅ | Agent Worker, LiveKit Supervisor/TaskGroup/AgentTask workflow, Qwen-VL LLM + Qwen STT/TTS, transcript/recording. Spec governs the existing impl + pins non-goals (no declarative skip logic, no LangGraph, no second provider, no Vapi/webhook). `moderatorInstruction` reaches the agent via `supervisorInstruction` (no agent change). Live voice e2e (fake providers + realtime extra) tracked as NEXT. See `.kiro/specs/ai-interview-engine/`. | foundation-setup, survey-editor, interviewee-portal |
| **analysis-report** ✅ | DeepSeek thematic coding via `analyzeSession` + `analyzeSurvey` Functions, citations, report viewer at `/reports/[surveyId]`, Morris read tools, Insights migrated to Appwrite. PDF/MD rendering deferred. See `.kiro/specs/analysis-report/` and `docs/adr/0003-analysis-report-architecture.md`. | foundation-setup, ai-interview-engine |
| **morris-tool-metadata** ✅ | Per-tool metadata (annotations / scopes / enrichUrl / enabled) drives system prompt + UI + approval. Borrowed from PostHog `tools.yaml` shape. See `.kiro/specs/morris-tool-metadata/`. | foundation-setup |
| **morris-llm-observability** ✅ | `withLLMCall` + `llmObservabilityMiddleware` 集中观测 LLM 调用 (latency/tokens/error). 借鉴 PostHog `ai_observability/llm/Client + AnalyticsContext`. 仅基础设施层. See `.kiro/specs/morris-llm-observability/`. | foundation-setup |
| **morris-memory** ✅ | Morris 用户长期记忆 — Appwrite morris_memories collection + 5 actions discriminated union (create/query/update/delete/list) + Qwen embedding cosine 检索 + fulltext fallback + system prompt `<long_term_memory>` 段. 借鉴 PostHog Max AI `manage_memories.py` 形态 (拒绝 LangGraph 6 节点 onboarding / ClickHouse / team-shared). See `.kiro/specs/morris-memory/`. | foundation-setup |
| **morris-conversation-persistence** ✅ | Morris 对话持久化 — Appwrite Conversation collection + Server Actions + URL `/assistant?conversationId=<id>` + 历史抽屉 + HistoryPreview 起始页 + Title 自动生成. 借鉴 PostHog Max AI Conversation model 形态 (拒绝 22 字段含 team/agent_mode/share_token, 我们 stack 用 useChat 序列化非 LangGraph checkpoint). See `.kiro/specs/morris-conversation-persistence/`. | foundation-setup |
| **robustness-hardening** ✅ | Wave A 工程加固已完成 — Morris 工具 workspace ACL gate (REQ-4), Web + Agent 健康端点 + 优雅排水 (REQ-3), semgrep AST 模式守卫 5 条规则 (REQ-1), AGENTS.md mandatory skill table (REQ-5). 借鉴 PostHog `.semgrep/rules/` + `posthog/health.py` + `ee/hogai/MaxTool` 形态; 显式不抄 husky / clickhouse / per-resource RBAC. Wave B 后续由独立子规格推进. See `.kiro/specs/robustness-hardening/` + `docs/adr/0012-borrow-engineering-practices-from-posthog.md`. | foundation-setup, workspaces-billing |
| **lint-baseline-cleanup** 📝 | Wave B - 清 `no-silent-catch-fallback` + `no-bare-console-in-source` 两条规则的 ~36 个存量 WARN finding, 然后两条规则 severity 升 ERROR. 三种处置: (a) 重写到 try/catch matrix 合规态, (b) `nosemgrep:` + 理由, (c) `paths.exclude` + 理由. 最小杠杆最高, 应优先于其他 Wave B item. See `.kiro/specs/lint-baseline-cleanup/requirements.md`. | robustness-hardening |
| **dependency-cruiser-boundaries** ✅ | Wave B (REQ-6) - 把 `architecture.md` § Module map 的 MUST NOT import 边界用 dependency-cruiser 编成 `.dependency-cruiser.cjs` + CI job. 跟 semgrep 互补 (cruiser 跨文件模块边界 / semgrep 单文件 AST 模式). 借鉴 PostHog `products/` boundary config. See `.kiro/specs/dependency-cruiser-boundaries/` + `docs/architecture/module-boundaries.md`. | robustness-hardening, lint-baseline-cleanup |
| **ai-eval-suite** ✅ | Wave B (REQ-7) - LLM 行为回归测试套 (corpus + surfaces + scorers + judge model), `MERISM_EVAL_TESTS=1` 门控, 每晚跑. 5 个 surface × 5 scenario 起步: createStudyDraft / manageMemories / analyzeData / analyzeSession.text-pass / analyzeSurvey.combine. 借鉴 PostHog `ee/hogai/eval/`. Nightly workflow、judge scorer、cost guard、JSON report artifact 已接通. See `.kiro/specs/ai-eval-suite/` + `tests/evals/README.md`. | robustness-hardening, lint-baseline-cleanup |
| **resource-limits-registry** 📝 | Wave B (REQ-8) - 把散落在源码里的 30-50 个数字/时长 literal (TOKEN_TTL_SECONDS / MAX_RECORDING_MB / LLM_MAX_CONCURRENT / TIER 配额) 收纳到 `packages/contracts/src/limits.ts` 单一 registry, 加 doc 生成器. 借鉴 PostHog `posthog/constants.py`. See `.kiro/specs/resource-limits-registry/requirements.md`. | robustness-hardening, workspaces-billing Wave 2 |
| **prompt-versioning** 📝 | Wave B (REQ-9) - 分析 Function 内联 prompt template string 改为 `apps/functions/<name>/prompts/<phase>/vN.md` 版本化文件 + `active.json` 选活 + loader. 每版有 golden 测试 (依赖 `ai-eval-suite`). 借鉴 PostHog `ee/hogai/prompts/`. See `.kiro/specs/prompt-versioning/requirements.md`. | robustness-hardening, ai-eval-suite |
| **interview-probe-task-hardening** ✅ | `LiveKitQuestionTask` conditional tool registration (`record_probe_round` 仅在 `probeConfig.maxRounds > 0` 时注册) + `confirmation_heard: bool` self-reporting gate 防 LLM 把主问题答案误记成 probe round. 借鉴 LiveKit Agents Tool loop design (Focus the toolset + Gate critical actions); 不引入 watchdog (改进 3) 与 conversational test (改进 4b,阻塞在 fake provider 工厂). See `.kiro/specs/interview-probe-task-hardening/`. | foundation-setup, ai-interview-engine |

## Scope note

Root-level scope exclusions in older docs pre-date ADR 0006. Workspaces,
billing, plans, seats, quotas, and usage metering are now in-scope in the
dedicated workspaces/billing track; the remaining exclusions are still enforced
by `pnpm scope-guard` in CI.

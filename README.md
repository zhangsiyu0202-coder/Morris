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
- **Realtime media:** self-hosted **LiveKit** + a TypeScript **LiveKit Agent Worker**
  (`apps/agent-voice-worker`) built on **`@mastra/livekit`** + Mastra `Agent`.
  A declarative flow engine (`src/interview/flow-engine/`) walks a graph of
  `QuestionStep` / `ProbeStep` / `ConditionStep` nodes; the engine, not the
  LLM prompt, owns the cursor. `LiveKitFlowHost` is the host seam that
  routes LLM calls (condition eval / probe judge) through Mastra `Agent`,
  publishes `merism.interviewState` via `InterviewStateSink`, and gates
  `merism.submit_answer` RPC with first-writer-wins between voice and UI
  submission (see ADR-0014, iteration 5 of ADR-0013). Per-session recording
  uses LiveKit `ParticipantEgressRequest` (server-side ffmpeg, no Chromium
  re-render); see `docs/adr/0008-participant-egress-for-interview-recording.md`.
  Post ADR-0013 this is the only interview worker; the Python worker in
  `apps/agent/` has been deleted.
- **Functions:** five Appwrite Functions deployed via OpenRuntimes
  (`issueLivekitToken`, `finalizeInterviewSession`, `analyzeSession`,
  `analyzeSurvey`, `analyzeSessionVisual`). Local-stack deploy steps in
  `docs/dev/deploy-functions.md`.
- **Web:** Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui, with a
  **Mastra `Agent`** ("Morris") page assistant — sidebar dock + standalone
  `/assistant` page, model = DeepSeek. See
  `docs/adr/0013-migrate-realtime-and-page-assistant-to-mastra.md`
  (supersedes ADR-0002). Migration to Mastra is in-flight; some code still
  references Vercel AI SDK 6 `ToolLoopAgent` in `apps/web/lib/assistant/` —
  those files are being swapped in the same wave.
- **Contracts:** `packages/contracts` (zod) is the cross-module boundary and
  the only definition of interview shapes. Post ADR-0013 there is no Python
  mirror.

See `.kiro/specs/foundation-setup/design.md` for the full architecture.

## Prerequisites

Node 22 + pnpm 10, Docker. (Post ADR-0013 there is no Python worker in this
repo; Python + uv are no longer required.)

## Quickstart

```bash
cp .env.example .env        # fill in real Appwrite project/key + provider keys
pnpm install
pnpm dev:up                 # infra + schema + Web + Mastra + voice worker, readiness-gated
pnpm dev:smoke              # full local verification including deployed Function + worker flow
```

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Run the Next.js app |
| `pnpm dev:up` | Start the complete local stack in dependency order; waits for application readiness |
| `pnpm dev:status` | Report readiness and deployed Function failures by component |
| `pnpm dev:smoke` | Verify Web, Appwrite, deployed Functions, LiveKit, Mastra, and voice worker |
| `pnpm build` / `pnpm typecheck` / `pnpm lint` | Build / typecheck / lint all packages |
| `pnpm test` | Vitest (unit + property) across the workspace |
| `pnpm test:properties` | Property-based tests in `tests/properties/` |
| `pnpm e2e` | Playwright E2E (web) |
| `pnpm stack:up` / `stack:down` / `stack:reset` | Local stack lifecycle |
| `pnpm schema:apply` / `schema:verify` | Apply / diff Appwrite schema |
| `pnpm smoke` | Local-stack smoke test |
| `pnpm scope-guard` | Fail on out-of-scope concepts |

See [local development lifecycle](docs/dev/local-development.md) for fixed
ports, first-time Function deployment, and safe shutdown behavior.

Run live integration tests (permission matrix etc.) with a running stack:
`MERISM_LIVE_TESTS=1 pnpm test:properties`.

## Backup recovery

The main workspace has a remote emergency snapshot branch recorded in
[`docs/dev/git-backup-and-restore.md`](docs/dev/git-backup-and-restore.md).
Use it if later TS migration work goes wrong and you need to recover the
2026-07-11 pre-migration file tree.

## Structure

```
apps/
  web/                     Next.js 15 (App Router) — researcher UI, page assistant
                           Morris (/assistant), interviewee landing (/interview)
  agent-voice-worker/      TypeScript LiveKit Agent Worker (@mastra/livekit + Mastra
                           Agent) — the ONLY production interview worker post
                           ADR-0013. Runs a declarative flow engine (QuestionStep /
                           ProbeStep / ConditionStep graph, engine owns cursor)
                           over Mastra Agent + LiveKit Room with DashScope Qwen LLM
                           + FunASR realtime STT + Qwen realtime TTS. Registered as
                           agent name merism-mastra-voice-worker; dispatched by
                           issueLivekitToken on every token issuance.
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
| **survey-editor** ✅ | three-column editor, question types, page-assistant tools, **AI moderator instruction** (`Survey.instruction` → `flowConfig.moderatorInstruction`). No declarative skip logic — the AI moderator decides coverage dynamically. See `.kiro/specs/survey-editor/`. | foundation-setup |
| **interviewee-portal** ✅ | `/interview?link=<token>` landing, pre-interview flow (screen-share permission, device check, consent), camera self-view + screen share, two-pane interview room (transcript + stimulus), session join, reconnect — live-wired via `lib/interview/transport.ts`. Spec governs the existing impl; **no per-interviewee personalization** (interviewees are anonymous). Receiver-side live e2e tracked as NEXT. See `.kiro/specs/interviewee-portal/` and `docs/design/multimodal-interview-and-structured-rendering.md §9`. | foundation-setup |
| **ai-interview-engine** ✅ | Agent Worker + realtime interview orchestration. Original Python `LiveKit Supervisor/TaskGroup/AgentTask` implementation superseded by ADR-0013 (Mastra Agent + `@mastra/livekit`) and ADR-0014 (declarative flow engine over graph of QuestionStep/ProbeStep/ConditionStep). Spec pins non-goals (no LangGraph, no second provider, no Vapi/webhook). `moderatorInstruction` reaches the agent via `flowConfig.moderatorInstruction`. Live voice e2e (fake providers) tracked as NEXT. See `.kiro/specs/ai-interview-engine/` + `docs/adr/0013-migrate-realtime-and-page-assistant-to-mastra.md` + `docs/adr/0014-declarative-flow-engine.md`. | foundation-setup, survey-editor, interviewee-portal |
| **analysis-report** ✅ | DeepSeek thematic coding via `analyzeSession` + `analyzeSurvey` Functions, citations, report viewer at `/reports/[surveyId]`, Morris read tools, Insights migrated to Appwrite. PDF/MD rendering deferred. See `.kiro/specs/analysis-report/` and `docs/adr/0003-analysis-report-architecture.md`. | foundation-setup, ai-interview-engine |
| **morris-tool-metadata** ✅ | Per-tool metadata (annotations / scopes / enrichUrl / enabled) drives system prompt + UI + approval. Borrowed from PostHog `tools.yaml` shape. See `.kiro/specs/morris-tool-metadata/`. | foundation-setup |
| **morris-llm-observability** ✅ | `withLLMCall` + `llmObservabilityMiddleware` 集中观测 LLM 调用 (latency/tokens/error). 借鉴 PostHog `ai_observability/llm/Client + AnalyticsContext`. 仅基础设施层. See `.kiro/specs/morris-llm-observability/`. | foundation-setup |
| **morris-memory** ✅ | Morris 用户长期记忆 — Appwrite morris_memories collection + 5 actions discriminated union (create/query/update/delete/list) + Qwen embedding cosine 检索 + fulltext fallback + system prompt `<long_term_memory>` 段. 借鉴 PostHog Max AI `manage_memories.py` 形态 (拒绝 LangGraph 6 节点 onboarding / ClickHouse / team-shared). See `.kiro/specs/morris-memory/`. | foundation-setup |
| **morris-conversation-persistence** ✅ | Morris 对话持久化 — Appwrite Conversation collection + Server Actions + URL `/assistant?conversationId=<id>` + 历史抽屉 + HistoryPreview 起始页 + Title 自动生成. 借鉴 PostHog Max AI Conversation model 形态 (拒绝 22 字段含 team/agent_mode/share_token, 我们 stack 用 useChat 序列化非 LangGraph checkpoint). See `.kiro/specs/morris-conversation-persistence/`. | foundation-setup |
| **robustness-hardening** 🚧 | Wave A 工程加固 — Morris 工具 workspace ACL gate (REQ-4), Web + Agent 健康端点 + 优雅排水 (REQ-3), semgrep AST 模式守卫 4 条规则 (REQ-1), AGENTS.md mandatory skill table (REQ-5). 借鉴 PostHog `.semgrep/rules/` + `posthog/health.py` + `ee/hogai/MaxTool` 形态; 显式不抄 husky / clickhouse / per-resource RBAC. Wave B 子规格四件套 (dependency-cruiser-boundaries / ai-eval-suite / resource-limits-registry / prompt-versioning) stub 待开. See `.kiro/specs/robustness-hardening/` + `docs/adr/0012-borrow-engineering-practices-from-posthog.md`. | foundation-setup, workspaces-billing |
| **lint-baseline-cleanup** 📝 | Wave B - 清 `no-silent-catch-fallback` + `no-bare-console-in-source` 两条规则的 ~36 个存量 WARN finding, 然后两条规则 severity 升 ERROR. 三种处置: (a) 重写到 try/catch matrix 合规态, (b) `nosemgrep:` + 理由, (c) `paths.exclude` + 理由. 最小杠杆最高, 应优先于其他 Wave B item. See `.kiro/specs/lint-baseline-cleanup/requirements.md`. | robustness-hardening |
| **dependency-cruiser-boundaries** ✅ | Wave B (REQ-6) - 把 `architecture.md` § Module map 的 MUST NOT import 边界用 dependency-cruiser 编成 `.dependency-cruiser.cjs` + CI job. 跟 semgrep 互补 (cruiser 跨文件模块边界 / semgrep 单文件 AST 模式). 借鉴 PostHog `products/` boundary config. See `.kiro/specs/dependency-cruiser-boundaries/` + `docs/architecture/module-boundaries.md`. | robustness-hardening, lint-baseline-cleanup |
| **ai-eval-suite** 🚧 | Wave B (REQ-7) - LLM 行为回归测试套 (corpus + surfaces + scorers + judge model), `MERISM_EVAL_TESTS=1` 门控, 每晚跑. 5 个 surface × 5 scenario 起步: createStudyDraft / manageMemories / analyzeData / analyzeSession.text-pass / analyzeSurvey.combine. 借鉴 PostHog `ee/hogai/eval/`. **Sub-PR 1/3 shipped (harness 骨架 + createStudyDraft surface + 3 scenarios + jsonShapeMatch scorer)**; sub-PR 2 = 余下 4 surface; sub-PR 3 = CI nightly + judge model + cost guard. See `.kiro/specs/ai-eval-suite/` + `tests/evals/README.md`. | robustness-hardening, lint-baseline-cleanup |
| **resource-limits-registry** 📝 | Wave B (REQ-8) - 把散落在源码里的 30-50 个数字/时长 literal (TOKEN_TTL_SECONDS / MAX_RECORDING_MB / LLM_MAX_CONCURRENT / TIER 配额) 收纳到 `packages/contracts/src/limits.ts` 单一 registry, 加 doc 生成器. 借鉴 PostHog `posthog/constants.py`. See `.kiro/specs/resource-limits-registry/requirements.md`. | robustness-hardening, workspaces-billing Wave 2 |
| **prompt-versioning** 📝 | Wave B (REQ-9) - 分析 Function 内联 prompt template string 改为 `apps/functions/<name>/prompts/<phase>/vN.md` 版本化文件 + `active.json` 选活 + loader. 每版有 golden 测试 (依赖 `ai-eval-suite`). 借鉴 PostHog `ee/hogai/prompts/`. See `.kiro/specs/prompt-versioning/requirements.md`. | robustness-hardening, ai-eval-suite |
| **interview-probe-task-hardening** ✅ | `LiveKitQuestionTask` conditional tool registration (`record_probe_round` 仅在 `probeConfig.maxRounds > 0` 时注册) + `confirmation_heard: bool` self-reporting gate 防 LLM 把主问题答案误记成 probe round. 借鉴 LiveKit Agents Tool loop design (Focus the toolset + Gate critical actions); 不引入 watchdog (改进 3) 与 conversational test (改进 4b,阻塞在 fake provider 工厂). See `.kiro/specs/interview-probe-task-hardening/`. | foundation-setup, ai-interview-engine |

## Scope (permanent exclusions)

No teams, collaboration, sharing, comments, billing, subscriptions, quotas,
plans, seats, or usage metering. Enforced by `pnpm scope-guard` in CI.

# MerismV2 Agent Instructions

> **Steering Index (auto-loaded, do not re-inline)**
>
> The seven files below live in `.kiro/steering/` and are auto-injected into the default agent's context every turn. They are the binding source of truth — when the rules below in this file conflict with a steering file, the steering file wins. Do NOT re-quote their content inline; reference by filename.
>
> | Steering | Covers |
> |---|---|
> | `design-system.md` | Visual tokens, typography roles, button/sidebar patterns, Figma → code translation. |
> | `architecture.md` | Module map, Function `handler+main+deps` shape, agent realtime↔persistence boundary, concurrency contract, cross-module change order, globally forbidden imports. |
> | `contracts.md` | `packages/contracts` source-of-truth rules, camelCase + datetime + JSON conventions, `superRefine` invariants, TS↔Python mirror discipline, JSON-bucket sunset rules, deprecation pattern. |
> | `errors-and-observability.md` | `try/catch` matrix, `createLogger` contract, error code registry, `maskSecret`, `withRetry` semantics, `traceId` propagation, `withErrorBoundary`, provider adapter rules. |
> | `testing.md` | Four-layer test model, mandatory property-based scenarios, `MERISM_LIVE_TESTS=1` gating, naming/placement, coverage expectations, forbidden test patterns. |
> | `scope.md` | Permanent product-shape exclusions (no teams/billing/quotas/etc.), borrow-or-build decision flow, anti-patterns to refuse, scope-drift signal words, `pnpm scope-guard`. |
> | `pre-implementation.md` | Investigation order before writing code, blind-men anti-patterns, GitHub reference research priority, no-MVP rule with forbidden phrases, investigation deliverable for non-trivial PRs. |
>
> Sections later in this file that pre-date the steering split (Hard Architecture Rules, Coding Standards, Testing Expectations, Backend Rules, Scope Guard) are kept for product context and the existing repo map; for **binding rules** always defer to the steering files above.


## Project Context

MerismV2 is an AI-driven voice interview qualitative research platform. The intended architecture is:

- Researcher web app: Next.js App Router + TypeScript + Tailwind + shadcn/ui (`apps/web`, present).
- Realtime interview layer: LiveKit server + TypeScript LiveKit Agent Worker (`apps/agent-voice-worker`, `@mastra/livekit` + Mastra Agent). Post ADR-0013 this is the ONLY interview worker; the Python worker (`apps/agent`) has been deleted.
- Interview orchestration: session-scoped orchestrator class in `apps/agent-voice-worker/src/interview/orchestrator.ts` walks Sections → Questions with probe-gate + first-writer-wins between voice and UI submission. Mastra `Agent` is the LLM adapter, not the orchestrator; LangGraph and any second controller framework remain forbidden.
- Page assistant ("Morris"): Mastra `Agent` + DeepSeek for sidebar/standalone researcher workflows. See `docs/adr/0013-migrate-realtime-and-page-assistant-to-mastra.md` (supersedes ADR-0002). During iteration-2 of the migration Morris still ships the Vercel AI SDK 6 `ToolLoopAgent` code in `apps/web/lib/assistant/agent.ts`; the swap is executed in the same migration wave.
- Backend single source of truth: self-hosted Appwrite for Auth, Database, Storage, Realtime, and Functions.
- Shared contracts: `packages/contracts` is the TypeScript/zod source for cross-module API and data shapes. Post ADR-0013 there is no Python mirror; `apps/agent/agent/contracts.py` has been deleted.

The product is for qualitative voice interviews: survey design, anonymous interview links, realtime AI voice interviews, transcripts/recordings, and structured analysis reports.

## Two LLM Chains: Morris vs LiveKit Agent (binding)

MerismV2 拥有**两条彼此独立的 LLM 链路**。它们不是同一个 agent 的两种模式 —— 是两个进程、两套 SDK、两组工具、两组使用者、两条数据流。任何工作开始前先确认要碰的是哪一条;混淆这两条会导致改错文件 / 错放责任 / 错验证。

| 维度 | **Morris** (页面助理) | **LiveKit Agent** (语音访谈主持人) |
|---|---|---|
| 责任 | 帮研究员**操作 Merism 数据**(起草 study / 检索访谈 / 触发分析 / 长期记忆) | 在 LiveKit room 内**与匿名 interviewee 实时语音交谈**, 按 Survey 推进访谈 |
| 进程 | Next.js Node runtime (`apps/web`) | 独立 Node.js 进程 (`apps/agent-voice-worker`) |
| 启动方式 | 随 `apps/web` Next.js 进程; 用户访问 `/assistant` 或侧边栏 dock | `cd apps/agent-voice-worker && pnpm dev` (Mastra HTTP) + `pnpm dev:worker` (LiveKit worker 进程) |
| 入口 | `apps/web/app/assistant/` (standalone) + `apps/web/components/assistant/*` (sidebar dock) + `apps/web/app/api/assistant/route.ts` (POST chat endpoint) | `apps/functions/issueLivekitToken` 发 short-lived JWT + 显式 dispatch `merism-mastra-voice-worker` → interviewee join LiveKit room → agent worker 同 room join |
| 框架 | Mastra `Agent` (per ADR-0013; supersedes ADR-0002 Vercel AI SDK 6 `ToolLoopAgent` — migration in-flight) | Mastra `Agent` + `@mastra/livekit` `createLiveKitWorker`,访谈 orchestrator 由 `src/interview/orchestrator.ts` 拥有 (per ADR-0013; supersedes ADR-0001 Python LiveKit Supervisor + TaskGroup + AgentTask) — **不是 LangGraph** |
| LLM provider | DeepSeek (`apps/web/lib/assistant/model.ts::CHAT_MODEL`/`REASONING_MODEL`) | Qwen-VL primary cascade (per ADR-0011); DeepSeek dormant secondary |
| ASR / TTS | — (纯文本聊天) | Qwen (DashScope) |
| 使用者 | 登录态研究员 (Appwrite Account) | 匿名 interviewee (**无账号**, 凭 `InterviewLink` 拿 JWT) |
| 观测 scope | `morris.*` (per `morris-llm-observability` 注册表: `morris.toolloop` / `morris.toolloop.reasoner` / `morris.title.*`; 另有 `action.*` / `function.*` 等非 Morris-工具的 LLM 调用) | `agent.*` (Python `agent/logging.py::create_logger`; 当前主要是 `agent.main` 等模块前缀, LLM 调用尚未接 `morris-llm-observability` Wave B) |
| `traceId` 命名空间 | 一次 Morris 请求 / Server Action / Function 调用一个 | 一次访谈 session 一个 |
| 持久化对象 | `Conversation` (对话历史) / `Notebook` (研究员 ad-hoc 报告) / `morris_memories` (长期记忆) / `SurveyDraft` (经 `createStudyDraft` + 研究员批准) | finalized `InterviewSession` / `Recording` / `collectedAnswers` / `qualityFlags` (经 Function 单向落 Appwrite) |
| 实时音视频 | 不接 | **唯一**承载方 (LiveKit room + ParticipantEgress 录制, ADR-0008) |
| Spec 文档 | `.kiro/specs/morris-{tool-metadata, llm-observability, memory, conversation-persistence}/` | `.kiro/specs/{ai-interview-engine, interviewee-portal}/` |

### Morris 工具集 (`apps/web/lib/assistant/tools/`)

当前 8 个工具, 全部对 Merism 数据做**动作** — 不是聊天 playground:

| Tool | 责任 | 涉及对象 |
|---|---|---|
| `listStudies` | 列研究员的 study | `Study` (web Drizzle 过渡层) / `Survey` |
| `searchInterviewData` | 单 study 内检索 transcript 片段 | `TranscriptSegment` |
| `analyzeData` | 触发 / 读取 session 分析 | `AnalysisReport` |
| `createStudyDraft` | 起草 Survey draft (`needsApproval=true` in 登录态) | `SurveyDraft` → 研究员复核后才落 `Survey` |
| `createNotebook` | 起草 Notebook (研究员 ad-hoc Q + AI 报告) | `Notebook` (per ADR-0003 D2) |
| `searchAcrossStudies` | 跨 study 全文 + embedding 检索 | `Survey` + `TranscriptSegment` |
| `todoWrite` | 任务列表元工具 (UI state, 无后端写) | 仅内存 |
| `manageMemories` | 长期记忆 5-action discriminated union (`create/query/update/delete/list`, `delete` 走 `needsApproval`) | `morris_memories` |

新增 Morris 工具必须自证"为什么归 Morris 而不是 server action / Function"(per `scope.md::borrow-or-build`), 并同步在 `tool-metadata.ts` 登记 + `tool-enrich-urls.ts` 同步(per `morris-tool-metadata` sub-spec)。

### LiveKit Agent 单一 worker 实现 (post ADR-0013, binding)

"LiveKit Agent" 这条链目前**只有一个** worker 进程 (`apps/agent-voice-worker`, TypeScript + Mastra), 消费 `InterviewRoomMetadata`。历史的 Python worker (`apps/agent/`) 在 ADR-0013 中被删除;`issueLivekitToken` 无条件显式 dispatch `merism-mastra-voice-worker` 名字。

| 维度 | TS worker (`apps/agent-voice-worker`) |
|---|---|
| 框架 | `@mastra/livekit` `createLiveKitWorker` + Mastra `Agent`;访谈状态机由 `src/interview/orchestrator.ts` 拥有(不由 LLM prompt 驱动) |
| 启动 | `cd apps/agent-voice-worker && pnpm dev` (Mastra HTTP) + `pnpm dev:worker` (LiveKit worker 进程) |
| LLM | Qwen compat (`qwen-plus` via DashScope OpenAI-compatible HTTP) — Qwen-VL cascade primary (per ADR-0011) |
| ASR/TTS | FunASR websocket ASR (`paraformer-realtime-v2`) + Qwen realtime TTS (DashScope 原生 websocket, 非 OpenAI-compatible 路由) |
| 端到端判停 | `inference.TurnDetector({ version: "v1-mini" })` — pin 到本地模型, 跳过需要 LiveKit Cloud 账号的 `v1` 云端尝试(自托管 LiveKit 环境下 `v1` 会 401)|
| 房间 dispatch | `issueLivekitToken` 总是显式 dispatch `MERISM_TS_VOICE_AGENT_NAME` (默认 `merism-mastra-voice-worker`) — no auto-dispatch, no fan-out |
| Workflow config 来源 | `src/mastra/merism-room-metadata.ts::workflowConfigFromMerismRoomMetadata` — 优先消费 TS 端合成好的 `workflowConfig`, fallback 到 `runtimeStudy` compose |
| Contracts 依赖 | `@merism/contracts` (workspace 包,直接消费 TS 类型;无 Python mirror) |
| 持久化 | 通过 `apps/functions/finalizeInterviewSession` Function 单向落 Appwrite(one-way append-only, per `architecture.md::Realtime ↔ persistence boundary`)|

### LiveKit Agent 关键代码点 (`apps/agent-voice-worker/src/`)

- `mastra/voice-worker.ts` — worker entrypoint;`createLiveKitWorker` 挂 `onSessionStart` / `onCallEnd` 两个 hook;fail-closed on bad metadata;无静态 greeting
- `mastra/merism-room-metadata.ts` — metadata 解析(`parseMerismRoomMetadata` 返回 discriminated result — 不再静默 catch)+ per-session Mastra `Agent` 工厂
- `interview/workflow-state.ts` — **纯** workflow state 转换(无 side effect);`shouldAcceptUiAnswer` / `formatUiAnswer` / `findNextCursor` / `collectedAnswersMap` — port from `apps/agent/agent/interview/workflow.py`
- `interview/question-runner.ts` — 每个 question 一个 runner 实例;`recordProbeRound` 按 `question.probeConfig.maxRounds > 0` **conditional 暴露**给 LLM(orchestrator 组装 tools 时 skip 它,不注入 tool schema),`confirmationHeard: boolean` self-reporting 参数在 false 时拒绝记账。**改回静态 tool 或移除 `confirmationHeard` 参数会破坏(即将迁移的)P-FLOW-06 / P-FLOW-07 property test**。详 `.kiro/specs/interview-probe-task-hardening/`(仍然 binding, 迁到 TS 实现)。
- `interview/orchestrator.ts` — session-scoped orchestrator;拥有 workflow state / runner map / attribute publisher;订阅 `submit_answer` RPC;finalize on `onCallEnd`
- `transport/attribute-publisher.ts` — 发布 `merism.interviewState`
- `transport/submit-answer-rpc.ts` — 注册 `merism.submit_answer` RPC handler
- `persistence/finalize-client.ts` — 唯一 Appwrite 出口:调 `apps/functions/finalizeInterviewSession` Function

Mastra 与 LiveKit 相关 import (`@mastra/livekit`, `@livekit/agents`, `@livekit/rtc-node`) **禁止在 `apps/web`** 出现 — 属实时 worker 边界。

### Instruction 字段链 — 谁写, 谁读 (容易栽跟头的一组)

精确流向(按数据实际走向, 不是 README/spec 描述的最终目标态):

1. **研究员在 `apps/web/components/studies/guide-editor.tsx` 写**:
   - `Survey.title` / `Survey.flowConfig.{researchGoal, targetAudience, introScript}` / `Survey.moderatorInstruction` (Survey 级 tone / pacing / style 指引)
   - `SurveySection.title` / `.description` / `.sectionInstruction` (section 可选指引)
2. **`apps/web/lib/actions/survey.ts` 写入 Appwrite** Survey / SurveySection / QuestionBlock 行
3. **`apps/functions/issueLivekitToken/src/survey-draft-mapper.ts::buildSurveyDraftFromDocs`** 把行映射成 `SurveyDraft`; `section.objective = section.description || section.sectionInstruction || ""`; `draft.moderatorInstruction = survey.moderatorInstruction ?? ""` (T16/T17 接通点 — 这一步漏一字段就会让研究员的 persona 整条链被静默丢掉)
4. **`apps/functions/issueLivekitToken/src/deps.ts::createRoom`** 调 `buildInterviewRoomMetadataFromDraft` → 内部调 `buildInterviewWorkflowConfigFromDraft` (`@merism/contracts/src/api.ts`) — **TS 端在这里就把 `draft.moderatorInstruction` 前置到 operational base, 合成出最终 `workflowConfig.supervisorInstruction`**, 然后整个 `InterviewRoomMetadata` 经 `JSON.stringify` 塞进 LiveKit `RoomServiceClient.createRoom({metadata})`
5. **`apps/agent-voice-worker/src/mastra/merism-room-metadata.ts::workflowConfigFromMerismRoomMetadata`** 读 room metadata 时**优先消费已合成好的 `workflowConfig`** (TS 端产出); 仅当 metadata 只含 `runtimeStudy`、缺 `workflowConfig` 时, 才走 fallback `buildWorkflowConfigFromRuntimeStudy(study, sessionId)` — 该 fallback 用 `studyTitle / researchGoal / targetAudience / introScript` 从头 compose, **不消费 `moderatorInstruction`** (persona 合成由 TS Function 边完成, worker 只消费)
6. **`apps/agent-voice-worker/src/mastra/merism-room-metadata.ts::buildMerismVoiceAgent`** 用 `workflowConfig.supervisorInstruction` 初始化 Mastra `Agent` 的 `instructions`

**Morris 与这条链的关系: 不写、不读、不参与**。

- Morris **不写** `moderatorInstruction` (它在 survey editor 表单里, 由研究员手写)
- Morris **不读** `supervisorInstruction` / `sectionInstruction` (那是 LiveKit worker 进程的运行时输入, 在 LiveKit room metadata 流)
- Morris `createStudyDraft` 工具的产出物是 `SurveyDraft` (供研究员复核), 不直接活化为活跃 `Survey` 行

`grep -RIn 'moderatorInstruction\|supervisorInstruction' apps/web/lib/assistant` 应**全 0 命中** — 命中即漂移信号。

### 跨链共享的数据 (仅通过 `packages/contracts` + Appwrite collections 间接耦合)

两条链没有直接调用关系, 只通过这几个 governed artifact 间接关联:

- `Survey` + `SurveySection` + `QuestionBlock`: 研究员通过 Morris (`createStudyDraft`, 要批准) 或 guide editor 创建; LiveKit Agent 读作访谈大纲
- `InterviewSession` / `Recording` / `TranscriptSegment`: LiveKit Agent 写入; Morris 通过 `searchInterviewData` / `analyzeData` / `searchAcrossStudies` 读
- `AnalysisReport`: `analyzeSession` / `analyzeSurvey` Function 写入 (session 结束后触发); Morris 读
- `InterviewLink`: 仅 LiveKit 链使用 (anonymous interviewee 入场凭证, Function 签 JWT); Morris 不碰

**唯一接触点是事后单向**: Morris 工具读取 LiveKit Agent 已经写好的 transcript / report。**反方向 (Morris → LiveKit Agent) 没有任何路径** —— Morris 不能影响一场正在进行的访谈; Morris 改了 Survey draft 也要等研究员发布 + 下一次 `issueLivekitToken` 才进入下一场访谈。

### 禁混淆备忘 (binding)

- "Morris 自动生成 `Survey.moderatorInstruction`" — 当前 Morris 工具中**没有这条路径**, 且 `moderatorInstruction` 是研究员要 own 的"研究意图定义", 不是机器生成。开这条路径要走 ADR + 新 Morris tool + `needsApproval` 二次确认。
- "Morris 影响访谈实时过程" — 不存在的路径。
- "LiveKit Agent 调 Morris 工具 / 读 Morris memory / 写 Conversation" — 不存在的路径。两条链的 LLM 观测 scope (`morris.*` vs `agent.*`) 也物理隔离。
- "用 Vercel AI SDK 6 给 LiveKit Agent" 或 "把 Morris 改成 LiveKit Agents SDK" — 同时违反 ADR-0001 / ADR-0002。
- "DeepSeek 是项目唯一 LLM" — **已不再准确**: Qwen-VL (per ADR-0011) 是 LiveKit Agent cascade 的 primary; DeepSeek 留作 dormant revert path。Morris 端仍用 DeepSeek。本文件下文若仍出现"DeepSeek is the only LLM" 措辞, 以 `.kiro/steering/errors-and-observability.md::Provider adapter rules` 为准 (steering 文件先于本文件 reflect ADR-0011)。

## Hard Architecture Rules

- Keep modules low-coupled and high-cohesion. Do not let UI, Appwrite schema tooling, LiveKit agent workflow code, analysis code, and page-assistant tools bleed into each other.
- Treat `packages/contracts` as the stable boundary between modules. Update contracts first when changing cross-module data, then update consumers.
- Keep realtime interview state and media inside LiveKit Agents workflows. Do not route realtime media or turn-by-turn state through Appwrite unless the spec explicitly calls for persistence.
- Keep Appwrite as the only backend platform unless a later architecture decision explicitly changes this.
- Keep anonymous interviewees accountless. Interviewee access must go through dedicated server functions such as `issueLivekitToken`; do not give anonymous clients direct collection write access.
- Do not add multi-user collaboration, teams, sharing, comments, billing, subscriptions, quotas, plans, seats, or usage-metering concepts. They are out of scope by architecture.
- Never expose provider secrets, Appwrite API keys, or LiveKit API secrets in client code, logs, test snapshots, build output, or response bodies.
- **Optimize technology, never change its purpose.** Every artifact in this codebase exists to serve a specific use case. Before adding a new collection / module / spec, ask "what is the existing Merism artifact for, and does it already cover this purpose?" — and if yes, optimize that artifact rather than build a parallel one. Concrete examples to keep front of mind:
  - **`SurveyDraft` (and its persisted shape `Survey + SurveySection + QuestionBlock`) exists so the AI knows what questions to ask in the interview.** It is not a generic "study definition document". Don't add a parallel "interview question list" elsewhere.
  - **`Survey.flowConfig.{researchGoal, targetAudience, introScript}` exists so the LLM (agent supervisor and analysis Functions) knows the research backdrop.** It is not a "research knowledge base". Don't introduce a separate KB / document store / chunked retrieval system to carry the same researcher intent that already lives on `Survey.flowConfig`.
  - **`SurveySection.supervisorInstruction` / `sectionInstruction` exist so the agent knows how to run that section.** They are not generic "agent context fields"; they belong to the section. Don't add a top-level `agentSystemContext` parallel to them.
  - **`InterviewLink` exists to grant an anonymous interviewee access.** It is not a personalization key. If per-interviewee customization is needed (different probe context per respondent), extend the link concept (or add a thin sibling table keyed on `linkId + intervieweeIdentifier`) rather than redesigning the link surface.
  - **`AnalysisReport` (with `scope = "session" | "survey"`) is the structured analysis output for a session or a survey rollup.** It is not a generic "research report repository". The `Notebook` collection (researcher-authored ad-hoc question + AI-written report, formerly `Insight`, renamed in the `notebooks` sub-spec) is intentionally separate (ADR-0003 D2). Note: `AnalysisReport.insights[]` (the auto-generated insight items embedded inside a survey-scope analysis report) and the `Notebook` collection are different artifacts despite the historical naming overlap — do not collapse them.
  - **`Morris ToolLoopAgent` tools exist to perform actions on Merism data (create study draft / search interview data / analyze data / list studies).** They are not a chat playground. New tools must justify why the action belongs in Morris vs a server action / Function.

  When borrowing a pattern from another codebase (e.g. PostHog), the question is never "do they have a thing called X, can we copy it?" — it is "what purpose does X serve in their stack, and which existing Merism artifact already serves that same purpose, if any?" If no Merism artifact serves that purpose yet, then borrow shape *and* name it for the Merism use case. If an artifact does serve that purpose, optimize it (better encoding, better LLM prompt, better UI), don't fork the concept.

## Coding Standards

- Prefer small, cohesive modules with explicit interfaces over broad service objects.
- Prefer structured schemas and typed contracts over ad hoc object/string handling.
- Use mature ecosystem patterns from the active stack before inventing custom infrastructure:
  - LiveKit Agents examples for agent lifecycle, room metadata, track handling, interruption/barge-in patterns, Supervisor pattern, TaskGroup, and AgentTask.
  - Vercel AI SDK 6 examples for the page assistant: `ToolLoopAgent`, `tool({ inputSchema, execute })`, `prepareStep` (model/context/`toolChoice` switching), `stopWhen` conditions, `createAgentUIStreamResponse`, and `@ai-sdk/react` `useChat` + `DefaultChatTransport`.
  - Appwrite Server SDK examples for functions, permissions, storage buckets, and schema operations.
- Keep hot-path interview code performance-conscious: avoid unnecessary network calls, avoid shared mutable global state across sessions, and isolate per-session state.
- Use explicit error types for provider failures and preserve `traceId` in logs/responses where applicable.
- Add comments only when they explain non-obvious decisions or invariants.
- Default to ASCII in source files unless the existing file already uses Chinese or other Unicode prose.
- Never use `try/catch` as a blanket safety net to hide failures. Catch specific, expected errors. Letting a silent failure pass is worse than a loud crash during development.

## Repository Map

- `.kiro/specs/foundation-setup/requirements.md`: foundation requirements and acceptance criteria.
- `.kiro/specs/foundation-setup/design.md`: architecture baseline, topology, data model, and sub-spec boundaries.
- `.kiro/specs/foundation-setup/tasks.md`: foundation implementation plan and dependency waves.
- `.kiro/steering/design-system.md`: **MerismV2 Design System (Mauve Quiet)** — single source of truth for visual tokens, typography roles, button system, sidebar pattern, and Figma → code translation rules. Always-included steering.
- `packages/contracts`: zod schemas and TypeScript types for entities, API contracts, and shared interview workflow state.
- `packages/observability`: TypeScript logger, retry, and function error-boundary helpers.
- `packages/appwrite-schema`: declarative Appwrite schema (collections, attributes, indexes, permissions, storage buckets) with `apply` / `verify` tooling under `src/`.
- `apps/agent-voice-worker`: TypeScript LiveKit Agent Worker (post ADR-0013 唯一 interview worker). `src/mastra/` 挂 `@mastra/livekit` `createLiveKitWorker` + Mastra `Agent` + DashScope Qwen LLM / FunASR realtime STT / Qwen realtime TTS. `src/interview/` 拥有访谈 orchestrator + section/question 状态机 + probe gate. `src/transport/` 发布 `merism.interviewState` 与注册 `merism.submit_answer` RPC. `src/persistence/finalize-client.ts` 调 `apps/functions/finalizeInterviewSession` Function 单向落 Appwrite. `src/health.ts` 挂 `/_livez` / `/_readyz` + SIGTERM drain.
- `apps/functions/issueLivekitToken`: example Appwrite Function with pure-core / SDK-wrapper split.
- `apps/web`: Next.js 15 (App Router) researcher web app. Hosts the page assistant Morris (`app/api/assistant/route.ts` + `lib/assistant/*` + `components/assistant/*` + standalone `/assistant`), the interviewee surfaces (`/interview` + `components/interview/*`; UI follows the *Design Interviewer Page* prototype — pre-interview flow, camera self-view + screen share, two-pane room, per `docs/design/multimodal-interview-and-structured-rendering.md §9`), the editor surfaces (`/home`, `/studies/[id]`, `components/studies/*`), and the analysis surfaces (`/insights`, `/insights/[id]`, `/report`). The current editor is a v0-generated draft slated for redesign; do not treat its persistence layer (Drizzle/Postgres) as the architectural target.
- `docs/adr/`: architecture decision records. `0001` (interview controller), `0002` (page assistant stack), `0003` (analysis report), `0004`/`0005` (Gemini visual analysis + durability), `0006` (workspaces / billing), `0007` (Gemini Live), `0008` (ParticipantEgress for recording).
- `docs/design/`: cross-cutting technical designs (e.g. `multimodal-interview-and-structured-rendering.md`).
- `infra/docker/docker-compose.yml`: local Appwrite + LiveKit stack.
- `scripts`: stack, environment, scope-guard, and Python test helpers.
- `tests/properties`: property-based test templates.

Current gaps and known drifts:

- `apps/web/components/studies/*`, `apps/web/lib/guide.ts`, `apps/web/lib/actions/studies.ts`, `apps/web/lib/db/*`, `apps/web/lib/actions/guide-ai.ts` — these implement the existing editor draft against Drizzle + Postgres. They will be replaced when the `survey-editor` sub-spec is written; the architectural target remains Appwrite as the only backend. The Drizzle `insight` table was removed by the `analysis-report` sub-spec (T8); only the `study` table remains in `lib/db/schema.ts`.
- `pnpm-lock.yaml` still pins `@copilotkit/*` packages. They are not imported by `apps/web/package.json` and will be removed on the next dependency refresh (see `docs/adr/0002-page-assistant-vercel-ai-sdk.md`).
- Root `smoke` and `e2e` scripts reference planned files that may not exist yet.

## Common Commands

- Install JS dependencies: `pnpm install`.
- Build all packages with build scripts: `pnpm build`.
- Typecheck all packages with typecheck scripts: `pnpm typecheck`.
- Run TypeScript tests: `pnpm test`.
- Run property tests: `pnpm test:properties`.
- Start local infra: `pnpm stack:up`.
- **Local researcher login (manual QA):** see `docs/dev/local-researcher-account.md` (`researcher@merism.local` / pre-created on local Appwrite).
- Stop local infra without deleting volumes: `pnpm stack:down`.
- Reset local infra volumes: `pnpm stack:reset`.
- Run TS agent voice worker (dev): `cd apps/agent-voice-worker && pnpm dev` (Mastra HTTP) + `pnpm dev:worker` (LiveKit worker).

Before running commands that require Docker, network access, or dependency downloads, expect that sandbox approval may be needed.

## Testing Expectations

- For contract changes, run `pnpm -F @merism/contracts typecheck` and related tests.
- For observability changes, run `pnpm -F @merism/observability typecheck` and related tests.
- For Python agent changes, run `pnpm test:py` or `cd apps/agent && uv run pytest`.
- For Appwrite/LiveKit integration changes, prefer tests against the local Docker stack and keep credentials in `.env`, never committed.
- Add or update property-based tests for permission, token, secret-leakage, state-machine, and concurrency invariants when touching those areas.

## Design Workflow

- Read the relevant foundation spec before implementing a new module.
- For new cross-module behavior, define the contract in `packages/contracts` first.
- For Python agent behavior that depends on contracts, mirror only the necessary schema in `apps/agent/agent/contracts.py` and keep field names aligned with zod schemas.
- For realtime voice interviews, model the conversation with a long-lived LiveKit supervisor agent, ordered `TaskGroup`s for sections/blocks, and focused `AgentTask`s for reusable collection or interview tasks. Do not introduce LangGraph as the main realtime interview controller unless the architecture is explicitly revised again.
- For Appwrite schema and permissions, keep declaration, apply, and verify logic idempotent and non-destructive by default.
- For frontend work, build the actual workflow surface, not marketing pages. Use existing design-system conventions once `apps/web` exists.
- For AI or provider integrations, keep provider adapters behind narrow interfaces. All LLM calls use DeepSeek; Qwen is reserved for ASR/TTS unless a future ADR changes this.

---

## Frontend Rules (apps/web)

The frontend has a single binding source of truth: **`.kiro/steering/design-system.md`** (Mauve Quiet). It is auto-loaded into agent context. Read it before writing UI code. The rules below summarize the operational consequences for `apps/web`.

### Visual language (binding)

- **Signature surface**: mauve `#D7CFD9` (`mauve-200`). Hero cards, project cards, primary buttons.
- **Monochrome status**: success / warning / destructive / info are communicated through icon + copy + container position, not color. No green / amber / red / blue exists in the product palette.
- **Five-face typography**: `font-display` (Inclusive Sans 600), `font-reading` (Inclusive Sans 400), `font-ui` (Inter 400/500/600), `font-data` (Istok Web 400), `font-decor` (Inika 400), `font-doc-link` (Inknut Antiqua 400 underline). Each role is fixed; never write `font-['Inter']` or use a face outside its assigned role.
- **Mauve-tinted shadows**: every elevation uses `rgba(167, 133, 133, α)` (mauve-400 dusty rose), never pure black.
- **No black-fill buttons in product UI**. Button system is exactly four variants: `primary` (mauve fill), `outline` (white + ink-900 border), `ghost` (transparent), `link` (underline). The earlier `solid-dark` variant was removed; do not reintroduce it.
- **Disclosure rows** (Accordion / Select / Dropdown / nav rows / table sort headers etc.) put the trailing icon flush right via `flex justify-between w-full` (or Figma `SPACE_BETWEEN` + `layoutSizingHorizontal='FILL'`). Never abut the icon to the label.

### Component reuse (binding)

- **42 components** are designed in the Figma file (key `yXuNwrBMEsJz1Ef35VA7UL`, "MerismV2 Design System"). Code components must mirror the Figma source, not invent new variants.
- All UI primitives live under `apps/web/src/components/ui/` once that app exists. Feature components go to `apps/web/src/components/<feature>/`.
- Reuse shadcn primitives before authoring new components. New variants belong in the existing primitive's variant API, not as parallel components.
- Never install a new icon library. Use `lucide-react` (the shadcn convention) plus any SVG payload returned by the Figma MCP server.

### Sidebar (binding)

The product sidebar is a three-state component. Specifics in `.kiro/steering/design-system.md` § Sidebar.

| State | Width | Layout |
|---|---|---|
| Collapsed (default) | 72px | inline, content occupies the rest |
| Hover-Expanded | 264px | overlay floating above content (no layout shift) |
| Pinned | 264px | inline, content reflows once |

- IMPORTANT: Default is **Collapsed**. Hover-expand is **overlay**, not push. Pin button toggles inline mode. Each collapsed icon must show a tooltip on hover.

### Figma → code translation rules

- Always run `get_design_context`, `get_screenshot`, and `get_variable_defs` for the targeted node before implementing. Treat the React + Tailwind output as a **description**, not the final code.
- Map every Figma color and font to a token defined in `design-system.md`. If a value has no token, **stop and update the design system file first**, do not inline the hex.
- Snap Figma sizes/spacing to the 4-px scale. Document deviations in `design-system.md` if a value cannot be expressed within ±1px.
- Use the `@/` path alias inside `apps/web` (per `apps/web/components.json`). Never relative imports across feature boundaries.

### State, data, and routing patterns

When `apps/web` is created, the following patterns are mandatory:

- **State**: prefer URL state (search params) and server-fetched state. Local UI state in `useState`. Cross-component shared state goes through context, never global mutable singletons.
- **Data fetching**: server components and route handlers, with TanStack Query on the client only when explicitly needed (live updates, optimistic UI). No fetch-on-mount in components when a server component can fetch upfront.
- **Forms**: React Hook Form + Zod schemas from `@merism/contracts`. Never duplicate field validation; reuse the contract schema.
- **Realtime media**: LiveKit React SDK only inside the interview surfaces; never imported into survey-editor or report code paths.
- **Auth**: Appwrite client SDK for researcher sessions; **anonymous interviewees never authenticate**, they call `issueLivekitToken` and join via short-lived LiveKit token only.
- **Accessibility**: every interactive element has an accessible name. Disclosure rows must be focusable. Color is never the sole signal (matches the monochrome status rule).

### Frontend forbidden list

- No black-fill solid buttons in product UI.
- No raw hex colors in component code (only design tokens).
- No `font-['Family']` direct family classes (use semantic `font-*` roles).
- No new icon libraries beyond `lucide-react` + Figma payload.
- No `try/catch` swallowing render errors silently — surface to error boundaries with `traceId`.
- No client-side direct writes to Appwrite collections that interviewees can hit. Always go through a Function.

---

## Backend Rules

The backend is a set of cohesive, narrow modules. Each module's responsibility and boundary is described below; cross-module data flows through contracts and Functions, never through shared mutable state.

### Module map and responsibility

| Module | Path | Responsibility | Forbidden |
|---|---|---|---|
| Contracts | `packages/contracts` | zod schemas + TypeScript types for every cross-module shape | no runtime logic, no I/O |
| Contracts mirror | `apps/agent/agent/contracts.py` | pydantic mirror of contracts the agent needs | no fields the TS contract doesn't have |
| Observability | `packages/observability` | `createLogger`, `retry`, `withErrorBoundary`, `traceId` | no business logic, no provider calls |
| Appwrite schema | `packages/appwrite-schema` | declarative collection + permissions + storage buckets, with `apply` / `verify` tooling | no runtime data writes |
| Functions | `apps/functions/<name>` | request → response surfaces; **pure core in `handler.ts`**, thin SDK wrapper in `main.ts` | no shared state across invocations |
| Agent | `apps/agent` | LiveKit Supervisor / TaskGroup / AgentTask realtime interview workflow | no Appwrite writes for turn-by-turn state, no LangGraph control flow |
| Web server runtime | `apps/web/server/*` (planned) | server actions, route handlers, RSC fetchers | no domain logic that belongs in a Function |

### Contracts (`packages/contracts`)

- Source of truth for **every** cross-module shape: entities, API requests/responses, RPC payloads, runtime workflow state.
- Use zod schemas (`*Schema`) plus inferred types (`type Foo = z.infer<typeof FooSchema>`).
- Group by file: `entities.ts` (database / domain entities), `api.ts` (request/response + RPC), `state.ts` (workflow / runtime state shared with the agent).
- Never define a type twice in the codebase. If something is needed in TS and Python, define in TS first, mirror to pydantic in `apps/agent/agent/contracts.py` with the same field names.
- Update the schema **before** the consumer. Renames go: schema → consumers in same PR.

### Observability (`packages/observability`)

- The only allowed logging/retry/error-boundary primitives. Do not write ad-hoc `console.log`, `setTimeout` retries, or `try/catch { return 500 }` shapes inside Functions.
- Every Function entry point is wrapped with `withErrorBoundary(scope, handler)`. The boundary returns `{ok:false, status, error, traceId}` on uncaught error and logs the stack with the same `traceId`.
- `createLogger(scope)` returns a logger with a stable `traceId` for that invocation. Pass the logger explicitly to inner functions; do not rely on a module-level singleton.
- Errors crossing a module boundary must include `traceId` and an explicit error code (`link_not_found`, `link_expired`, `internal_error`). Never include stack traces in client-facing response bodies.

### Functions (`apps/functions/<name>`)

The reference shape is `apps/functions/issueLivekitToken`. Every new Function follows it.

- **Pure core** in `src/handler.ts`: takes `rawInput` and a typed `Deps` interface (no SDK imports), returns a tagged result `{status, body}`. Fully unit-testable with in-memory deps; gets all the property-based tests.
- **SDK wrapper** in `src/main.ts`: instantiates Appwrite/LiveKit SDKs, builds `Deps`, calls the pure core, maps the result to the Appwrite Function response. No business logic here.
- **Deps interface** lists every external effect the handler needs (`findLink`, `createSession`, `signToken`, etc.). One typed function per effect; no broad service objects.
- **Concurrency safety** via deterministic ids. Concurrent claims to the same slot collide on a unique `$id`; the loser retries the next slot or returns the proper error code (see `issueLivekitToken` for the canonical pattern).
- **Validation at the boundary**: parse input with the request schema from `@merism/contracts` immediately on entry. Reject malformed input with `400 invalid_input` before any side effects.
- **Rollback**: if a side effect fails after another succeeded (e.g. room created, token signing fails), roll back the earlier effect. The cleanup must be best-effort and never throw out of the boundary.
- **Permissions**: anonymous interviewees never get direct collection writes. Functions are the only path. Apply Appwrite execution permissions explicitly in the function declaration; do not rely on defaults.
- **Secrets**: read from environment in `main.ts`. Never log them. The pure core never sees raw secret strings.

### Appwrite schema (`packages/appwrite-schema`)

- Declarative: collections, attributes, indexes, permissions, and storage buckets are declared as data, applied by tooling.
- `apply` is **idempotent and non-destructive** by default. Diff first, apply additions/changes, never drop data unless the operator passes a destructive flag.
- `verify` is read-only: confirms the live Appwrite state matches the declaration, prints a diff, exits non-zero on mismatch. Used in CI.
- Permission grants follow the principle of least privilege: each collection grants exactly the role/team needed. Anonymous role gets read-only on a narrow set, never write.
- Storage buckets carry MIME-type and size restrictions matching the declared use (e.g. recordings: audio MIME, max size).

### Agent (`apps/agent`)

- Realtime interview controller is **LiveKit Supervisor + ordered TaskGroups + focused AgentTasks**. No LangGraph, no custom state machines.
- Per-session state lives on the agent instance. Do not share mutable state across sessions.
- Persisted artifacts (transcript segments, recordings, final answers) flow out of the agent into Appwrite collections via Functions, never via direct SDK writes from the agent process.
- Pydantic models in `agent/contracts.py` mirror `packages/contracts`. Field names are identical. The mirror only contains schemas the agent actually uses.
- The realtime extra is opt-in: `uv sync --extra realtime`. Foundation tests must run without it. Do not move realtime imports to module top-level.
- Logging uses `agent.logging.create_logger(scope)`, mirrors the TS observability shape (`scope`, `traceId`, structured fields).

### Provider adapters (LLM, ASR, TTS)

- Every provider lives behind a narrow interface defined in TS contracts (or Python protocol). The adapter implements one provider; swapping providers means writing a new adapter, not editing call sites.
- **DeepSeek** is the only LLM. **Qwen** is reserved for ASR/TTS. Changing either requires a new ADR in `docs/adr/`.
- Provider failures use explicit error types. Retries go through `packages/observability/retry`, not ad-hoc loops. Backoff and jitter are configured at the call site, not inside the adapter.
- Adapters never log raw prompts or generated text at info level — those go to debug only, gated by an env flag, never enabled in production.

### Realtime ↔ persistence boundary (binding)

- Turn-by-turn interview state, partial transcript, audio buffers, and ephemeral agent variables stay **inside the LiveKit room** (room metadata + participant attributes + RPC).
- Only **finalized artifacts** cross into Appwrite: completed transcript, final recording file, finalized answer payload, analysis report. Crossing is one-way, append-only.
- Never round-trip "next question" through Appwrite. The agent computes it from in-memory `InterviewWorkflowState`, advances via Supervisor decisions, and reflects the result on the participant attribute (`merism.interviewState`) for the client to read.

### Backend forbidden list

- No shared mutable state across Function invocations or agent sessions.
- No SDK imports inside `handler.ts` pure cores.
- No `try/catch { /* swallow */ }` patterns. Catch specific errors, propagate or log explicitly.
- No fields, tables, or endpoints outside the contract — define in `packages/contracts` first.
- No raw secret values in logs, response bodies, error messages, or test snapshots.
- No bypass of the function boundary for anonymous interviewees.
- No second LLM provider. No second ASR/TTS provider. Add an ADR if this needs to change.

---

## Scope Guard

Do not introduce fields, collections, functions, UI, dependencies, or docs that imply:

- teams or organizations,
- collaborative editing,
- sharing/commenting,
- billing/subscriptions,
- quotas/plans/seats,
- usage metering.

If a future request appears to require one of these, stop and ask for an explicit architecture update rather than implementing it implicitly.

---

## Commits and Pull Requests

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for every commit message and PR title.

### Commit types

- `feat`: new feature or behaviour (touches production code)
- `fix`: bug fix (touches production code)
- `refactor`: structural change without behaviour change
- `chore`: non-production changes (docs, tests, config, CI, steering, AGENTS.md)
- `docs`: ADR / sub-spec / README updates
- `test`: test-only changes

### Scope convention

Use the touched module as scope. Single-module changes get a single scope:

- `feat(contracts): add probeConfig.maxRounds`
- `fix(agent): preserve traceId across supervisor failure`
- `chore(steering): tighten errors-and-observability try/catch matrix`
- `feat(functions/issueLivekitToken): test-link bypass for draft surveys`

Multi-module changes use the leading module's scope and call out the rest in the PR description's data-flow sketch (per `pre-implementation.md`).

### Format

```
<type>(<scope>): <description>
```

Rules:

- First line under 72 characters.
- Description lowercase, no trailing period.
- Use American English spelling.
- No "AI:" / "agent:" / "GPT:" / "Claude:" attribution in commit messages.

Examples:

- ✅ `feat(interview): persist quality flags after analyzeSession`
- ✅ `fix(contracts): mutex check for silent vs deep-engagement`
- ❌ `Update some files` — no type, no scope
- ❌ `feat(interview): added quality flags.` — uppercase + period
- ❌ `feat: AI added this fix per user request` — attribution

### PR descriptions

Non-trivial PRs MUST include the **investigation deliverable** from `pre-implementation.md`:

- A short data-flow sketch (ASCII or mermaid) showing the touched chain.
- The list of upstream/downstream callers found via LSP `find_references`.
- Links to the GitHub reference implementations consulted, plus a one-liner per reference describing the difference.
- Alternatives considered and rejected, with one-line reasons.

Trivial PRs (single-line typo, doc fix, dependency bump under stable contract) MAY skip this.

### Push discipline

- Do NOT push to remote until the task is complete or you need someone else to review.
- Batch local commits and push once. Pushing after every change burns CI runner time and creates noisy PR notifications.
- NEVER push directly to `main` / `master`. Branch workflow only, via PR.

### Public repository hygiene

This repo is private today but treat every commit as if the repo could be open-sourced tomorrow:

- No customer names, real interviewee data, or production tokens in commit messages or code.
- No internal-only tool names (`.env` paths from a specific deploy, internal Slack channel names) in commits.
- If sensitive context is needed for the change rationale, summarize at high level in the PR description (which lives in our PR system) rather than in the commit body.

---

## CI guardrails

CI runner time is a budgeted resource. Treat every CI run as if it costs money — because at scale it does.

- Every workflow file under `.github/workflows/*.yml` MUST declare `timeout-minutes` on every job. A stuck job without timeout is a defect.
- Workflow changes hit every in-flight PR immediately (the workflow runs against PR-merged-with-main), but companion changes (a new dependency, a new file, a new env var) only reach a branch once it rebases. **Workflow edits MUST stay backwards-compatible with unrebased branches** — gate new behaviour with a feature toggle or graceful no-op when the prerequisite is missing.
- Do NOT push every commit. Batch locally; push once when the task is complete or when you need an extra reviewer. (Repeat from "Push discipline" above because this rule is the most violated.)
- A PR is not ready to merge until `pnpm test && pnpm typecheck && pnpm test:py && pnpm scope-guard` all pass locally. Don't rely on CI to find what these would catch on your laptop.
- When tests are flaky in CI, fix the test or quarantine it explicitly with a tracking issue. Re-running CI hoping it passes is a defect, not a workflow.

---

## Engineering skill lifecycle (addyosmani/agent-skills)

The addyosmani/agent-skills library is installed under `~/.agents/skills/` and provides production-grade engineering workflows. The agent MUST follow this lifecycle for every non-trivial engineering task:

### Core rules

- If a task matches an engineering skill, invoke it before writing code.
- Never implement directly if a skill applies.
- Follow the skill instructions exactly — do not partially apply them.
- Skills are loaded from `skills/<skill-name>/SKILL.md`.

### Intent → Skill mapping

| User intent | Skill(s) |
|---|---|
| Build a feature / new functionality | `spec-driven-development` → `incremental-implementation` + `test-driven-development` |
| Plan / break down work | `planning-and-task-breakdown` |
| Fix a bug / unexpected behavior | `debugging-and-error-recovery` |
| Review code / PR | `code-review-and-quality` |
| Refactor / simplify | `code-simplification` |
| Design an API or interface | `api-and-interface-design` |
| Build UI / frontend | `frontend-ui-engineering` |
| Performance work | `performance-optimization` |
| Security work | `security-and-hardening` |
| Ship / deploy | `shipping-and-launch` |
| Manage git / commits | `git-workflow-and-versioning` |

### Lifecycle stages

- **DEFINE** → `spec-driven-development`
- **PLAN** → `planning-and-task-breakdown`
- **BUILD** → `incremental-implementation` + `test-driven-development`
- **VERIFY** → `debugging-and-error-recovery`
- **REVIEW** → `code-review-and-quality`
- **SHIP** → `shipping-and-launch`

### Mandatory skill invocation

The general lifecycle above is the default. The table below names **specific
trigger conditions** where a skill MUST be loaded before the first non-trivial
edit. These are the areas where prose-only nudging has historically failed —
documenting them as a hard rule reduces drift. Borrowed in shape from
`/home/jia/posthog/AGENTS.md` § Mandatory skill invocation; the trigger
list is MerismV2-specific. Source spec:
`.kiro/specs/robustness-hardening/` REQ-5.

**Always invoke** before the first edit in a session that touches these paths:

| Touch this | Invoke this skill |
|---|---|
| `packages/contracts/src/*.ts` | `spec-driven-development` + `pre-implementation` |
| `apps/functions/*/src/handler.ts` | `incremental-implementation` + `test-driven-development` |
| `apps/agent/agent/interview/{workflow,supervisor,engine}.py` | `debugging-and-error-recovery` (hot path; mistakes here break live interviews) |
| `.github/workflows/*.yml` | `ci-cd-and-automation` |
| `apps/web/lib/assistant/tools/*.ts` | `api-and-interface-design` (Morris tool surface is a public contract) |
| `apps/web/lib/assistant/access-control.ts` | `security-and-hardening` (workspace ACL gate) |
| `apps/web/components/**/*.tsx` (new component) | `frontend-ui-engineering` |
| `docs/adr/*.md` (new ADR) | `documentation-and-adrs` |
| `.semgrep/rules/*.yaml` (new rule) | `code-review-and-quality` (the rule IS a review rule) |
| `tests/evals/**` | `test-driven-development` + `code-review-and-quality` (corpus governance) |

**Invoke when in the area** (softer triggers — judgment call, but stated so the call is explicit):

| Activity | Invoke this skill |
|---|---|
| Investigating a bug | `debugging-and-error-recovery` |
| Reviewing a PR | `code-review-and-quality` |
| Refactoring without behavior change | `code-simplification` |
| Performance work | `performance-optimization` |
| Pre-launch / deploy | `shipping-and-launch` |
| Writing a new sub-spec | `spec-driven-development` |
| Triaging a flaky test | `test-driven-development` + `debugging-and-error-recovery` |

**Skill gaps** (referenced above but not present in `~/.agents/skills/` today
— track here so we don't silently invent them):

- (none currently — all skills above exist as of 2026-06-30)

If a skill in the **Always invoke** table is not loaded before the change,
the PR description's "Agent context" line MUST explain why. This is enforced
in review, not by CI.

### Anti-rationalization

The following thoughts are incorrect and must be ignored:

- "This is too small for a skill"
- "I can just quickly implement this"
- "I'll gather context first then decide"

Correct behavior: always check for and use skills first. When in doubt, invoke `using-agent-skills` to map the intent to the right skill.

---

## Automation hierarchy

When enforcing a new convention, prefer the highest-strength tool that fits. Climb DOWN this ladder only when the higher rung does not apply:

1. **Steering** (`.kiro/steering/*.md`, always-loaded). For binding cross-cutting rules every agent must obey every turn (architecture boundaries, contracts, errors, testing, scope, design system).
2. **CI checks** — automated gates that block merge:
   - `pnpm typecheck` + `pnpm -F @merism/contracts typecheck` for type drift
   - `pnpm test` + `pnpm test:py` + `pnpm test:properties` for behaviour invariants
   - `pnpm lint` (ESLint) for style
   - `pnpm scope-guard` for forbidden product-shape concepts
   - `pnpm schema:verify` for Appwrite drift
   - `pnpm semgrep` (AST patterns) for binding steering rules — see `.semgrep/README.md`
   - `pnpm deps:cruise` (dependency-cruiser) for module-graph boundaries — see `docs/architecture/module-boundaries.md`
   - Targeted `grep -RIn ...` rules in CI for the patterns documented in steering
3. **Module AGENTS.md** (`packages/*/AGENTS.md`, `apps/*/AGENTS.md`). Per-module rules and gotchas that don't generalize. Loaded on demand, enforced by reviewer.
4. **Sub-spec / ADR**. Architectural decisions that are too narrow for steering or change too rarely to live in CI.

Adding a new rule:

- If the rule is testable mechanically → make it a CI check first.
- If the rule applies everywhere → write it in steering, link it from a CI check.
- If the rule applies to one module → write it in that module's `AGENTS.md`.
- If the rule is a one-off architectural decision → write an ADR.

A rule that lives only in code review notes will eventually be ignored. Promote it to one of the four levels above.

---

## Code style: forbidden comment patterns

In addition to the comment guidance in `.kiro/steering/architecture.md` (comments explain non-obvious decisions, default to ASCII):

- No `// AI:` / `// agent:` / `// GPT:` / `// Claude:` attribution comments in code. Attribution belongs in commit messages, not in source.
- No change-history comments in code: never write `// previously did X, now does Y`, `// per PR #123`, `// changed because foo`, `// AI rewrote this`. Change history lives in commit messages and PR descriptions.
- When refactoring or moving code, preserve existing comments unless they are explicitly made obsolete by the change.
- Comments should explain **why** (non-obvious decisions, invariants, tradeoffs), not **what** (the code already shows what).
- Default to short / one-line comments. Multi-line comments are reserved for non-obvious invariants (rollback semantics, concurrency notes, ADR pointers).

# Requirements Document

## Feature: morris-agent-hardening（Morris 研究助手 Agent 加固）

## Introduction

本需求文档对应 Spec **morris-agent-hardening**，目的是把 Morris 页面助手（Vercel AI SDK 6 `ToolLoopAgent` + DeepSeek，参见 `docs/adr/0002-page-assistant-vercel-ai-sdk.md`）从"能跑通"升级到"长会话稳定 / 工具调用准确 / 失败可观测 / 可安全引入写工具"。

借鉴对象是 PostHog 的 `ee/hogai`（Python + LangGraph 栈）中工程上已经踩过坑的若干约定，但本 Spec **不引入新框架**：所有改造落在 `apps/web/lib/assistant/*` 与 `apps/web/app/api/assistant/route.ts` 之内，仍然使用 `ToolLoopAgent` / `tool({...})` / `prepareStep` / `stopWhen` / `createAgentUIStreamResponse` / `@ai-sdk/react useChat`。

本 Spec 包含 8 项加固，不含 hogai 的 ModeManager 与 Subagent 模式（这两项更适合在 Morris 工具集合膨胀到一定规模、或出现明确"跨调研复合分析"诉求时再单独立 Spec）。

## Prerequisite

- `foundation-setup/design.md §Components and Interfaces`（`@merism/contracts` / `@merism/observability` / Functions 边界等）。
- `analysis-report/design.md`（已落地的 `apps/web/lib/queries/*` 读出层与 Morris 当前可调用的 4 个工具：`listStudies` / `searchInterviewData` / `analyzeData` / `createStudyDraft`）。
- `docs/adr/0002-page-assistant-vercel-ai-sdk.md`（Morris 的栈与目录约定；本 Spec 不变更其结论）。
- `.kiro/steering/design-system.md`（Mauve Quiet；本 Spec 涉及 UI 改动时遵循）。
- 借鉴来源（仅作参考实现，不直接依赖代码）：`/home/jia/posthog/ee/hogai/`，重点是 `tool.py`、`PROMPTING_GUIDE.md`、`utils/exceptions.py`、`core/agent_modes/compaction_manager.py`、`tools/todo_write.py`、`core/runner.py` 中 `interrupt(ApprovalRequest)` 的 approval 流。

## Glossary

| 术语 | 含义 |
|---|---|
| **Morris** | 研究员页面助手的产品名（`apps/web/app/api/assistant/route.ts` + `lib/assistant/*` + `components/assistant/*` + `/assistant`）。 |
| **ToolResultEnvelope** | Morris 工具统一返回的 `{ content: string, artifact: T \| { error: true, message } }` 形状。`content` 给模型解读，`artifact` 给 UI 卡片与后续工具串联。 |
| **PageContext** | 客户端在每次请求随 `useChat` body 提交的"研究员当前页面状态"对象（如 `path` / `surveyId` / `sessionId` / `selectedSegmentIds`），由路由层喂给已 mount 的工具的 `contextPromptTemplate`。 |
| **contextPromptTemplate** | 单个工具声明的 mustache 风格模板字符串，由路由层在每次请求时用 PageContext 渲染并拼接到 system prompt 末尾，用于显式告诉模型"此刻该不该用我、用我时该传什么参数"。 |
| **MorrisError** | Morris 内部的 LLM 错误分类联合体（`client` / `transient` / `api` / `transport` / `unknown`），用于把 provider/network 错误翻译为用户文案 + 计数器标签。 |
| **CompactionPlan** | 对话压缩纯函数 `planCompaction(messages, budget)` 的输出：要丢弃哪些旧消息、要插哪条 `summary` system message、是否需要追加 `todoReminder`。 |
| **TodoWrite Tool** | 元工具，让 Morris 在多步任务中维护一份显式 todo 列表，每次写都覆盖会话级 `todos: TodoItem[]`，并把它渲染回下一步的 system prompt。 |
| **ApprovalEnvelope** | 危险工具返回的 `{ status: 'pending_approval', proposalId, toolName, preview, payload }` 形状；前端展示确认卡片，确认后客户端再发一次 `confirmTool` 请求才真正执行。 |

## Scope

**包含**：

1. 工具结果双通道协议（ToolResultEnvelope）的类型与运行时校验，把现有 4 个工具收齐。
2. PageContext + 工具 `contextPromptTemplate` 注入机制（路由层渲染 → system prompt 末尾拼接）。
3. 系统提示词结构化（XML 段 + 静态在前 / 动态在后，prompt cache 友好）。
4. LLM 错误分类四档（client / transient / api / transport）+ 用户文案 + 计数器（先用进程内计数器接口，后续若上 OTel/Prom 再注入实现）。
5. 工具错误的模型行为协议（在 system prompt 强化"verify, don't guess" 与"看到 artifact.error 不要假装成功"）。
6. 对话压缩 `planCompaction` 与 `applyCompaction` 纯函数，替代 `prepareStep` 里现有的硬截断（`messages.length > 24 → slice(-16)`）。
7. TodoWrite 元工具骨架与 prompt 注入（一个会话级 `todos` 状态 + 一个 `todoWrite` 工具 + system prompt 末尾的 `<current_todo>` 段）。
8. 危险操作 Approval 框架（不接任何具体写工具，只放工具协议骨架 + 路由层 `confirmTool` 端点 + 前端确认卡片占位组件）。

**排除**：

- 不引入 ModeManager（按页面切换 toolkit + prompt 的能力，留待 Morris 工具集合明显膨胀后单独立 Spec）。
- 不引入 Subagent / Subgraph（跨调研复合分析等场景另起 Spec）。
- 不替换或新增 LLM provider（DeepSeek 仍是唯一 LLM；Approval 框架不调用任何具体写 Function）。
- 不改 LiveKit 语音 Agent 的提问 task（Supervisor / TaskGroup 可在后续单独 Spec 借鉴 PROMPTING_GUIDE 的"静态在前"，本 Spec 仅聚焦 Morris）。
- 不动 Appwrite schema 与 `@merism/contracts` 的现有契约（Morris 工具的 envelope 是 web 内部协议，不上升到 cross-module 契约）。
- 不引入对话历史持久化（仍由前端 `useChat` 维护；Morris 不写 `conversation` collection）。

## Requirements

### Requirement 1: 工具结果双通道协议（ToolResultEnvelope）

**User Story:** 作为 Morris 维护者，我需要每个工具都返回统一的 `{ content, artifact }` 形状（且失败时 `artifact.error === true`），以便模型解读与 UI 渲染各取所需，且失败永远不会被悄悄当成成功。

#### Acceptance Criteria

1. WHEN 任意工具的 `execute` 返回 THEN 返回值 SHALL 满足 `ToolResultEnvelope<TArtifact>`：`content: string` 非空；`artifact` 要么是工具自身的成功结构，要么是 `{ error: true; message: string }`。
2. WHEN 工具执行抛异常 THEN 工具 SHALL 在 `execute` 内 `try/catch` 把异常转为 `toToolError(label, err)`，绝不让异常向 ToolLoopAgent 冒泡（保持模型上下文里始终是 envelope）。
3. WHEN 未登录用户调到需要 `ownerUserId` 的工具 THEN 工具 SHALL 短路返回 `NOT_SIGNED_IN` 形态的 envelope（与现有约定一致），不读任何数据。
4. WHERE 类型层 THEN `ToolResultEnvelope<T>` 与 `ToolErrorArtifact` SHALL 在 `apps/web/lib/assistant/envelope.ts` 提供，所有 `lib/assistant/tools/*` 通过它构造结果；不再允许工具自由返回结构。
5. WHEN 运行 `pnpm -F web typecheck` THEN 全仓 SHALL 通过（contracts-first 不需要，但 web 类型必须收紧）。

### Requirement 2: 工具上下文注入（PageContext + contextPromptTemplate）

**User Story:** 作为研究员，我希望坐在 `/studies/[id]` 时跟坐在 `/reports/[surveyId]` 时，Morris 调用工具的准确率不一样：它应该知道我在哪个页面、看哪个对象，从而准确选工具与传参。

#### Acceptance Criteria

1. WHEN 客户端 `useChat` 发起请求 THEN 请求体 SHALL 同时携带 `messages` 与 `pageContext: PageContext`；`pageContext` 由当前路由的 RSC/客户端组件注入（默认形状见 design.md §5.1）。
2. WHEN 路由层 `route.ts` 接到请求 THEN 路由层 SHALL 用 `PageContextSchema.safeParse` 校验 `pageContext`；校验失败 SHALL 视为 `pageContext = {}` 继续（不把整次请求 400 掉），但记一条 `warn` 日志。
3. WHERE 工具声明 `contextPromptTemplate` THEN 路由层 SHALL 用 `pageContext` 中可用键渲染该模板（mustache 风格 `{key}`），缺键填 `None` 并 `warn` 一行；渲染结果按工具名拼成 `<tool_context>` 段，加到 system prompt 末尾。
4. WHEN 拼接 system prompt THEN 静态指令段 SHALL 在前、动态 `<tool_context>` SHALL 在后（与 R3 一致，保 prompt cache 友好）。
5. WHEN 现有 4 个工具被改造 THEN 至少 `searchInterviewData`、`analyzeData` SHALL 声明非空 `contextPromptTemplate`（前者用 `pageContext.surveyId` 提示默认参数；后者用 `pageContext.surveyId` 与最近 `pageContext.recentSessionIds` 提示是否值得调）；`listStudies` 与 `createStudyDraft` 可不声明。
6. WHERE 客户端未登录或路由无 PageContext THEN 工具仍可被调用（按各自 fallback），但渲染出的 `<tool_context>` 段 SHALL 为空字符串而不是 `undefined` / `null`。

### Requirement 3: 系统提示词结构化（XML 段 + 静态在前 / 动态在后）

**User Story:** 作为 Morris 维护者，我需要 system prompt 被切成可解析的小段并保证静态部分稳定在前，以便（a）模型在多任务中读懂段意；（b）DeepSeek 端的 prompt cache 能命中、降低长会话成本。

#### Acceptance Criteria

1. WHEN 路由层组装 system prompt THEN prompt SHALL 由以下段顺序拼成（静态在前）：`<agent_info>` → `<tools_overview>` → `<workstyle>` → `<style>` → `<error_protocol>` → `<current_todo>` → `<page_context>` → `<tool_context>`。
2. WHEN 没有 todo / 没有 PageContext / 没有工具特定 context THEN 对应段 SHALL 整段省略（不发空标签），且静态段顺序与文本不变。
3. WHERE 静态段 THEN 文本 SHALL 来自 `apps/web/lib/assistant/system-prompt.ts` 的常量；动态段 SHALL 由路由层渲染。
4. WHEN 段内含可能含花括号的代码或路径 THEN 拼接器 SHALL 对静态段不做模板替换（`<page_context>` 与 `<tool_context>` 内的渲染只对 `{key}` 形式做替换，且只处理 ASCII 标识符 `[A-Za-z_][A-Za-z0-9_]*`），避免误替换正常文本。
5. WHEN 同一会话连续多次请求 THEN 静态段的字节序列 SHALL 完全一致（不含时间戳/随机串），以满足 prompt cache 命中前提。

### Requirement 4: LLM 错误分类与可观测

**User Story:** 作为 Morris 维护者，我需要把 DeepSeek / 网络层错误分成"重试有用 vs 重试无用"，分别给出用户文案与计数器标签，以便定位"是模型挂了 / 网络挂了 / 用户对话太长"等不同情况。

#### Acceptance Criteria

1. WHEN 路由层 `onError` 收到错误 THEN 路由层 SHALL 调 `classifyMorrisError(err): MorrisError`，返回值在 `client | transient | api | transport | unknown` 中且五类互斥。
2. WHERE `client` THEN 文案 SHALL 形如"对话过长或参数无效，请新建对话"（4xx / 422 / "context length" 等模式）。
3. WHERE `transient` THEN 文案 SHALL 形如"AI 服务暂时不可用，请稍后重试"（429 / 5xx / timeout / DeepSeek 暂态）。
4. WHERE `api` THEN 文案 SHALL 形如"AI 服务鉴权或配置失败"（401 / 403 / 模型不存在 / API key 错误）。
5. WHERE `transport` THEN 文案 SHALL 形如"网络连接不稳定，请稍后重试"（fetch failed / ECONNRESET / ETIMEDOUT 等）。
6. WHEN 分类完成 THEN Morris SHALL 同步对一个进程内 `MorrisErrorCounter` 接口 `inc({ kind })`；该接口的实现允许在本 Spec 内是内存计数（`apps/web/lib/assistant/metrics.ts` 暴露 `getCounts()`），后续若上 Prom/OTel 再注入。
7. WHERE 任一文案 THEN 文案 SHALL 不含原始错误堆栈、API key、provider 名称等敏感信息。
8. WHEN 现有 `route.ts::onError` 的"apikey/rate limit/timeout"粗分被替换 THEN 替换 SHALL 保持向后兼容（同等情景下文案可不完全一致，但分类决策必须比旧版细）。

### Requirement 5: 工具错误的模型行为协议

**User Story:** 作为研究员，当 Morris 的某次工具调用失败时，我希望 Morris 不要假装成功胡编结果，而是告诉我哪里失败、给我下一步建议。

#### Acceptance Criteria

1. WHERE system prompt THEN `<error_protocol>` 段 SHALL 写明：（a）`artifact.error === true` 时禁止把字段当真值用；（b）应向用户用一句话说明失败 + 给出下一步建议（换关键词 / 稍后重试 / 先调 listStudies 验证 id）；（c）禁止臆造 surveyId / sessionId / 受访者原话。
2. WHERE system prompt THEN `<error_protocol>` 段 SHALL 写明 verify-don't-guess 原则：当用户提到具体调研但参数缺失或可疑时，先调 `listStudies` 验证再决定参数。
3. WHEN 工具返回 `pending_approval` 形态（见 R8） THEN 模型 SHALL 在该步直接停止生成（由 stopWhen 与 envelope 协议保证），不在同一 turn 再发用户消息或继续推理。
4. WHEN 工具同步多次失败（同 turn 同工具 ≥2 次） THEN 模型 SHALL 不再第三次调用同一工具，转而向用户解释（由 prompt 协议表述；不通过运行时硬性拦截，但本要求落到 prompt 文案中）。

### Requirement 6: 对话压缩替代硬截断

**User Story:** 作为研究员，我希望长会话不再被粗暴截断（现有 `messages.length > 24 → slice(-16)` 会丢早期上下文），而是先尝试"摘要"再"丢弃"，让早期对话仍以摘要形式可用。

#### Acceptance Criteria

1. WHERE `apps/web/lib/assistant/compaction.ts` THEN `planCompaction(messages, opts): CompactionPlan` SHALL 是纯函数，输入 `messages: UIMessage[]` 与 `opts: { tokenBudget: number; minKeepTurns: number }`，输出告诉调用方"丢哪些 / 保哪些 / 是否需要调用 `summarizeMessages`"。
2. WHEN 估算 token 数低于 `tokenBudget` 或 `messages` 仅含 ≤ `minKeepTurns` 个 human turn THEN `plan.action` SHALL 为 `noop`（不丢弃，不摘要）。
3. WHEN 估算 token 数超过阈值 THEN `plan.action` SHALL 为 `compact`，给出 `keep: UIMessage[]`（保留尾部 N 轮）与 `dropped: UIMessage[]`（其余），以及 `needSummary: true`。
4. WHEN `plan.needSummary === true` THEN `applyCompaction(plan, summarizer)` SHALL 调用 `summarizer(dropped) -> string` 一次，把摘要插成一条 `system` role 的 `UIMessage` 放在 `keep` 之前。
5. WHEN 摘要失败 THEN `applyCompaction` SHALL 退化为"只丢弃不摘要"，并把一条简短 `system` 消息（"早期对话已省略"）放在 `keep` 之前；不抛异常给 ToolLoopAgent。
6. WHERE token 估算 THEN 估算函数 SHALL 是纯函数（字符数 / 4 的 hogai 风格估算可接受），不调用任何 LLM API，并且不会抛异常。
7. WHEN `agent.ts::prepareStep` 集成压缩 THEN 现有 `messages.length > 24 → slice(-16)` 的硬截断 SHALL 被移除并替换为 `applyCompaction` 的调用；摘要 LLM 调用走 `deepseek-chat` 且温度 ≤ 0.3。
8. WHEN 摘要被插入 THEN 后续若 `todos`（R7）非空，`<current_todo>` 段 SHALL 仍由 system prompt 拼接器在 system prompt 内呈现（即 todo 状态不依赖被摘要的消息），保证摘要后模型仍知道当前任务进度。

### Requirement 7: TodoWrite 元工具

**User Story:** 作为研究员，当我让 Morris "帮我把这三个调研对比一下并生成草稿"这种多步任务时，我希望它能把"已完成 / 进行中 / 待办"显式写出来，避免步走丢。

#### Acceptance Criteria

1. WHERE `apps/web/lib/assistant/tools/todo-write.ts` THEN 工具 `todoWrite` SHALL 接受 `{ todos: TodoItem[] }`，整体覆盖（不增量）当前会话的 todo 列表。`TodoItem` 字段：`id: string`、`title: string`、`status: 'pending' | 'in_progress' | 'done'`、可选 `note: string`。
2. WHEN 工具被调用 THEN `todoWrite` SHALL 通过 `state` 通道（见 design.md §10）把新的 `todos` 数组保存到 ToolLoopAgent 的 per-request 内存状态，并以 `ToolResultEnvelope`（`content` 概述 + `artifact: { todos }`）返回。
3. WHEN 同一请求的下一步推理开始 THEN system prompt SHALL 在 `<current_todo>` 段渲染当前 `todos`（每条一行 `- [STATUS] title`），todos 为空时整段省略。
4. WHEN 多步任务结束（最后一条 assistant 消息无新工具调用，stop 条件触发） THEN `todos` 状态 SHALL 仅在本次请求内有效，下次新请求不携带（因为 per-request agent 实例已被丢弃）。
5. WHEN 提示词协议 THEN system prompt 的 `<workstyle>` 段 SHALL 提示模型："对≥3步的任务，先 `todoWrite` 列出步骤；每完成一步，再 `todoWrite` 把该项标 `done` 并把下一项标 `in_progress`"。
6. WHERE 工具集合 THEN `todoWrite` SHALL 是元工具（不读 Appwrite，不依赖 `ownerUserId`），未登录用户也可使用（但其他读工具仍按 R1 短路）。

### Requirement 8: 危险操作 Approval 框架（骨架）

**User Story:** 作为平台维护者，我需要为 Morris 将来的写工具（survey-editor 子 spec 引入的 `editQuestion / deleteSection / publishSurvey` 等）准备一条"二次确认"通道，使得任何写操作都不会在用户没明确同意的情况下落库。本 Spec 只搭骨架，不接具体写工具。

#### Acceptance Criteria

1. WHERE `apps/web/lib/assistant/approval.ts` THEN SHALL 提供 helper `proposeApproval({ toolName, preview, payload }): ApprovalEnvelope`，工具 `execute` 可在"判定为危险且未携带 approvalToken"时直接 `return proposeApproval(...)`。
2. WHERE `ApprovalEnvelope` THEN 形状 SHALL 为 `{ status: 'pending_approval'; proposalId: string; toolName: string; preview: string; payload: Record<string, unknown>; createdAt: string }`；`proposalId` 为本机 UUID，`payload` 是该工具被批准后再执行所需的全部入参（脱敏后）。
3. WHEN 工具返回 `pending_approval` 形态 THEN ToolLoopAgent 的当前 step SHALL 通过 `stopWhen` 的一个新条件 `hasPendingApproval` 终止，避免模型继续向后推理。
4. WHERE 路由层 THEN 同一 `app/api/assistant/route.ts` 文件（或同目录新增 `confirm/route.ts`，由 design 决定）SHALL 暴露一个 `POST /api/assistant/confirm` 端点，接受 `{ proposalId, decision: 'approve' | 'reject', edits?: Record<string, unknown> }`，由前端在用户点确认/拒绝时调用；本 Spec 中该端点先返回 `501 not_implemented_yet`（仅占位 + Schema 校验），具体写动作留给消费端 Spec（如 survey-editor）落地。
5. WHERE 前端 THEN `apps/web/components/assistant/approval-card.tsx` SHALL 是占位组件，能从 ToolResult 流里识别 `pending_approval` 形态并渲染"批准 / 拒绝 / 反馈"骨架（按 Mauve Quiet 系统：primary 用 mauve，destructive 用 outline + Dialog 二次确认）。
6. WHEN 用户拒绝 THEN 前端 SHALL 把 `decision: 'reject'` 与可选 `feedback` 通过 `confirm` 端点提交（即使端点暂未实现写动作，骨架也必须存在，便于消费端 Spec 一接就跑）。
7. WHEN 该 Spec 内任何工具被分类为"危险" THEN 该工具 SHALL 不存在（本 Spec 不引入危险工具）；未来由消费端 Spec 决定。

### Requirement 9: 验证

#### Acceptance Criteria

1. WHEN 提交前 THEN SHALL 通过 `pnpm typecheck`、`pnpm -F web build`、`pnpm scope-guard`、`pnpm test`、`pnpm test:properties`。
2. WHEN 实现 P-AI-01 / P-AI-02 / P-AI-03 / P-AI-04 / P-AI-05 THEN SHALL 在 `tests/properties/morris-agent-hardening/` 放可执行 PBT。
3. WHERE `apps/web/lib/assistant/__tests__/` THEN SHALL 覆盖：envelope 校验、prompt 拼接（顺序与省略）、错误分类（每类至少 2 个样本）、`planCompaction` 边界（noop / compact / 摘要失败回退）、`todoWrite` 状态写入、approval 提案的字段完整性。
4. WHERE 路由层端到端 THEN SHALL 在 `apps/web/app/api/assistant/__tests__/`（或等价位置）覆盖：合法 PageContext / 非法 PageContext / 错误分类映射的实际响应文案。
5. WHEN 本 Spec 范围内的任何代码改动落地 THEN ADR-0002 的结论 SHALL 不变（Morris 仍是 ToolLoopAgent + DeepSeek，不引入新框架）。

## Correctness Properties（本 Spec 拥有）

- **P-AI-01 — 工具结果 envelope 不变量**：对任意工具的任意 `execute(args)` 结果，返回值都满足 `ToolResultEnvelope<TArtifact>`；失败路径必有 `artifact.error === true` 且 `artifact.message` 非空；成功路径必无 `error` 字段。PBT 用 fast-check 生成随机 args 与随机内部异常注入。
- **P-AI-02 — Prompt 段顺序不变量**：对任意 PageContext × 任意 todos × 任意工具子集，`buildSystemPrompt(...)` 输出的字符串中静态段顺序固定（按 R3 列出顺序），缺省段不出现空标签；动态段（`<page_context>` 与 `<tool_context>`）一定排在静态段之后。PBT 验顺序。
- **P-AI-03 — 压缩单调性**：对任意输入 `messages`，`applyCompaction(planCompaction(messages, opts))` 的输出 `messages'` 满足：`tokens(messages') ≤ tokens(messages)`；保留的 `keep` 严格是 `messages` 的尾部连续子序列；若插入了摘要消息，它的 role 为 `system` 且位置紧接 `keep` 之前。
- **P-AI-04 — 错误分类互斥覆盖**：`classifyMorrisError` 对预设错误样本表（≥20 例覆盖 4xx/5xx/timeout/transport/auth/unknown）的输出落入 `client | transient | api | transport | unknown` 中且每个样本恰好命中一类。
- **P-AI-05 — Approval 不可绕过**：当某工具的 `execute` 返回 `pending_approval` 形态，ToolLoopAgent 在该 step 不再产生新的工具调用或 user-visible 文本（由 stopWhen 的 `hasPendingApproval` 条件保证）；下一次请求若不携带匹配 `proposalId` 的 approve 决策，则该工具的"实际写动作"不被触发（在本 Spec 中通过对消费端的 contract 描述与 confirm 端点的 schema 校验体现）。


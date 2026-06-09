# Implementation Plan — morris-agent-hardening

每个任务保持 `pnpm typecheck` 绿、可独立提交与回退。所有改动落在 `apps/web/lib/assistant/*` 与 `apps/web/app/api/assistant/*`，不涉及 Appwrite schema、契约 package、agent worker。

## Wave A — 工具协议巩固（R1）

- [ ] **T1** 新增 `apps/web/lib/assistant/envelope.ts`：导出 `ToolErrorArtifact` / `ToolResultEnvelope<T>` / `toolResult` / `toToolError` / `NOT_SIGNED_IN`（frozen 单例）。把 `lib/assistant/tools.ts` 中既有等价类型的实现切到新模块（保持外部 export 兼容，便于 Wave 之间过渡）。

- [ ] **T2** 把现有 `lib/assistant/tools.ts` 中的 4 个工具拆到 `lib/assistant/tools/{list-studies,search-interview-data,analyze-data,create-study-draft}.ts`，每个文件导出形如 `buildXxxTool(ctx): { contextPromptTemplate?: string; spec: ToolSpec }` 的工厂；`tools.ts` 改为聚合导出（`buildAssistantTools(ctx)` 返回 `{ [toolName]: ToolSpec }`，并并入 `Record<toolName, contextPromptTemplate>`）。

- [ ] **T3** 收紧工具 `execute` 的返回类型为 `Promise<ToolResultEnvelope<TArtifact>>`；运行 `pnpm -F web typecheck` 修补类型缺口（不应有，因为现状已经返回兼容形状）。

## Wave B — 错误分类与可观测（R4）

- [ ] **T4** 新增 `lib/assistant/errors.ts`：`MorrisErrorKind` 联合 + `MorrisError` 接口 + `classifyMorrisError(err)` 实现（按 design §7.1 优先级）+ `userMessageFor(kind)`。

- [ ] **T5** 新增 `lib/assistant/metrics.ts`：内存计数器实现 + `morrisErrorCounter` 默认实例 + `getCounts` / `resetCounts`（仅暴露给测试）。

- [ ] **T6** 改 `app/api/assistant/route.ts::onError`：把现有"apikey/rate limit/timeout"粗分换为 `classifyMorrisError`，调 `morrisErrorCounter.inc(kind)`，返回 `userMessage`；服务端日志改为 `console.error("[assistant] %s: %s", kind, detail)`，绝不打印原 stack 与 API key。

- [ ] **T7** 单测 `lib/assistant/__tests__/errors.test.ts` 与 `metrics.test.ts`：覆盖四类 + unknown 兜底；计数器加减归零。

## Wave C — PageContext 注入（R2）

- [ ] **T8** 新增 `lib/assistant/page-context.ts`：`PageContextSchema = z.object({...}).strict()`（按 design §5.1）+ 类型 `PageContext` + `buildPageContextSection(ctx)` 把对象渲染为 `<page_context>` 段（key=value 多行；空对象返回空串）。

- [ ] **T9** 新增 `lib/assistant/tool-template.ts`：`renderContextPromptTemplate(template, ctx)` 仅替换 `{[A-Za-z_][A-Za-z0-9_]*}`；缺键填 `None` 并 `console.warn(toolName, missingKey)`；非字符串值用 `JSON.stringify`。

- [ ] **T10** 给现有工具补 `contextPromptTemplate`：
  - `searchInterviewData`：`"当前页面: {path}. 主调研: {surveyId}. 若用户未指定 studyId, 优先用 surveyId."`
  - `analyzeData`：`"当前页面: {path}. 主调研: {surveyId}. 最近会话: {recentSessionIds}."`
  - `listStudies` / `createStudyDraft`：留空（不声明）。

- [ ] **T11** 改 `app/api/assistant/route.ts`：parse 请求体时同时取 `messages` 与 `pageContext`；`PageContextSchema.safeParse` 校验失败 → `pageContext = {}` 并 `console.warn`；按工具集合 + `pageContext` 计算 `toolContexts: { toolName, rendered }[]` 传给 `buildMorrisAgent(ctx)`。

- [ ] **T12** 改 `components/assistant/conversation.tsx`：`useChat({ body: () => ({ pageContext }), ... })`；`pageContext` 从一个 React context（新增 `components/assistant/page-context-provider.tsx`）取，初始值 `{}`，由各使用页面 setter 写入 `surveyId` / `sessionId` 等（本 Wave 仅在 `app/studies/[id]/layout.tsx` 写入 `surveyId` 演示一处；其他页面留 TODO）。

- [ ] **T13** 单测 `__tests__/page-context.test.ts`、`__tests__/tool-template.test.ts`：strict schema 拒绝外溢字段；模板替换 / 缺键 None / 花括号字面不误替换。

## Wave D — Prompt 拼接器（R3 + R5）

- [ ] **T14** 改 `lib/assistant/system-prompt.ts`：把当前的 `SYSTEM_INSTRUCTIONS` 字符串拆为静态 `const`：`AGENT_INFO` / `TOOLS_OVERVIEW` / `WORKSTYLE`（含 R7 的 todoWrite 协议）/ `STYLE` / `ERROR_PROTOCOL`（含 R5 三条）。导出 `buildSystemPrompt({ todos, pageContext, toolContexts })`：按 design §6.1 顺序拼接，缺省段整段省略。

- [ ] **T15** 改 `lib/assistant/agent.ts::buildMorrisAgent`：`instructions` 改为函数 `() => buildSystemPrompt({...})` 以便每步取最新 todos；从 `ctx` 读 `todoState` / `pageContext` / `toolContexts`。

- [ ] **T16** snapshot 测 `__tests__/system-prompt.test.ts`：固定输入下静态前缀字节级稳定（`expect(buildSystemPrompt(...).startsWith(STATIC_PREFIX)).toBe(true)`）；缺省段整段省略；动态段一定排在最后一个静态段之后。

## Wave E — 对话压缩（R6）

- [ ] **T17** 新增 `lib/assistant/compaction.ts`：纯函数 `estimateTokens` / `planCompaction` / 摘要器接口 `Summarizer` / `applyCompaction`；按 design §8 行为规则实现，摘要失败 → `[fallbackSummary, ...keep]`（不抛）。

- [ ] **T18** 新增 `summarizeMessages` 实现：用同一 `deepseek-chat`，温度 0.2，超时 10s（`AbortController`）；提示词模板按 design §8.3。该实现放在 `compaction.ts` 同文件 export，方便测试 mock。

- [ ] **T19** 改 `lib/assistant/agent.ts::makePrepareStep`：移除现有 `messages.length > 24 → slice(-16)` 硬截断，替换为 `applyCompaction(planCompaction(messages, opts), summarizeMessages)`；保留 reasoner 降级路径（与 ADR-0002 一致）。

- [ ] **T20** 单测 `__tests__/compaction.test.ts`：`planCompaction` 三种 action（noop / 阈下 / 阈上）；`applyCompaction` 摘要成功、摘要失败回退、`noop` 引用相等。

## Wave F — TodoWrite 元工具（R7）

- [ ] **T21** 新增 `lib/assistant/tools/todo-write.ts`：`TodoItemSchema` + `buildTodoWriteTool({ todoState })`，`execute` 整体覆盖 todos 并通过 `todoState.set(next)` 写入闭包；返回 `toolResult("已更新 todo (N 项).", { todos })`。

- [ ] **T22** 改 `agent.ts::buildMorrisAgent`：在闭包内维护 `let todos: TodoItem[] = ctx.initialTodos ?? []` 与 `todoState.get/set`；把 `todoState` 传给 `buildAssistantTools` 与 `buildSystemPrompt`；把 `todoWrite` 加入 `tools` 集合。

- [ ] **T23** 改 `system-prompt.ts`：`<workstyle>` 段加入 todoWrite 协议三句（design §9.3）；`<current_todo>` 段实现：todos 为空 → 空串；非空 → `<current_todo>\n- [STATUS] title\n...\n</current_todo>`。

- [ ] **T24** 单测 `__tests__/todo-write.test.ts`：调用前后 `todoState.get()` 反映写入；空 todos 时 `<current_todo>` 段不出现。

## Wave G — Approval 框架（R8 骨架）

- [ ] **T25** 新增 `lib/assistant/approval.ts`：`ApprovalEnvelope` 接口 + `proposeApproval(args)`（生成 `proposalId = crypto.randomUUID()`、`createdAt = new Date().toISOString()`）+ stop 条件 `hasPendingApproval`。

- [ ] **T26** 改 `agent.ts::buildMorrisAgent`：`stopWhen: [stepCountIs(8), budgetExceeded, hasPendingApproval]`。

- [ ] **T27** 新增 `app/api/assistant/confirm/route.ts`：`POST` 接 `ConfirmSchema.safeParse`，校验失败返 `400 invalid_input`，校验通过返 `501 not_implemented_yet`（占位）。

- [ ] **T28** 新增 `components/assistant/approval-card.tsx`：识别工具结果 `artifact.status === "pending_approval"`，渲染卡片骨架（mauve primary 批准 + outline 拒绝 + 二次确认 Dialog）；点击调 `/api/assistant/confirm`；返回 501 时渲染"功能待实施"提示。视觉遵循 `.kiro/steering/design-system.md`。

- [ ] **T29** 单测 `__tests__/approval.test.ts`：`proposeApproval` 字段完整 + UUID 合法 + ISO 时间戳；`hasPendingApproval` 真值表（含 / 不含 `pending_approval` 工具结果各几例）。

## Wave H — 验证

- [ ] **T30** PBT 落 `tests/properties/morris-agent-hardening/`：
  - `envelope-invariant.test.ts`（P-AI-01）
  - `prompt-order.test.ts`（P-AI-02）
  - `compaction-monotone.test.ts`（P-AI-03）
  - `error-classify.test.ts`（P-AI-04，附样本表）
  - `approval-stop.test.ts`（P-AI-05）

- [ ] **T31** 路由层端到端测 `app/api/assistant/__tests__/route.test.ts`：合法 PageContext / 非法 PageContext / DeepSeek 401 模拟 / DeepSeek 429 模拟 → 校验响应文案、计数器自增、不含敏感字符串。

- [ ] **T32** 全量校验：`pnpm typecheck`、`pnpm -F web build`、`pnpm scope-guard`、`pnpm test`、`pnpm test:properties` 全绿。更新 `apps/web/lib/assistant/__tests__/tools.test.ts`（如有破坏点）。

## 依赖波次

```
A(T1→T2→T3) ─┬─ B(T4→T5→T6→T7) ──┐
             ├─ C(T8→T9→T10→T11→T12→T13) ──┐
             │                              ├─ D(T14→T15→T16) ─┐
             │                              │                  ├─ E(T17→T18→T19→T20) ─┐
             │                              │                  │                       ├─ F(T21→T22→T23→T24) ─┐
             │                              │                  │                       │                       ├─ G(T25→T26→T27→T28→T29) ─ H(T30→T31→T32)
             │                              │                  │                       │                       │
             └──────────────────────────────┴──────────────────┴───────────────────────┴───────────────────────┘
```

实操推荐：每个 Wave 完成后跑一遍 `pnpm typecheck && pnpm -F web test`，确保上一波不会回归。Wave H 在合并前一次性把 PBT 与端到端跑完。


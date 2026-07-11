# Implementation Plan — morris-tool-metadata

每个任务保持 `pnpm typecheck` 绿、可独立提交与回退。所有改动落在 `apps/web/lib/assistant/*` 与 `apps/web/components/assistant/tool-results.tsx`，不涉及契约 package、Functions、agent worker、Appwrite schema。

## Wave A — 元数据 schema 与校验（R1）

- [ ] **T1** 新增 `apps/web/lib/assistant/tool-metadata.ts`：
  - 导出 `ToolType` 联合 `"read" | "write" | "draft" | "meta"`（`as const` 单元类型）
  - 导出 `ToolAnnotations` interface（readOnly / destructive / idempotent，全 readonly）
  - 导出 `ToolMetadata` interface（title / description / annotations / requiredScopes / enrichUrl? / type / enabled）
  - 导出 `MIN_DESCRIPTION_CHARS = 120` 常量
  - 导出 `ENRICH_URL_PLACEHOLDER_RE` 正则
  - 导出 `validateToolMetadata(toolName, metadata): string[]` 纯函数（实现按 design §4）

- [ ] **T2** 单测占位 `apps/web/lib/assistant/__tests__/metadata.test.ts`：
  - 测 `validateToolMetadata` 自身（fixture metadata → 期望 issue 列表，覆盖 R1 §3-§6 invariants）
  - 不调用 `buildAssistantToolMetadata`（Wave B 后才有 7 项 metadata 可测）

## Wave B — 7 个工具填齐 metadata（R1, R2, R3, R5）

每个子任务在 builder return 上加 `metadata: ToolMetadata` 字段，按 design §5 表填值。description 文案确保 ≥ 120 字符且符合 R3 §1-§5 DescriptionContract。

- [ ] **T4** `tools/list-studies.ts`：metadata = type:read, annotations:T/F/T, scopes:["study:read"], 无 enrichUrl；扩 description 到 ≥120 字符（含返回字段 id/title/status/version/updatedAt 说明）。

- [ ] **T5** `tools/search-interview-data.ts`：metadata = type:read, T/F/T, ["study:read","interview:read"], 无 enrichUrl；扩 description（含 PageContext.surveyId 默认值与返回 sessionId/segmentIndex 串联）。

- [ ] **T6** `tools/analyze-data.ts`：metadata = type:read, T/F/T, ["study:read","report:read"], enrichUrl="/reports/{surveyId}"；扩 description（含 survey-scope report 缺失时返回 error envelope）。

- [ ] **T7** `tools/create-study-draft.ts`：metadata = type:draft, T/F/F, [], 无 enrichUrl；扩 description（含 audience 可空、questionCount [3..10]、未来升级 type:write 的提示）。

- [ ] **T8** `tools/create-notebook.ts`：metadata = type:write, F/F/F, ["notebook:write"], enrichUrl="/notebooks/{notebookShortId}"；description **不动文案**仅补 metadata 字段。

- [ ] **T9** `tools/search-across-studies.ts`：metadata = type:read, T/F/T, ["notebook:read"], 无 enrichUrl；description **不动文案**仅补 metadata 字段。

- [ ] **T10** `tools/todo-write.ts`：metadata = type:meta, T/F/F, [], 无 enrichUrl；扩 description（含整体覆盖语义、TodoItem 字段、agent 自管不持久化）。

- [ ] **T11** 改 `apps/web/lib/assistant/tools.ts`：
  - import `ToolMetadata`
  - 新增导出 `buildAssistantToolMetadata(ctx: AssistantToolContext): Record<keyof AssistantTools, ToolMetadata>`（按 design §8；`todoWrite` 用 stub `todoState`）
  - **不**改 `buildAssistantTools` 现有行为（Wave C 才动）

- [ ] **T11b** 全量 typecheck：`pnpm -F web typecheck` 绿；`buildAssistantToolMetadata(testCtx)` 现可调用且返回 7 项 metadata。

## Wave C — Approval 元数据驱动（R4）

- [ ] **T12** 改 `apps/web/lib/assistant/approval.ts`：新增 `withApprovalGuard<TInput extends { approvalToken?: string }, TArtifact>(toolName, metadata, execute)` 包装（实现按 design §6.1）。

- [ ] **T13** 改 `apps/web/lib/assistant/tools.ts::buildAssistantTools(ctx)`：
  - 用 `metadata.enabled` 过滤
  - 每个 spec 的 execute 用 `withApprovalGuard(name, metadata, spec.execute)` 包装
  - 类型层 `AssistantTools` 推断不破坏

- [ ] **T14** 扩 `apps/web/lib/assistant/__tests__/approval.test.ts`：
  - 用例 A：destructive=true + 无 approvalToken → 返回 `pending_approval` envelope
  - 用例 B：destructive=false → 透传，结果与原 execute 一致
  - 用例 C：destructive=true + approvalToken 存在 → 调用原 execute（mock 计数器验证）

- [ ] **T15** `pnpm -F web test apps/web/lib/assistant/__tests__/approval.test.ts` 全绿。

## Wave D — system prompt 自动化（R2 §5）

- [ ] **T16** 改 `apps/web/lib/assistant/system-prompt.ts`：
  - 把硬编码 `TOOLS_OVERVIEW` 常量改为 `buildToolsOverview(manifest: Record<string, ToolMetadata>): string`（实现按 design §9）
  - `oneLine(s)` helper 取 description 首句并截到 120 字符
  - `BuildSystemPromptArgs` 加 `manifest?: Record<string, ToolMetadata>` 参数
  - `buildSystemPrompt(args)` 在拼接 `<tools_overview>` 段时调 `buildToolsOverview(manifest)`；缺省 manifest 时回退到旧静态字符串（向后兼容）

- [ ] **T17** 改 `apps/web/lib/assistant/agent.ts::buildMorrisAgent(ctx)`：
  - 调用 `buildAssistantToolMetadata(ownerCtx)` 一次得到 manifest
  - 把 manifest 传给 `buildSystemPrompt(...)`
  - `prepareStep` 内重渲染 prompt 时也带入 manifest（与 todos 同样）

- [ ] **T18** snapshot 测 `apps/web/lib/assistant/__tests__/system-prompt.test.ts`：
  - 固定 7 工具 metadata 输入下，`<tools_overview>` 段字节级稳定
  - description 改第一句 → overview 段同步变化（验证 manifest → prompt 一致性）

## Wave E — enrichUrl UI 渲染（R5）

- [ ] **T19** 改 `apps/web/components/assistant/tool-results.tsx`：新增 `EnrichLinkRow` 组件（按 design §7.1），placeholder 缺失时不渲染 + warn。

- [ ] **T20** 改 `tool-results.tsx::ToolResult` 签名：增加 `metadata: ToolMetadata` prop；先渲染主 Card（按 toolName 分流，6 个 case 维持现状），再统一渲染 `EnrichLinkRow`（当 metadata.enrichUrl 存在）。

- [ ] **T21** 改 `apps/web/components/assistant/conversation.tsx`：渲染工具结果时构造 `metadataMap = buildAssistantToolMetadata(ownerCtx)` 并按 toolName 映射；调用 `<ToolResult metadata={metadataMap[part.toolName] ?? UNKNOWN_TOOL_METADATA} ... />`（`UNKNOWN_TOOL_METADATA` fallback 在 `tool-metadata.ts` 导出）。

- [ ] **T22** 迁移 `NotebookCreatedCard` 内的硬写 `<Link>`：从 `NotebookCreatedCard` 移除"查看 Notebook"按钮 JSX；改由 `metadata.enrichUrl="/notebooks/{notebookShortId}"` + `EnrichLinkRow label="查看 Notebook"` 渲染。视觉对比：mauve-200 + ArrowRight、文案、padding 一致。

- [ ] **T23** 视觉验证：本地 `pnpm dev` 跑一次 `createNotebook` 工具调用，对比迁移前后 chat 渲染——按钮位置 / 视觉 / href / 点击跳转 完全一致。

## Wave F — 测试（R7）

- [ ] **T24** 完成 `apps/web/lib/assistant/__tests__/metadata.test.ts`：
  - K-METADATA-01：`Object.keys(buildAssistantTools(ctx)).sort() === Object.keys(buildAssistantToolMetadata(ctx)).sort()`
  - K-METADATA-02..08：用 `it.each(Object.entries(manifest))` 对每个工具调 `validateToolMetadata`，期望 issues 为空数组
  - K-METADATA-02 单独再断 `description.length >= MIN_DESCRIPTION_CHARS`（双重保险）

- [ ] **T25** 新增 PBT `tests/properties/morris-tool-metadata/manifest.test.ts`：用 fast-check 对 `ctx.ownerUserId`（含 null）跑 100 次，每次 `validateToolMetadata` 全部通过。

- [ ] **T26** 全量 vitest：`pnpm test` 绿；新增 26 个测试用例（K-METADATA-01 + 7×K-METADATA-{02..08}/8 + 1 PBT + 3 approval new + 2 system-prompt new）。

## Wave G — 文档与 AGENTS 同步（R8）

- [ ] **T27** 改 `apps/web/AGENTS.md::Morris page assistant` 段：追加 5 条规则（按 design §11.1，约 12 行）。

- [ ] **T28** 改 `apps/web/AGENTS.md::Known foot-guns` 段：追加 1 条 `### 漏填工具 metadata 会被 K-METADATA-01 拦截`（按 design §11.2）。

- [ ] **T29** 改 `.kiro/steering/architecture.md::Where new things go` 表中"Page assistant tool"行（按 design §11.3）：补"同时填齐 metadata 并注册到 buildAssistantToolMetadata；参考 `.kiro/specs/morris-tool-metadata/design.md`"。

## Wave H — 验证

- [ ] **T30** 全仓校验：`pnpm typecheck && pnpm test && pnpm test:properties && pnpm scope-guard && pnpm -F web build` 全绿。

- [ ] **T31** 手动回归：本地 `pnpm dev` 走一遍以下对话场景，对比实施前后行为完全一致：
  - "列出我的调研" → `listStudies`
  - "在 study X 中搜 pricing 相关原话" → `searchInterviewData`
  - "把上面对话保存成 notebook" → `createNotebook` + 查看 Notebook 按钮（验证 enrichUrl 正确渲染）
  - "我之前研究过类似 onboarding 吗" → `searchAcrossStudies`
  - "帮我列出步骤" → `todoWrite`

- [ ] **T32** 性能 sanity check：实施前后 `/api/assistant` 单次请求 latency 差异 ≤ 5ms（用本地 `time curl` 跑 5 次取中位数对比）。

## 依赖波次

```
A(T1→T2) ─┬─ B(T4→T5→T6→T7→T8→T9→T10→T11) ─┬─ C(T12→T13→T14→T15) ──┐
             │                                  │                       │
             │                                  ├─ D(T16→T17→T18) ──────┤
             │                                  │                       │
             │                                  ├─ E(T19→T20→T21→T22→T23) ─┤
             │                                  │                       │
             │                                  └─ F(T24→T25→T26) ──────┤
             │                                                          │
             └──────────────────────────────────────────────────────────┴─ G(T27→T28→T29) ─ H(T30→T31→T32)
```

实操：A → B 串行（B 的 7 个工具任务可并行完成，但要在同一 PR 合并以保 K-METADATA-01 一次过）。C / D / E / F 之间并行（互相不依赖；都依赖 B 完成）。G / H 最后。

## 验收 checklist（PR ready 之前必过）

- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm test` 全绿，`metadata.test.ts` 26 用例全过
- [ ] `pnpm test:properties` 全绿，新增 manifest PBT 100 次迭代通过
- [ ] `pnpm scope-guard` 全绿（不应触发，因为本 Spec 不引入产品形态变化）
- [ ] `pnpm -F web build` 全绿
- [ ] 本地 `pnpm dev` 走一遍 5 个对话场景，行为与实施前完全一致
- [ ] 视觉回归：`createNotebook` 触发的"查看 Notebook"按钮在 mauve-200 / ArrowRight / 文案 / padding 上与迁移前 pixel-level 一致
- [ ] PR 描述含 `pre-implementation.md::Investigation deliverable` 四件套（数据流图/上下游 callers/参考实现/拒绝备选；可直接从本 design.md §1, §2, §13 复用）
- [ ] `apps/web/AGENTS.md` 已加新规则与 foot-gun 条目
- [ ] `.kiro/steering/architecture.md` 已更新"Page assistant tool"行

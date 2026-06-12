# Requirements Document

## Feature: morris-tool-metadata（Morris 工具元数据驱动改造）

## Introduction

本需求文档对应 Spec **morris-tool-metadata**，目的是把 Morris 现有 7 个工具（`listStudies` / `searchInterviewData` / `analyzeData` / `createStudyDraft` / `createNotebook` / `searchAcrossStudies` / `todoWrite`）的元数据从"散在 system prompt 文本 + `approval.ts` 硬编码白名单 + `tool-results.tsx` 渲染分支"的隐式状态，**收紧到每个工具 builder 显式声明的结构化元数据**。

借鉴对象是 PostHog `services/mcp/` 给每个 product 配的 `mcp/tools.yaml`（如 `products/notebooks/mcp/tools.yaml`、`products/user_interviews/mcp/tools.yaml`、`products/cohorts/mcp/tools.yaml`、`products/feature_flags/mcp/tools.yaml`）中工程上已经验证的元数据约定——但本 Spec **不引入 yaml / OpenAPI scaffold / MCP 服务器 / Cloudflare Workers / OAuth**：所有改造落在 `apps/web/lib/assistant/*` 与 `apps/web/components/assistant/tool-results.tsx` 之内，仍然使用 Vercel AI SDK 6 `tool({ inputSchema, execute })` + `ToolLoopAgent`，元数据是 TypeScript 内联（每个工具 builder 多返回几个字段）。

本 Spec 包含 9 项约束，不含"暴露 MCP server 给外部 agent"（按 `.kiro/steering/scope.md` borrow-or-build flow，目前没有外部 agent 调用 Merism 的用例，立场 A 保持当前姿态）；也不含"feature flag 门控工具"（项目尚无 feature flag 系统，引入是过度工程）。

## Prerequisite

- `morris-agent-hardening/design.md` §3-§9（工具拆分到 `tools/<name>.ts`、`{ contextPromptTemplate?, spec }` 形状、ToolResultEnvelope、ApprovalEnvelope、PageContext、static prompt 拼接器；本 Spec 在其基础上**增加**元数据字段，不动其形状）。
- `analysis-report/design.md`（Morris 当前可调用的 read tools 与 `lib/queries/*` 读出层）。
- `notebooks/design.md`（`createNotebook` / `searchAcrossStudies` 工具 + Notebook 持久化路径，本 Spec 不变更其行为）。
- `docs/adr/0002-page-assistant-vercel-ai-sdk.md`（Morris 的栈与目录约定；本 Spec 不变更其结论）。
- `.kiro/steering/scope.md`（borrow-or-build flow；明确"暴露 MCP server"在范围外）。
- `.kiro/steering/contracts.md`（schema-first；Morris 工具元数据是 web 内部协议，不上升到跨模块契约）。
- 借鉴来源（仅作参考实现，不直接依赖代码）：
  - `/home/jia/posthog/products/notebooks/mcp/tools.yaml`（read + write 工具组合范例）。
  - `/home/jia/posthog/products/user_interviews/mcp/tools.yaml`（含 `enrich_url` / `feature_flag` / `include_params` 范例）。
  - `/home/jia/posthog/products/cohorts/mcp/tools.yaml`、`/home/jia/posthog/products/feature_flags/mcp/tools.yaml`、`/home/jia/posthog/products/persons/mcp/tools.yaml`（提炼字段全集，去重得到本 Spec §1 的元数据 schema）。

## Glossary

| 术语 | 含义 |
|---|---|
| **ToolMetadata** | 单个 Morris 工具在 builder 返回的元数据对象，形如 `{ title, description, annotations, requiredScopes, enrichUrl?, type, enabled }`；本 Spec §1 定义的 schema。 |
| **ToolBuilderResult** | 工具 builder 函数（`buildXxxTool(ctx)`）的返回类型，本 Spec 后形状为 `{ contextPromptTemplate?, spec, metadata }`，在 morris-agent-hardening 的 `{ contextPromptTemplate?, spec }` 之上**新增 `metadata`**。 |
| **annotations** | 工具语义三元组：`readOnly` / `destructive` / `idempotent`，借鉴 PostHog `tools.yaml.annotations`，给前端 approval 模型与 LLM 系统提示提供决策依据。|
| **enrichUrl** | 字符串模板（如 `/notebooks/{shortId}` / `/studies/{studyId}/edit`），输入是工具 artifact 字段；用于 `tool-results.tsx` 渲染统一的"查看/打开"链接，替代当前在每个 Card 里硬写的 `<Link href=...>`。|
| **requiredScopes** | 字符串数组（如 `["study:read"]`、`["notebook:write"]`），借鉴 PostHog `tools.yaml.scopes`。本 Spec **只声明不强制**——当前 Morris 的鉴权是 `ownerUserId` 闭包，scope 字段记录"将来若引入 MCP server 或 personal API key 时该工具需要什么"，避免下次需要时重新审计。 |
| **ToolType** | 工具语义分类：`read` / `write` / `draft` / `meta`。`read` 不写数据库；`write` 写 Appwrite（必须配 `annotations.destructive` / `idempotent`）；`draft` 只在对话中产出不落库（如 `createStudyDraft`）；`meta` 是 agent 自管工具（`todoWrite`）。 |
| **MorrisToolManifest** | `buildAssistantToolMetadata(ctx)` 返回的集中视图：`Record<toolName, ToolMetadata>`，给测试层、approval 层、`<tools_overview>` prompt 拼接段消费。 |
| **DescriptionContract** | 工具 `description` 字段的最低完整度约定：必含"做什么 / 何时用 / 关键参数怎么传"三段，且字符长度 ≥ `MIN_DESCRIPTION_CHARS`（本 Spec §3 给定）。 |

## Scope

**包含**：

1. 在每个工具 builder 的返回值上新增 `metadata: ToolMetadata` 字段，不破坏现有 `{ contextPromptTemplate?, spec }` 形状（即 `metadata` 是新增第三个 key）。
2. 把 7 个现有工具的元数据填齐：`listStudies` / `searchInterviewData` / `analyzeData` / `createStudyDraft` / `createNotebook` / `searchAcrossStudies` / `todoWrite`。
3. 改写 `lib/assistant/approval.ts`：destructive 判定从"无判定 / 工具内部自调 `proposeApproval`"改为"读 `metadata.annotations.destructive` 自动触发"。当前 7 个工具中 destructive 为 false 的不受影响（即没有破坏路径），但骨架准备就绪供未来写工具落地时直接生效。
4. `tool-results.tsx` 增加统一 `EnrichLinkRow` 组件：读 `metadata.enrichUrl` 模板 + artifact 字段渲染 deep link 按钮；6 个现有 Card 中已有的 `Link` 写法逐步迁移到新组件（保留 Card 视觉不变）。
5. 加 `lib/assistant/tools.ts::buildAssistantToolMetadata(ctx)`：返回 `Record<toolName, ToolMetadata>`，给测试与 prompt 段拼接消费。
6. 加 `lib/assistant/__tests__/metadata.test.ts`：用 `Object.keys(buildAssistantTools(ctx))` 与 `Object.keys(buildAssistantToolMetadata(ctx))` 强制一对一；逐项校验 `description` 完整度、`annotations` 必填、`type` 在白名单内、`enrichUrl`（当声明）含至少一个 `{key}` 占位符。
7. 改 `lib/assistant/system-prompt.ts::TOOLS_OVERVIEW`：从手写 7 行短描述改为按 manifest 自动生成（每行 = `{title}: {oneLineDescription}`），保证 manifest 改动同步反映到 prompt。
8. 把对应规则写进 `apps/web/AGENTS.md` 的 Morris 工具段（明示新增工具必须填齐 metadata），并在 `apps/web/AGENTS.md` 末尾的 `## Known foot-guns` 节追加一条"漏填 metadata 会被测试拦截"。

**排除**：

- 不引入 yaml / OpenAPI scaffold（现状 7 个工具是手写 zod schema，没有 OpenAPI 来源；引入 yaml 是过度工程）。
- 不引入 feature flag 字段（项目尚无 feature flag 系统）。
- 不引入 `include_params` / `exclude_params` / `param_overrides` / `inject_body`（PostHog 这些字段是 yaml 与 DRF view 解耦带来的，我们 zod schema 直接由工具 builder 控制，不需要这层转译）。
- 不暴露 Morris 工具为 MCP server / 外部 agent 调用（按 `scope.md` 当前没有用例，立场 A 不做）。
- 不改 `packages/contracts`、`packages/observability`、`packages/appwrite-schema`、`apps/agent`、`apps/functions` 任何代码（本 Spec 是 web 内部约定）。
- 不改任何工具的 `inputSchema` 与 `execute` 实现（仅元数据 + description 文案、approval 触发路径、UI 渲染层）。
- 不引入 `description_file` 外置 markdown（PostHog 用是因为某些工具的 prompt 长达数千字；我们 7 个工具描述都能塞进 TS 字符串）。
- 不改 ApprovalEnvelope / proposeApproval 的形状（仍是 morris-agent-hardening 的形状），只改"何时触发 approval"的判定路径。

## Requirements

### Requirement 1: 工具元数据 schema（ToolMetadata）

**User Story:** 作为 Morris 维护者，我需要每个工具显式声明结构化元数据（`title` / `description` / `annotations` / `requiredScopes` / `enrichUrl` / `type` / `enabled`），以便 approval 模型、UI 渲染、prompt 拼接、元数据完备性测试都从同一份声明里读，而不是散在多处的隐式约定。

#### Acceptance Criteria

1. WHEN 任意 `lib/assistant/tools/<name>.ts` 的 builder 函数返回 THEN 返回值 SHALL 满足 `ToolBuilderResult = { contextPromptTemplate?: string; spec: ToolSpec; metadata: ToolMetadata }`，其中 `metadata` 字段必填、不可为 `undefined`。
2. WHERE `ToolMetadata` 类型 THEN 形状 SHALL 为：`{ title: string; description: string; annotations: { readOnly: boolean; destructive: boolean; idempotent: boolean }; requiredScopes: readonly string[]; enrichUrl?: string; type: "read" | "write" | "draft" | "meta"; enabled: boolean }`，定义在新增的 `lib/assistant/tool-metadata.ts`。
3. WHEN `metadata.type === "read"` THEN `metadata.annotations.readOnly` SHALL 为 `true`，且 `metadata.annotations.destructive` SHALL 为 `false`。
4. WHEN `metadata.type === "write"` THEN `metadata.annotations.readOnly` SHALL 为 `false`；`metadata.annotations.destructive` 与 `metadata.annotations.idempotent` 任意组合都允许，但二者**不允许同时缺省**——必须显式声明（false 也算声明）。
5. WHEN `metadata.type === "draft"` THEN 工具 SHALL 不写 Appwrite（仅返回对话用 artifact），`metadata.annotations.readOnly` SHALL 为 `true`（draft 不读也不写持久层）。
6. WHEN `metadata.type === "meta"` THEN 工具 SHALL 是 agent 自管工具（如 `todoWrite`），`metadata.annotations.readOnly` SHALL 为 `true`，`metadata.requiredScopes` SHALL 为 `[]`。
7. WHEN 运行 `pnpm -F web typecheck` THEN 全仓 SHALL 通过，且 `ToolMetadata` 的 `type` 字段使用 `as const` 单元类型联合，禁止 `string` 宽化。

### Requirement 2: 工具 enabled 默认显式

**User Story:** 作为 Morris 维护者，我需要每个工具的 `enabled` 状态显式声明，以便未来添加"暂不开放给 LLM 但代码已就绪"的工具时（典型：写工具刚写完未通过审批）有明确开关，而不是"注册即启用"。

#### Acceptance Criteria

1. WHERE `ToolMetadata.enabled` THEN 字段 SHALL 必填（`boolean` 不带默认值）；默认值由各工具显式给出，**不准在 `ToolMetadata` 类型上写 `enabled?: boolean = true`** 这种隐式默认。
2. WHEN `buildAssistantTools(ctx)` 聚合工具 THEN 它 SHALL 只返回 `metadata.enabled === true` 的工具的 `spec` 给 `ToolLoopAgent`。
3. WHEN `buildAssistantToolMetadata(ctx)` 聚合元数据 THEN 它 SHALL 返回**所有**工具的 metadata（含 `enabled === false` 的），便于运维查看；调用方按需过滤。
4. WHEN 7 个现有工具被改造 THEN 全部 SHALL 声明 `enabled: true`（这是当前行为，不引入回退）。
5. WHEN `<tools_overview>` system prompt 段拼接 THEN 它 SHALL 仅列出 `enabled: true` 的工具，避免给 LLM 看到不可调用的工具。
6. WHERE 文档 THEN `apps/web/AGENTS.md` 的 Morris 段 SHALL 写明"新增工具默认 `enabled: false`，开放前必须有同 PR 测试 + reviewer 显式批准"——借鉴 PostHog `tools.yaml` 的"默认禁用 + 显式启用"哲学。

### Requirement 3: description 完整度合约（DescriptionContract）

**User Story:** 作为研究员，当 Morris 调错工具或传错参数时，我希望 description 已经把"如何调用正确"说清楚——而不是只写"做什么"导致 LLM 凭空猜参数格式。

#### Acceptance Criteria

1. WHERE `ToolMetadata.description` THEN 字段 SHALL 字符长度 ≥ `MIN_DESCRIPTION_CHARS = 120`（中文字符按 1 计，英文字符按 1 计；按 `description.length` 计算，足够容纳"做什么 / 何时用 / 关键参数"三段简述）。
2. WHEN 工具有 ≥1 个非 trivial 参数（即 `inputSchema` 不是 `z.object({})`） THEN `description` SHALL 包含至少一个该参数的关键约束说明（如 `createNotebook` 现有 description 的 "input.content 接受 Markdown 字符串"段，或 `searchAcrossStudies` 的 "studyId=null 表示跨所有 study"段）。
3. WHEN 工具产出非 trivial artifact（`type="read"` 列表 / `type="write"` 创建对象 / `type="draft"` 草稿） THEN `description` SHALL 描述"返回什么字段供后续工具/UI 使用"（参见 `createNotebook` 的"返回 notebookShortId 用于 /notebooks/{shortId} 跳转"）。
4. WHERE `description` THEN 文本 SHALL 不含敏感信息（不暴露 ownerUserId 字段值、Appwrite project id、API key 模式等）。
5. WHEN `description` 涉及"何时用 / 何时不用"判断 THEN 它 SHALL 与 `system-prompt.ts::WORKSTYLE` 段的对应触发条件一致（重复一份给 LLM 看到的工具上下文）；维护时改一处必须同 PR 改另一处（落到 `apps/web/AGENTS.md` 工作流）。
6. WHEN 单测 `metadata.test.ts` 运行 THEN 它 SHALL 对每个工具校验 `description.length >= MIN_DESCRIPTION_CHARS`，违反时给出 `expected description for "${toolName}" to be ≥ 120 chars, got ${len}` 的明确报错。

### Requirement 4: Approval 元数据驱动

**User Story:** 作为 Morris 维护者，当未来加一个 destructive 工具（如"删除 Notebook"）时，我希望只在 metadata 里写 `annotations.destructive: true` 就让 approval 流程自动生效，而不是同时改 `approval.ts` 维护一份硬编码工具名白名单。

#### Acceptance Criteria

1. WHEN `ToolLoopAgent` 调用一个 `metadata.annotations.destructive === true` 的工具 THEN `lib/assistant/approval.ts` SHALL 提供一个 `withApprovalGuard(toolName, metadata, execute)` 包装函数，包装后的 execute 在收到第一次调用且无 `approvalToken` 时**自动**返回 `proposeApproval(...)` 形态的 envelope，而不是真正执行。
2. WHEN `metadata.annotations.destructive === false` THEN `withApprovalGuard` SHALL 透传执行（不增加任何运行时开销，理想情况是直接 return 原 execute）。
3. WHERE `withApprovalGuard` 包装 THEN 它 SHALL 不破坏 `ToolResultEnvelope<T>` 的类型契约——返回类型保持 `Promise<ToolResultEnvelope<T | ApprovalEnvelope | ToolErrorArtifact>>`。
4. WHERE `lib/assistant/tools.ts::buildAssistantTools(ctx)` THEN 聚合层 SHALL 自动用 `metadata` 把每个工具的 `spec.execute` 套上 `withApprovalGuard`，工具 builder 内部不需要也不允许直接调 `proposeApproval`（除非该工具有特殊的"半危险"语义，需要显式开 escape hatch；本 Spec 7 个工具都不需要）。
5. WHEN `hasPendingApproval` stop 条件触发 THEN `ToolLoopAgent` SHALL 终止当前回合（行为同 morris-agent-hardening），不被本 Spec 修改。
6. WHEN 7 个现有工具被改造 THEN 全部 `annotations.destructive` SHALL 为 `false`（当前行为；本 Spec 不引入新的 destructive 工具，仅准备骨架）。
7. WHEN 单测 `approval.test.ts` 扩展 THEN 它 SHALL 含两个新用例：（a）destructive 工具未带 token → 返回 `pending_approval` 形态；（b）非 destructive 工具透传，且 `withApprovalGuard` 不改变结果。

### Requirement 5: enrichUrl 模板化与 UI 渲染

**User Story:** 作为研究员，当 Morris 工具创建或返回了一个我可以打开的对象（Notebook / Study / Report）时，我希望 chat 里的工具结果卡片**总是**显示一个"打开"按钮——而不是部分工具有 `<Link>`、部分没有。

#### Acceptance Criteria

1. WHERE `ToolMetadata.enrichUrl` THEN 字段 SHALL 是 `string | undefined`，模板形如 `"/notebooks/{shortId}"` / `"/studies/{studyId}/edit"` / `"/reports/{surveyId}"`，占位符 `{key}` 仅匹配 ASCII 标识符 `[A-Za-z_][A-Za-z0-9_]*`。
2. WHEN `enrichUrl` 字段存在 THEN 模板 SHALL 至少包含一个 `{key}` 占位符；纯静态 URL（无占位符）触发测试报错（这种情况应直接放在卡片视觉，不走 enrichUrl 通道）。
3. WHEN `tool-results.tsx::ToolResult` 渲染一个工具结果 THEN 它 SHALL 通过 `metadata.enrichUrl` 与 `output.artifact` 的字段渲染统一的"打开"按钮（见 design.md §5）。`enrichUrl` 缺省 → 不渲染按钮。
4. WHERE 渲染 THEN 当模板的占位符在 artifact 中**缺失** THEN 按钮 SHALL 整体不渲染（不渲染 `/notebooks/undefined` 类破链接），并 `console.warn` 一行（含 toolName + missingKey）。
5. WHERE 已有 Card 中的硬写 `<Link href={...}/>`（典型：`NotebookCreatedCard` 的"查看 Notebook"链接） THEN 本 Spec SHALL 把它迁移到 `metadata.enrichUrl` 驱动的统一组件；视觉保持不变（mauve primary 按钮 + ArrowRight 图标 + 同样文案）。
6. WHEN 7 个工具被填齐 metadata THEN 至少 `createNotebook`（`/notebooks/{notebookShortId}`）、`createStudyDraft`（无 enrichUrl，因为是 mock 草稿不落库）、`searchAcrossStudies`（无 enrichUrl，结果是多条）应有合理声明；其余按 design.md §5.3 表给出。

### Requirement 6: 元数据集中视图（buildAssistantToolMetadata）

**User Story:** 作为 Morris 维护者，我需要一个一处可见的"manifest 视图"，能在测试、approval、prompt 拼接、未来文档生成时复用，而不是每次都遍历 7 个 builder 重新解构。

#### Acceptance Criteria

1. WHERE `lib/assistant/tools.ts` THEN 它 SHALL 新增导出 `buildAssistantToolMetadata(ctx: AssistantToolContext): Record<keyof AssistantTools, ToolMetadata>`，对应 7 个工具一对一。
2. WHEN `buildAssistantToolMetadata(ctx)` 返回 THEN 返回对象的 keys SHALL 与 `buildAssistantTools(ctx)` 的 keys 完全一致（含顺序约束：用同一份 `Object.keys` 遍历）；测试 §7 强制这点。
3. WHERE 类型层 THEN `ToolMetadata` 与聚合返回类型 SHALL 在 `lib/assistant/tool-metadata.ts` 与 `tools.ts` 内导出，禁止散落到各 `tools/<name>.ts`。
4. WHEN 调用方需要"只读"元数据视图 THEN 它 SHALL 用 `buildAssistantToolMetadata(ctx)`，不再自己 import 每个 builder 解构 `metadata`；`approval.ts`、`system-prompt.ts::TOOLS_OVERVIEW` 拼接、`tool-results.tsx` 都走这条路径。
5. WHERE 性能 THEN `buildAssistantToolMetadata(ctx)` SHALL 是 O(N) 且无 I/O（仅函数调用 + 对象字面量构造）；每个请求调一次允许，不允许跨请求缓存（避免 ownerUserId 错位）。
6. WHEN 未来加第 8 个工具 THEN 维护者 SHALL：（a）新增 `tools/<name>.ts` 含 metadata；（b）注册到 `buildAssistantTools` 与 `buildAssistantToolMetadata` 两处；（c）单测自动失败提醒漏了哪一处（见 R7）。

### Requirement 7: 元数据完备性测试

**User Story:** 作为 Morris 维护者，我需要测试在加新工具时**自动失败**于"漏填 metadata"——而不是依赖 reviewer 肉眼看 7 个文件。

#### Acceptance Criteria

1. WHERE `apps/web/lib/assistant/__tests__/metadata.test.ts` THEN 它 SHALL 包含以下测试用例（每个都对 7 个工具迭代）：
   - **K-METADATA-01** `Object.keys(buildAssistantTools(ctx)).sort()` 与 `Object.keys(buildAssistantToolMetadata(ctx)).sort()` 严格相等。
   - **K-METADATA-02** 每个工具的 `metadata.title` 非空字符串、`metadata.description.length >= 120`、`metadata.type` 在 `["read","write","draft","meta"]` 中。
   - **K-METADATA-03** 每个工具的 `metadata.annotations.readOnly` / `destructive` / `idempotent` 全部 `boolean`（不是 `undefined`）。
   - **K-METADATA-04** 每个工具的 `metadata.requiredScopes` 是数组，元素全为非空字符串；`type === "meta"` 时数组为空。
   - **K-METADATA-05** 当 `metadata.enrichUrl` 存在 THEN 它包含至少一个 `{[A-Za-z_][A-Za-z0-9_]*}` 形式的占位符。
   - **K-METADATA-06** 当 `metadata.type === "read"` THEN `metadata.annotations.readOnly === true && metadata.annotations.destructive === false`（R1 §3 的运行时校验）。
   - **K-METADATA-07** 当 `metadata.type === "draft"` THEN `metadata.annotations.readOnly === true`（R1 §5）。
   - **K-METADATA-08** 当 `metadata.type === "meta"` THEN `metadata.annotations.readOnly === true && metadata.requiredScopes.length === 0`（R1 §6）。
2. WHERE property test `tests/properties/morris-tool-metadata/manifest.test.ts` THEN 它 SHALL 跑一遍 fast-check 生成器：随机 `ctx.ownerUserId`（含 `null`）下，所有 7 个 builder 不抛异常且 metadata 符合 §1 各 invariant；100 次迭代。
3. WHEN 新增第 8 个工具但忘了在 `buildAssistantToolMetadata` 注册 THEN K-METADATA-01 SHALL 失败并明确指向"missing in toolMetadata: <toolName>"。
4. WHEN 新增第 8 个工具但 description 短于 120 字符 THEN K-METADATA-02 SHALL 失败并报"<toolName>.description.length === 47, expected >= 120"。
5. WHERE 测试运行命令 THEN `pnpm -F web test apps/web/lib/assistant/__tests__/metadata.test.ts` SHALL 在合理时间（< 5s）内完成；不依赖 Appwrite live stack（用 `ctx = { ownerUserId: "test_user" }` 的内存 stub）。

### Requirement 8: 文档与 AGENTS 同步

**User Story:** 作为下次接手 Morris 的开发者（或 AI agent），我需要在 `apps/web/AGENTS.md` 与根 `AGENTS.md` 看到"加新工具的强制流程"和"为什么 metadata 这么设计"，而不是只看到现状代码自己悟。

#### Acceptance Criteria

1. WHERE `apps/web/AGENTS.md::Morris page assistant` 段 THEN 它 SHALL 在本 Spec 落地后追加 5 条规则：（a）新增工具必须在 `tools/<name>.ts` 填齐 `metadata`；（b）默认 `enabled: false`，开放需 reviewer 显式批准；（c）destructive 工具自动走 approval；（d）`description` 必含"如何调用正确"段，长度 ≥ 120；（e）注册到 `buildAssistantToolMetadata` 与 `buildAssistantTools` 两处。
2. WHERE `apps/web/AGENTS.md::Known foot-guns` 段 THEN 本 Spec SHALL 追加一条 foot-gun：漏填 metadata 会被 K-METADATA-01 拦截；并指明排查路径"看 metadata.test.ts 的失败用例".
3. WHERE `.kiro/steering/architecture.md::Where new things go` 表 THEN "Page assistant tool" 行 SHALL 更新为 "`apps/web/lib/assistant/tools/`（同时填齐 metadata 并注册到 `buildAssistantToolMetadata`；参考 `.kiro/specs/morris-tool-metadata/design.md`）"。
4. WHEN 本 Spec 实施合并 THEN PR 描述 SHALL 含 `pre-implementation.md` 强制的"investigation deliverable"四件套（数据流图、上下游 callers、参考实现链接、拒绝备选）；本 Spec 自身的写作过程已完成调研，PR 可直接复用本 design.md 的相关段。
5. WHERE 不更新文档 THEN reviewer SHALL 拒绝合并；这与 `pre-implementation.md::Enforcement` 的"PR 加了非平凡功能但没引用任何参考实现"条款一致。

### Requirement 9: 向后兼容与零行为漂移

**User Story:** 作为 Morris 用户（研究员），本 Spec 实施后我**不应该感知到任何行为变化**——工具调用准确率、回复速度、UI 视觉、approval 时机都和实施前一致；只是代码内部更整齐。

#### Acceptance Criteria

1. WHEN 实施前后跑同一组对话样本（如"列出我的调研" / "在 study X 中搜 pricing 相关原话" / "把上面对话保存成 notebook"） THEN Morris 调用的工具名 SHALL 完全一致；artifact 字段 SHALL 完全一致；`createNotebook` 的"查看 Notebook"按钮 SHALL 仍然存在且 href 不变。
2. WHERE `lib/assistant/agent.ts::buildMorrisAgent` 与 `app/api/assistant/route.ts` THEN 公共签名 SHALL 不变：`buildMorrisAgent(ctx)` 仍接 `MorrisRequestContext`，`route.ts` 的请求/响应形状不变。
3. WHERE `components/assistant/conversation.tsx` 与 `useChat` 的 body 形状 THEN 不变（仍是 `{ messages, pageContext }`）。
4. WHERE `tool-results.tsx` 渲染 THEN 6 个 Card 的视觉（mauve / ink token、字体、间距、按钮形状）SHALL 不变；仅"打开"按钮从硬编码迁到 `metadata.enrichUrl` 驱动。
5. WHEN 实施前的所有 vitest 测试（envelope / system-prompt / approval / page-context / tool-template / compaction / errors / metrics）运行 THEN 全部 SHALL 仍然通过，无需修改。
6. WHERE 性能 THEN 单次请求 `/api/assistant` 的 latency SHALL 不增加 > 5ms（manifest 构造 + approval guard 包装的开销）；本 Spec 不引入额外网络/IO/重渲染。
7. WHEN 实施前 PageContext 校验失败的 fallback（pageContext = {} 继续）触发 THEN 行为 SHALL 不变（不因为 metadata 改造引入新的 400 路径）。

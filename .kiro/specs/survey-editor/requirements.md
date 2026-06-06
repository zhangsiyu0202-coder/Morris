# Requirements Document

## Feature: survey-editor（访谈调研编辑器）

## Introduction

本需求文档对应 Spec **survey-editor**，把当前以 Drizzle/Postgres + mock 支撑的"调研编辑器 + 工作台"迁到唯一后端 Appwrite，并把编辑态数据形状收敛到 `@merism/contracts` 的 `SurveyDraft`。

UI 层已在 `feat/studies-workspace` 分支落地（工作台外壳、Guide 三栏编辑器、概览/筛选/招募/结果/转录视图、首页仪表盘、三态侧边栏、拖拽排序），并已抽出服务端数据 seam `apps/web/lib/workspace-data.ts`。本 Spec 不重做 UI，只做**数据层迁移与契约收敛**：

1. 编辑器读写从 `apps/web/lib/actions/studies.ts`（Drizzle `study` 表）迁到 Appwrite `surveys` / `survey_sections` / `question_blocks` 三个 collection。
2. 编辑态契约从本地 `apps/web/lib/guide.ts` 收敛到 `@merism/contracts` 的 `SurveyDraftSchema`（含本 Spec 新增的 `allowSkip` 字段)。
3. 工作台只读视图（概览/结果/转录）的 `lib/workspace-data.ts` seam 接 `apps/web/lib/queries/*` 真实数据，未配置/未登录/空结果时回退 mock。
4. 研究员鉴权：编辑器读写按 `ownerUserId` 作用域；匿名受访者永不触达。

设计与决策细节见 `design.md`。本文档只规定"必须做什么 / 必须满足什么验收"。

## Prerequisite

- `foundation-setup/design.md §Components and Interfaces` 与 §Data Models（已落地）
- `analysis-report/design.md`：已落地的 `apps/web/lib/queries/*` 读出层（`getStudy`/`listStudies`/`listSessions`）与 ownership 校验模式，本 Spec 复用并扩展为可写
- `docs/adr/0001-livekit-supervisor-interview-workflow.md`（运行时由 `buildInterviewRuntimeStudy` 等把 draft 译成运行时配置，编辑器不得重复实现）
- `.kiro/steering/design-system.md`（Mauve Quiet，UI 已遵循）

## Glossary

| 术语 | 含义 |
|---|---|
| **SurveyDraft** | `@merism/contracts` 的编辑态契约（title/researchGoal/targetAudience/introScript/sections[]），带选项/题型校验，是编辑器的唯一数据真源 |
| **Survey** | Appwrite `surveys` collection 文档（`$id`/`projectId`/`title`/`status`/`flowConfig`/`version`/`updatedAt`），编辑器的持久化根 |
| **SurveySection / QuestionBlock** | Appwrite `survey_sections` / `question_blocks` collection，分节与问题的规范化存储 |
| **Read Layer** | `apps/web/lib/queries/*`（node-appwrite，含 ownerUserId 校验），已由 analysis-report 落地，本 Spec 复用 |
| **Write Layer** | 本 Spec 新增的 server actions（`apps/web/lib/actions/survey.ts`），把 SurveyDraft 落到三个 collection |
| **Data Seam** | `apps/web/lib/workspace-data.ts`，工作台只读视图的服务端数据访问层 |

## Scope

**包含**：
- 契约收敛：`SurveyDraftQuestionSchema` 增加 `allowSkip: boolean`（contracts-first），删除/退役 `apps/web/lib/guide.ts` 中与契约重复的类型，编辑器改用 `@merism/contracts`
- 编辑器读：`getStudy`（read layer，已存在）→ 组装 `SurveyDraft` 交给 `GuideEditor`
- 编辑器写：新增 `apps/web/lib/actions/survey.ts`（`createSurvey`/`saveSurveyDraft`/`updateSurveyStatus`/`deleteSurvey`），把 `SurveyDraft` 规范化落 `surveys`+`survey_sections`+`question_blocks`
- 工作台只读视图 seam 接真实数据（概览=会话计数+最近会话；结果=会话+collectedAnswers；转录=按 sessionId 取 Transcript），带 mock 回退
- 鉴权：所有读写经 `getCurrentUserId()` + `ownerUserId` 作用域；匿名只读权限不授予编辑器 collection
- Appwrite schema：确认/补充 `survey_sections`、`question_blocks` 的 attributes/index/permissions（`@merism/appwrite-schema`）
- 删除 Drizzle 编辑器栈：`apps/web/lib/db/*`、`apps/web/lib/actions/studies.ts`、`apps/web/lib/actions/guide-ai.ts` 迁移后退役；`pnpm-lock.yaml` 移除 `drizzle-orm`/`pg`
- Correctness Properties 与 PBT：P-DATA-01（draft↔persisted 往返无损）、P-SEC-04（编辑器写按 ownerUserId 隔离）

**排除**：
- UI 重做（已在 feat/studies-workspace 完成；本 Spec 只换数据源）
- 跳过逻辑/skip-logic 的运行时语义（agent 消费 `allowSkip` 属于 `ai-interview-engine`）
- 受访者门户（`interviewee-portal` 子 spec）
- 筛选问卷（screener）与招募的真实后端（保持 UI/mock；本 Spec 只标 TODO 指向后续）
- Morris 的 `createStudyDraft` 工具真实实现（analysis-report 已标 TODO 指向本 Spec，可在本 Spec 收尾接上，作为可选项）
- PDF/导出、多语言

## Requirements

### Requirement 1: 编辑态契约收敛到 SurveyDraft

**User Story:** 作为平台维护者，我需要编辑器使用 `@merism/contracts` 的 `SurveyDraft` 作为唯一编辑态契约，以便编辑器产出能被 `buildInterviewRuntimeStudy` 等无损译成运行时配置。

#### Acceptance Criteria
1. WHEN 需要在编辑器表达"允许跳过" THEN `SurveyDraftQuestionSchema` SHALL 新增 `allowSkip: z.boolean().default(false)`，且先改 `packages/contracts` 再改消费方。
2. WHEN 编辑器读取或保存数据 THEN 类型 SHALL 来自 `@merism/contracts`（`SurveyDraft`/`SurveyDraftSection`/`SurveyDraftQuestion`），不再依赖 `apps/web/lib/guide.ts` 的重复类型。
3. WHERE 编辑器需要本地稳定 id（React key / 拖拽） THEN 这些 id SHALL 仅存在于编辑态内存，不写入持久层（持久层用 Appwrite `$id` 与 `order`）。
4. WHEN 运行 `pnpm -F @merism/contracts typecheck && pnpm typecheck` THEN 全仓 SHALL 通过（契约改动暴露的所有破坏点已修复）。

### Requirement 2: 编辑器读路径迁到 Appwrite

**User Story:** 作为研究员，我需要打开某个调研时从 Appwrite 读到它的完整提纲，以便编辑。

#### Acceptance Criteria
1. WHEN 研究员打开 `/studies/[id]/guide` THEN 系统 SHALL 经 `getCurrentUserId()` + read layer `getStudy(ownerUserId, surveyId)` 读取 `survey`+`sections`+`questions`，并组装为 `SurveyDraft` 交给 `GuideEditor`。
2. IF 当前无登录会话或 survey 不属于该用户 THEN 系统 SHALL 渲染受控的空/未授权状态，不泄露他人数据，不抛栈。
3. WHEN sections/questions 含未通过 `@merism/contracts` 校验的脏行 THEN 读层 SHALL 丢弃该行并记服务端日志（复用现有 `parseAll` 模式），不把半解码数据交给 UI。

### Requirement 3: 编辑器写路径迁到 Appwrite

**User Story:** 作为研究员，我需要保存提纲编辑结果到 Appwrite，并能新建/删除/改状态。

#### Acceptance Criteria
1. WHEN 研究员保存提纲 THEN 系统 SHALL 用 `SurveyDraftSchema` 在边界校验输入，校验失败 SHALL 返回明确错误且不产生副作用。
2. WHEN 保存成功 THEN 系统 SHALL 把 draft 规范化写入 `surveys`（meta+version 递增）、`survey_sections`（按 order）、`question_blocks`（按 order/orderInSection），并保证再次读取能无损还原为等价 draft（见 P-DATA-01）。
3. WHEN 新建调研 THEN 系统 SHALL 以当前用户为 `ownerUserId` 创建 `surveys` 文档并返回其 `$id`；新建后跳转 `/studies/[$id]/guide`。
4. WHEN 删除调研 THEN 系统 SHALL 仅允许 `ownerUserId` 本人删除，并一并清理其 sections/questions（best-effort，失败不静默吞掉）。
5. WHERE 写操作发生 THEN 系统 SHALL 绝不授予匿名角色对这三个 collection 的写权限（写仅经研究员会话）。

### Requirement 4: 工作台只读视图接真实数据（带回退）

**User Story:** 作为研究员，我需要概览/结果/转录显示该调研的真实访谈数据。

#### Acceptance Criteria
1. WHEN 打开概览 THEN `loadStudyOverview` SHALL 用 `listSessions`/`countCompletedSessions` 取真实会话，映射为统计数与最近会话列表。
2. WHEN 打开结果 THEN `loadStudyResults` SHALL 把 `InterviewSession`（含 `collectedAnswers`）映射为结果表行与答案列。
3. WHEN 打开转录 THEN `loadStudyTranscript` SHALL 按 `sessionId` 取 `Transcript.segments` 映射为对话轮，AI 摘要取自该 session 的 `AnalysisReport`（若存在）。
4. IF `appwrite_not_configured` 或未登录或查询为空 THEN 各 loader SHALL 回退到对应 mock，保证本地无 stack 时页面可用。

### Requirement 5: 退役 Drizzle 编辑器栈

**User Story:** 作为平台维护者，我需要移除编辑器对 Drizzle/Postgres 的依赖，使 Appwrite 成为唯一后端。

#### Acceptance Criteria
1. WHEN 迁移完成且验证通过 THEN 系统 SHALL 删除 `apps/web/lib/db/*` 与 `apps/web/lib/actions/studies.ts` 的 Drizzle 实现，并把 `apps/web/lib/guide.ts` 中与契约重复的部分退役。
2. WHEN 删除完成 THEN `apps/web/package.json` 与 `pnpm-lock.yaml` SHALL 不再包含 `drizzle-orm`/`pg`/`@types/pg`。
3. WHEN 运行 `pnpm scope-guard` THEN SHALL 通过（不得引入 teams/sharing/billing/quota 等受限概念）。

### Requirement 6: 验证

#### Acceptance Criteria
1. WHEN 提交前 THEN SHALL 通过 `pnpm typecheck`、`pnpm -F web build`、`pnpm scope-guard`、`pnpm test`、`pnpm test:properties`。
2. WHERE 涉及 Appwrite 读写 THEN SHALL 在本地 stack（`pnpm stack:up` + `pnpm schema:apply`）上跑通 `pnpm smoke` 或等价的端到端读写校验。
3. WHEN 实现 P-DATA-01 / P-SEC-04 THEN SHALL 在 `tests/properties/survey-editor/` 放可执行 PBT。

## Correctness Properties（本 Spec 拥有）

- **P-DATA-01**：对任意合法 `SurveyDraft`，`saveSurveyDraft` 后再 `getStudy` 组装出的 draft 与原 draft 语义等价（分节/问题顺序、题型、选项、probe、allowSkip 全部保持）。
- **P-SEC-04**：编辑器读写对非 `ownerUserId` 的 survey 一律拒绝/返回空，绝不跨用户读写。

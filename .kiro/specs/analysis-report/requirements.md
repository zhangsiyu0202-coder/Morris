# Requirements Document

## Feature: analysis-report（访谈分析报告）

## Introduction

本需求文档对应 Spec **analysis-report**，把 MerismV2 已落地的 LiveKit 实时访谈成果转化为研究员可读的结构化报告，并把当前以 mock 为支撑的两块功能迁到真实数据：

1. 页面助手 Morris 的研究类工具（`searchInterviewData` / `analyzeData` / `listStudies`）当前读 `apps/web/lib/agent-data.ts` 写死数据，迁到 Appwrite 真实数据。
2. 报告页 `/report` 当前显示 `apps/web/lib/mock-report.ts` 写死的整张报告，重写为按 `surveyId` 路由的 `/reports/[surveyId]`，从 Appwrite 真实读取由 `analyzeSurvey` Function 算出的 survey 级报告。

本 Spec 同时新建两个 Appwrite Function（`analyzeSession`、`analyzeSurvey`）与一个 `Insight` collection，并把现有 `apps/web/lib/actions/insights.ts` 从 Drizzle/Postgres 迁到 Appwrite。

设计与决策细节见 `design.md` 与 `docs/adr/0003-analysis-report-architecture.md`。本文档只规定"必须做什么 / 必须满足什么验收"。

## Prerequisite

- `foundation-setup/design.md §Components and Interfaces` 与 §Data Models（已落地）
- `docs/adr/0001-livekit-supervisor-interview-workflow.md`（实时访谈控制器）
- `docs/adr/0002-page-assistant-vercel-ai-sdk.md`（页面助手栈）
- `docs/adr/0003-analysis-report-architecture.md`（本 Spec 的核心设计决策 D1–D5）
- `ai-interview-engine` 的实际产出：transcript 与 session-level 状态已经在 Appwrite 中（`apps/agent/agent/persistence/`）

## Glossary

| 术语 | 含义 |
|---|---|
| **Session-level Report** | `AnalysisReport(scope=session)`；针对单次访谈的主题/洞察/引文 |
| **Survey-level Report** | `AnalysisReport(scope=survey)`；同一 survey 跨多次 session 的聚合报告 |
| **analyzeSession** | Appwrite Function：input=sessionId，output=session-level Report，写入 Appwrite |
| **analyzeSurvey** | Appwrite Function：input=surveyId，output=survey-level Report，写入 Appwrite |
| **Read Layer** | `apps/web/lib/queries/` 中的查询函数，通过 node-appwrite 读 Appwrite，含 ownership 校验 |
| **Insight** | 研究员对某 survey 提出的聚焦问题 + AI 生成的论证型回答（区别于自动生成的 Report） |
| **Page Assistant Tool** | Morris (`apps/web/lib/assistant/tools.ts`) 中的 4 个工具，本 Spec 接其中 3 个真实数据 |

## Scope

**包含**：
- analyzeSession / analyzeSurvey Function 的设计、契约、实现
- web 侧读出层 `apps/web/lib/queries/` 的设计、契约、实现
- `/reports`、`/reports/[surveyId]` 路由与 UI（重用现有 `components/report/*` 组件，只改数据源）
- Morris 三个读类工具切到真实数据
- Insights 从 Drizzle 迁到 Appwrite（新建 `Insight` collection，重写 `lib/actions/insights.ts`）
- 契约迁移：`AnalysisReportSchema` 完善 + 新增 `SurveyAnalysisReportOutputSchema` + 新增 `InsightSchema`
- agent worker 在 session 完成时链式触发 analyzeSession → analyzeSurvey
- 删除 `agent-data.ts` / `mock-report.ts`
- Correctness Properties 与 PBT 用例（P-ANL-01..04、P-SEC-04 扩展、P-DATA-04 落地）

**排除**：
- 编辑器（`survey-editor` 子 spec 的 Drizzle/Postgres `study` 表不动）
- Morris 第 4 个工具 `createStudyDraft` 的真实实现（继续 mock，标 TODO 指向 `survey-editor`）
- PDF / Markdown 导出渲染（report `rendered` 字段保持 nullable）
- 实时流式生成报告（Function 是请求-响应式）
- 多语言报告（中文 only）

## Requirements

### Requirement 1: analyzeSession Function

**User Story:** 作为平台维护者，我需要一个稳定的 server-side Function 把单次完成的访谈转换为结构化的主题/洞察/引文报告，以便后续 survey 级聚合与 Morris 工具读取。

#### Acceptance Criteria

1. THE 系统 SHALL 在 `apps/functions/analyzeSession/` 下提供 Appwrite Function，包含纯核心 `src/handler.ts` 与 SDK 包装 `src/main.ts`，遵循 `issueLivekitToken` 的 pure-core / SDK-wrapper 切分约定（AGENTS.md §Functions）。
2. THE Function `SHALL 接受 `{ sessionId: string }` 输入，并以 `@merism/contracts` 的 `AnalyzeSessionRequestSchema` 校验。
3. WHEN 输入合法且 `InterviewSession.state == completed` THEN Function SHALL 读取 (Survey + SurveySection + QuestionBlock + Transcript + collectedAnswers)，调用 DeepSeek 生成 `AnalysisReport(scope="session")`，落 Appwrite，返回 `{ reportId, scope: "session" }`。
4. IF `InterviewSession.state != completed` THEN Function SHALL 返回 409 `session_not_completed`，且不调用 LLM、不写入。
5. IF `sessionId` 不存在 THEN Function SHALL 返回 404 `session_not_found`。
6. THE 报告字段 SHALL 满足 P-ANL-01（每个 theme ≥ 1 条 evidence）与 P-DATA-04（citation 可回溯到 transcript segment）。
7. THE Function SHALL 是幂等的：同一个 `sessionId` 重复调用必更新（覆盖或新增最新版）同一份 `AnalysisReport(scope=session, sessionId)`，不留多份并存。
8. THE Function SHALL 通过 `packages/observability` 的 `withErrorBoundary` 包装；任何未捕获异常返回 5xx + `traceId`，DeepSeek key 不出现在响应或日志中。

### Requirement 2: analyzeSurvey Function

**User Story:** 作为研究员，我需要把同一 survey 跨多次 session 的报告聚合为一份 survey 级报告，以便从整体上看出题目分布、主题、洞察。

#### Acceptance Criteria

1. THE 系统 SHALL 在 `apps/functions/analyzeSurvey/` 下提供 Appwrite Function，结构与 R1 一致（pure core + SDK wrapper）。
2. THE Function SHALL 接受 `{ surveyId: string }` 输入。
3. WHEN 输入合法且至少存在一份 `AnalysisReport(scope=session, surveyId=...)` THEN Function SHALL 聚合所有 session-level 报告 + 必要时回读对应 transcript，生成 `AnalysisReport(scope="survey", surveyId)`，落 Appwrite，返回 `{ reportId, scope: "survey" }`。
4. IF 该 survey 没有任何 `state==completed` 的 session THEN Function SHALL 返回 409 `no_completed_sessions`，不调用 LLM、不写入。
5. THE 输出 SHALL 满足新增的 `SurveyAnalysisReportOutputSchema`：`questionStats[]`（按题型分布的纯数据 reduction，不需 LLM）、`sentimentBreakdown`、`themes[]`（跨 session 归并，含 `mentions/pct/sentiment`）、`insights[]`（含置信度 0..1）、`citations[]`（segmentRef 仍可回溯到原始 transcript）。
6. THE Function SHALL 是幂等的：同一个 `surveyId` 重复调用必更新同一份 `AnalysisReport(scope=survey, surveyId)`。
7. THE Function SHALL 同样满足 P-ANL-01；新增 P-ANL-03（`completedRespondents == # of session-level reports`）与 P-ANL-04（`sum(themes[].share) <= 1.0`）。
8. THE Function SHALL 通过 `packages/observability` 的 `withErrorBoundary` 包装；与 R1 同等机密保护要求。

## Requirements

### Requirement 1: analyzeSession Function

**User Story:** 作为平台维护者，我需要一个稳定的 server-side Function 把单次完成的访谈转换为结构化的主题/洞察/引文报告，以便后续 survey 级聚合与 Morris 工具读取。

#### Acceptance Criteria

1. THE 系统 SHALL 在 `apps/functions/analyzeSession/` 下提供 Appwrite Function，包含纯核心 `src/handler.ts` 与 SDK 包装 `src/main.ts`，遵循 `issueLivekitToken` 的 pure-core / SDK-wrapper 切分约定。
2. THE Function SHALL 接受 `{ sessionId: string }` 输入，并以 `@merism/contracts` 的 `AnalyzeSessionRequestSchema` 校验。
3. WHEN 输入合法且 session 状态为 completed THEN Function SHALL 读取 Survey 与 Transcript，调用 DeepSeek 生成 session 级报告，落 Appwrite，返回 reportId 与 scope。
4. IF session 未完成 THEN Function SHALL 返回 409 session_not_completed，不调用 LLM。
5. IF sessionId 不存在 THEN Function SHALL 返回 404 session_not_found。
6. THE 报告字段 SHALL 满足 P-ANL-01（每个 theme 至少 1 条 evidence）与 P-DATA-04（citation 可回溯）。
7. THE Function SHALL 幂等：同一 sessionId 重复调用更新同一份 session-level 报告。
8. THE Function SHALL 通过 packages/observability 的 withErrorBoundary 包装；任何未捕获异常返回 5xx + traceId，DeepSeek key 不出现在响应或日志中。

### Requirement 2: analyzeSurvey Function

**User Story:** 作为研究员，我需要把同一 survey 跨多次 session 的报告聚合为一份 survey 级报告，以便从整体上看出题目分布、主题、洞察。

#### Acceptance Criteria

1. THE 系统 SHALL 在 `apps/functions/analyzeSurvey/` 下提供 Appwrite Function，结构与 R1 一致（pure core + SDK wrapper）。
2. THE Function SHALL 接受 `{ surveyId: string }` 输入。
3. WHEN 输入合法且至少存在一份 session 级报告 THEN Function SHALL 聚合所有 session 级报告（必要时回读 transcript）生成 survey 级报告，落 Appwrite，返回 reportId 与 scope。
4. IF 该 survey 没有任何 completed session THEN Function SHALL 返回 409 no_completed_sessions，不调用 LLM。
5. THE 输出 SHALL 满足 SurveyAnalysisReportOutputSchema：questionStats（题型分布的纯数据 reduction）、sentimentBreakdown、themes（含 mentions/pct/sentiment）、insights（含置信度 0..1）、citations（segmentRef 可回溯）。
6. THE Function SHALL 幂等：同一 surveyId 重复调用更新同一份 survey-level 报告。
7. THE Function SHALL 满足 P-ANL-01；新增 P-ANL-03（completedRespondents 等于 session 级报告数）与 P-ANL-04（sum themes share 不超过 1.0）。
8. THE Function SHALL 通过 packages/observability 的 withErrorBoundary 包装；与 R1 同等机密保护要求。

### Requirement 3: Web 读出层 apps/web/lib/queries

**User Story:** 作为前端开发者，我需要一组带类型与 ownership 校验的 Appwrite 查询函数，以便 Morris 工具与报告页都从同一处真实数据源读取。

#### Acceptance Criteria

1. THE 系统 SHALL 在 `apps/web/lib/queries/` 下提供 Appwrite 查询函数：listStudies、getStudy、listSessions、searchTranscriptSegments、getLatestAnalysisReport、getInsightById、listInsights。
2. THE 每个查询 SHALL 在内部以当前登录 researcher 的身份执行（或使用受限 server key 并显式注入 ownerUserId 作为 filter）；返回前以 zod schema 校验，类型来自 @merism/contracts。
3. THE searchTranscriptSegments SHALL 接受 query string 与可选 surveyId，从对应 Transcripts 中筛出包含关键字的 segment（含 sessionId、speaker、text、startMs、endMs）。
4. THE getLatestAnalysisReport SHALL 接受 surveyId 与 scope（"session" 需 sessionId、"survey" 不需要），返回 0 或 1 份最新报告。
5. WHILE 调用方非该资源的 owner THE 查询 SHALL 返回 null（或在 RPC 风格中返回 forbidden 错误码）；任何越权读必须由 Appwrite Permission 规则在底层拦截，不依赖应用层判断。
6. THE 查询层 SHALL 不引入 Drizzle/Postgres；不向 apps/web 引入新的 ORM。

### Requirement 4: 报告路由 /reports 与 /reports/[surveyId]

**User Story:** 作为研究员，我需要按 surveyId 查看 survey 级报告，以及在多个 survey 之间列出可读报告的入口。

#### Acceptance Criteria

1. THE 系统 SHALL 提供 `apps/web/app/reports/page.tsx`：列出至少有一次 completed session 的 surveys，每条卡片显示 surveyTitle、completedRespondents、lastUpdatedLabel，点击进入详情。
2. THE 系统 SHALL 提供 `apps/web/app/reports/[surveyId]/page.tsx`：根据 surveyId 读取最新 survey 级报告，按 D5 三态显示（empty / loading / rendered），rendered 时复用现有 components/report/* 组件。
3. WHEN 报告 rendered THEN 页面 SHALL 提供"重新生成"按钮，点击后调 analyzeSurvey Function，成功后刷新页面。
4. IF 查询返回 null（无 session）THEN 页面 SHALL 显示 D5 empty 态文案（"尚无完成的访谈"），不调用 Function。
5. THE 旧路由 `apps/web/app/report/page.tsx` SHALL 被删除；任何指向旧路径的链接需要被更新或重定向。
6. THE 系统 SHALL 删除 `apps/web/lib/mock-report.ts`；components/report/* 的类型 import 切到 @merism/contracts 与 query 返回类型。

### Requirement 5: Morris 三个读类工具切真实数据

**User Story:** 作为研究员，我需要 Morris 在工具调用中给出基于真实访谈数据的检索/聚合/列表，而不是 mock 常量。

#### Acceptance Criteria

1. THE listStudies 工具 SHALL 调用 query 层 listStudies 返回真实 Appwrite Survey 列表（含 status / responses / completionRate）。
2. THE searchInterviewData 工具 SHALL 调用 query 层 searchTranscriptSegments，接受可选 studyId，返回真实命中片段。
3. THE analyzeData 工具 SHALL 调用 query 层 getLatestAnalysisReport(scope=survey)；命中时返回结构化结果；未命中时返回 { error: true, message: "尚无报告，请先生成或等待完成访谈" }，工具层不主动触发 analyzeSurvey。
4. THE 第 4 个工具 createStudyDraft SHALL 在本 Spec 中保留 mock 行为，但工具描述与 system prompt 中需明确告知"此能力依赖 survey-editor 子 spec 落地"。
5. THE 系统 SHALL 删除 `apps/web/lib/agent-data.ts`；assistant/tools.ts 中不再 import 任何 mock 数据；tool 内部错误兜底（{ error: true, message }）行为保持。

### Requirement 6: Insights 迁到 Appwrite

**User Story:** 作为研究员，我需要把 Insights 从 Drizzle 持久化迁到 Appwrite，以保证除编辑器之外没有第二种持久化栈。

#### Acceptance Criteria

1. THE packages/appwrite-schema SHALL 新增 Insight collection（字段对齐 lib/db/schema.ts 的 insight 表：studyId / studyTitle / question / headline / summary / confidence / sampleSize / report jsonb / createdAt）；Permission 仅 owner researcher 可读写。
2. THE packages/contracts SHALL 新增 InsightSchema entity 与 Python 镜像；apps/web/lib/insights.ts 的 insightReportSchema 留作 LLM 输出 schema，但 Insight 实体 schema 独立定义于 contracts。
3. THE apps/web/lib/actions/insights.ts SHALL 重写：listInsights / getInsightById / createInsight / deleteInsight 全部走 node-appwrite Server SDK，不再依赖 drizzle-orm 与 apps/web/lib/db。
4. THE buildStudyContext SHALL 调 query 层（searchTranscriptSegments + getLatestAnalysisReport）拼装真实 grounding，不再读 agent-data.ts。
5. THE apps/web/lib/db/schema.ts 中的 insight pgTable SHALL 被删除；如果 study 表是该文件中仅剩的内容，整个文件保留但只剩 study；apps/web 包中 drizzle-orm 与 pg 的依赖在 insight 删除后仍因 study 保留，本 Spec 不做包级清理。
6. THE 现有 lib/insights.ts 中的 listStudyOptions 与 isValidStudyId SHALL 改走 query 层；如果在编辑器尚未迁移到 Appwrite 时该查询拿不到数据，需要在文档中明确该限制（参见 design.md §Open Questions）。

### Requirement 7: agent worker 链式触发 analyze Functions

**User Story:** 作为平台维护者，我需要 session 完成时自动产出最新 survey 报告，无需研究员手动操作。

#### Acceptance Criteria

1. WHEN agent worker 把 InterviewSession.state 置为 completed 并完成 transcript / recording 关联 THEN agent SHALL 调用 analyzeSession Function（fire-and-await，但失败不回滚 session 完成状态）。
2. WHEN analyzeSession 返回成功 THEN agent SHALL 调用 analyzeSurvey Function（同样 fire-and-await）。
3. IF analyzeSession 或 analyzeSurvey 失败 THEN agent SHALL 在 logger 中以 traceId 记录错误，但不影响 session 数据持久化（session、transcript、recording 仍以 completed 状态留存）。
4. THE agent server key SHALL 持有 functions.execute 权限（限定到这两个 Function ID）以及 AnalysisReport 与 Insight 的写权限；apps/agent 与 packages/appwrite-schema 一致。
5. THE 重新生成 入口 SHALL 与 agent 链式触发共用同一 Function；不允许在多处实现重复的 LLM 调用。

### Requirement 8: 契约更新

**User Story:** 作为跨模块开发者，我需要契约层先于消费者更新，以便编译器能在 schema 变更时强制呈现破坏性影响。

#### Acceptance Criteria

1. THE @merism/contracts SHALL 修订 AnalysisReportSchema：sessionId 改为 optional，新增 superRefine 规则：scope==session 时 sessionId 必填；scope==survey 时 surveyId 必填、sessionId 必须缺省。
2. THE @merism/contracts SHALL 新增 SurveyAnalysisReportOutputSchema 描述 survey 级输出（questionStats discriminated union: choice / rating / nps；sentimentBreakdown；themes；insights；citations；rendered? optional）。
3. THE @merism/contracts SHALL 新增 InsightSchema entity；同步在 apps/agent/agent/contracts.py 加 pydantic 镜像（哪怕 agent 当前不读 Insight，保持 schema 名称对齐）。
4. THE 现有 AnalyzeSessionResponseSchema SHALL 维持不变；新增 AnalyzeSurveyRequestSchema 与 AnalyzeSurveyResponseSchema。
5. WHEN 契约修订完成 THEN pnpm typecheck SHALL 在所有消费者（apps/functions、apps/web、apps/agent）出现编译错误，强制呈现破坏性影响；契约修订与 R1..R7 必须在同一 PR 内修齐。

### Requirement 9: Correctness Properties 与 PBT 落地

**User Story:** 作为平台维护者，我需要可执行的不变量与对应 PBT 用例，以便后续修改不会悄悄破坏报告的可信度。

#### Acceptance Criteria

1. THE 系统 SHALL 在 tests/properties/analysis-report/ 下新建 PBT 目录，覆盖：P-ANL-01（每个 theme 至少 1 条 evidence）、P-ANL-02（每道题至少 1 条 perQuestionSummary）、P-ANL-03（survey 级 completedRespondents 等于 session 级报告数）、P-ANL-04（sum themes share 不超过 1.0）、P-DATA-04（citation 可回溯到 transcript segment）。
2. THE PBT SHALL 用 fast-check 生成多种合法/非法 transcript + survey 输入，调用 analyzeSession / analyzeSurvey 的 pure handler 验证不变量；不依赖真实 DeepSeek（用 mock LLM 适配器返回结构化样本）。
3. THE 系统 SHALL 扩展现有 P-SEC-04（页面助手写操作越权拒绝）覆盖 Insight 与 AnalysisReport 写路径：anonymous 与非 owner researcher 调用 Function 时返回 403。

### Requirement 10: 范围边界守卫

**User Story:** 作为产品负责人，我需要确保本 Spec 不引入超出范围的功能，避免被既成事实绑架。

#### Acceptance Criteria

1. THE 本 Spec 的设计与代码 SHALL 不引入任何 teams / collaboration / sharing / comments / billing / subscriptions / quotas 概念；pnpm scope-guard 必须在 CI 通过。
2. THE 本 Spec SHALL 不实现 PDF / Markdown 导出（rendered 字段保留 nullable，等待后续单独立项）。
3. THE 本 Spec SHALL 不修改 apps/web/components/studies/* 与 apps/web/lib/{guide,actions/studies,actions/guide-ai,db}/* 中的编辑器栈代码。createStudyDraft 工具继续 mock。
4. IF 实现过程中需要触动编辑器栈 THEN 实现者 SHALL 停下并要求显式扩展 Spec 范围或拆出新 Spec（survey-editor）。

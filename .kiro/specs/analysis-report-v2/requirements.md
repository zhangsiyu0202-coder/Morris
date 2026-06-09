# Requirements Document

## Feature: analysis-report-v2（分析报告 v2:质量分类 / 抗幻觉 / 二段式聚合）

> **Footnote (notebooks sub-spec, 2026-06):** Same `Insight` → `Notebook` rename note as in `analysis-report/requirements.md`. The text below preserves the original wording.

## Introduction

本需求文档对应 Spec **analysis-report-v2**，目的是把已落地的 `analysis-report` 子 spec（`analyzeSession` + `analyzeSurvey` + `/reports/[surveyId]`）从"能跑通"升级到"会议级可用、跨 session 数 N 增长后仍稳定准确"。

借鉴对象是 PostHog `ee/hogai/session_summaries/` 与 `products/user_interviews/` 模块在工程层踩过的三类坑：

1. **质量分类（Quality Flags）**：访谈"完成"不代表"有用"。受访者说了 30 分钟全是闲聊也叫 `state=completed`，研究员只能事后看报告才知道这场没价值。借鉴 PostHog `UserInterview.classifications` 的设计，给 `InterviewSession` 加一组 AI 推导的 `qualityFlags` 标签，研究员侧能直接过滤。
2. **抗幻觉（Hallucination Ratio）**：当前 `AnalysisReport` 的 `segmentRef` 仅靠 zod schema 校验"格式"，无法保证它真的指向存在的 `transcriptId#segmentIndex`。借鉴 hogai `HALLUCINATED_EVENTS_MIN_RATIO = 0.15` 的思路，引入"事后校验 + 超阈值整次 reject + 重试一次 + 仍超则落 failed"的强约束。
3. **二段式聚合（Theme Extraction + Assignment）**：当前 `analyzeSurvey` 让 LLM 一次完成"找共性 themes / 给 themes 分配 sessions / 写 insights / 写 perQuestion summary" 四件事，session 数 N 增长后 prompt 体积线性涨 + 模型在 mentions/pct 算术上容易出错。借鉴 hogai `session_group/` 的二段式：先让 LLM 做 theme extraction（不带归属），再用第二次调用做 theme assignment（每条 session 选哪些 themes），mentions/pct 由代码算。

本 Spec 只动 `apps/functions/analyzeSession/` 与 `apps/functions/analyzeSurvey/`，外加 `packages/contracts` / `packages/appwrite-schema` 的契约升级，不改 web 层、不改 Morris 工具、不改 LiveKit Agent。

## Prerequisite

- `foundation-setup/design.md §Components and Interfaces` 与 §Data Models（已落地）
- `analysis-report/design.md`（已落地的 analyzeSession / analyzeSurvey 双 Function、AnalysisReport collection、`/reports/[surveyId]` RSC 渲染、Morris `analyzeData` 工具）
- `docs/adr/0003-analysis-report-architecture.md`（DeepSeek 分析栈与归并约束）
- 借鉴来源（仅作参考实现，不直接依赖代码）：
  - `/home/jia/posthog/ee/hogai/session_summaries/` —— hallucination ratio + 二段式 + 三段式（chunk combine）的工程实现
  - `/home/jia/posthog/products/user_interviews/backend/classification.py` —— 规则 + LLM 派生 qualityFlags 的混合做法

## Glossary

| 术语 | 含义 |
|---|---|
| **InterviewSession.state** | 系统流程状态：`created` / `in_progress` / `completed` / `abandoned` / `failed`。由 supervisor / receiver flow 推动。 |
| **InterviewSession.qualityFlags** | 内容质量标签数组（本 Spec 新增）。由 `analyzeSession` 在分析完成时推导，用于研究员筛选"哪些 session 真的有研究价值"。 |
| **HallucinationRatio** | `AnalysisReport` 中所有 `segmentRef` 中"指向不存在的 transcript+segmentIndex"的占比。本 Spec 把它显式做成 KPI：超阈值整次 reject 重试。 |
| **GenerationMeta** | `AnalysisReport` 上新增的 JSON 字段，记录 `promptVersion` / `hallucinationRatio` / `attemptCount` / 各阶段的 model + token usage。便于回溯"这份报告是哪版 prompt 跑出来的"。 |
| **ThemeExtraction** | analyzeSurvey 二段式的第一步：跨 session 找共性主题，输出 `themes: [{label, description, severity?, indicators?}]`，**不带 session 归属**。 |
| **ThemeAssignment** | analyzeSurvey 二段式的第二步：对每条 session 让 LLM 决定它属于哪些 themes，输出 `assignments: [{themeId, sessionIds[], evidenceRefs[]}]`。`mentions = sessionIds.length`、`pct = mentions / totalSessions × 100` 由代码算。 |

## Scope

**包含**：

1. **InterviewSession.qualityFlags**：契约新字段（数组 string，固定枚举集合）+ Appwrite schema attribute + `analyzeSession` 推导逻辑（规则 + LLM 混合）。
2. **AnalysisReport.generationMeta**：契约新字段（json，自由 key/value 映射）+ schema attribute + 两个 Function 落库时写入。
3. **抗幻觉校验**：`analyzeSession` 与 `analyzeSurvey` 都加 hallucination ratio 校验。超阈值（默认 0.15）→ reject → 重试一次 → 仍超 → 落 `state="failed"` + 在 `errorContext` 中记录原因，**绝不写脏数据**。
4. **analyzeSurvey 二段式 rollup**：把现有单次 `rollupWithLLM` 拆成 `extractThemesWithLLM` + `assignThemesWithLLM` 两次调用。`mentions` / `pct` 由纯函数 `enrichSurveyThemes(...)` 计算（不再让 LLM 算算术，从根本消除 P-ANL-04 违规可能）。最终落库形态保持 `SurveyAnalysisReportOutputSchema` 不变。
5. **Prompt 版本化**：`promptVersion: "session.v2.0"` / `"survey.v2.0"` 字符串硬编码在各 Function 的 prompts 模块，落入 `generationMeta.promptVersion`，让后续 sweep / 回放 / eval 能区分新旧。
6. Correctness Properties：P-ANL-05（hallucination zero-tolerance for stored）、P-ANL-06（qualityFlags 互斥规则）、P-ANL-07（二段式 themes 集合一致性）。

**排除**：

- 不引入 chunk + combination 三段式（hogai 的第三阶段）。我们 N 远低于 hogai chunk 阈值（10 session / chunk），落地复杂度不抵当前收益。等真有"完成 session 数 ≥ 30"的 survey 出现再说。
- 不改 `/reports/[surveyId]` 渲染（最终落库形态不变 → 渲染不动）。
- 不改 Morris `analyzeData` 工具（消费的字段集仍然是 `themes` / `insights` / `topThemes` / `topInsights` 这一层，不感知 generationMeta）。
- 不引入 `AnalysisReportSweep` 自动重跑 Function（前面讨论过的 auto-sweep 是单独的 cron 工作量，留给独立 sub-spec `analysis-report-sweep`，不挤进本 Spec）。
- 不改 `analyzeSession` 的视觉分析层（Gemini segment + consolidation 不动；hallucination 校验只对结构化 `themes/insights/citations` 的 segmentRef 适用）。
- 不引入 cross-study 聚合（`crossStudyDigest` 工具留给 `morris-skills-and-cross-study` 子 spec，本 Spec 只确保它读到的 AnalysisReport 准确稳定）。
- 不重新生成历史已存的 AnalysisReport（promptVersion 用于将来的 sweep 区分，不在本 Spec 内回填）。

## Requirements

### Requirement 1: InterviewSession.qualityFlags（内容质量分类）

**User Story:** 作为研究员,我需要一眼看到"这场访谈是不是真的有研究价值",而不是只看到"已完成"这种系统流程状态。

#### Acceptance Criteria

1. WHEN 契约升级 THEN `InterviewSessionSchema` SHALL 新增字段 `qualityFlags: z.array(SessionQualityFlagSchema).default([])`,其中 `SessionQualityFlagSchema = z.enum([...])` 列出受控集合（见 design §3）。
2. WHERE Appwrite schema THEN `interview_sessions` collection SHALL 新增 attribute `qualityFlags: string[]`（Appwrite 数组 string 类型），并新增索引 `by_quality` 以支持按 flag 过滤查询。
3. WHEN `analyzeSession` Function 完成分析（含 hallucination 校验通过）THEN 它 SHALL 推导 qualityFlags 并把数组回写到对应 `interview_sessions` 文档（与 `AnalysisReport` 落库在同一段事务的概念性边界内,Appwrite 缺失原生事务时使用 best-effort 双写 + 失败日志）。
4. WHERE 推导规则 THEN `analyzeSession` SHALL 使用"规则优先 + LLM 兜底"的混合策略（规则负责 mechanical 判定如 `silent` / `too-short`,LLM 负责语义判定如 `off-topic` / `shallow`），具体规则见 design §3.3。
5. WHEN 历史已存在的 InterviewSession 没有 qualityFlags 字段值 THEN 读取层 SHALL 视为空数组（默认值生效）,不破坏 `/reports/[surveyId]` 与现有列表渲染。
6. WHEN 运行 `pnpm -F @merism/contracts typecheck && pnpm typecheck` THEN 全仓 SHALL 通过。

### Requirement 2: AnalysisReport.generationMeta（生成元信息）

**User Story:** 作为平台维护者,我需要知道"这份分析报告是哪版 prompt 跑出来的、用了几次 LLM 调用、幻觉率多少",以便后续 prompt 升级时能定位需要重跑的报告。

#### Acceptance Criteria

1. WHEN 契约升级 THEN `AnalysisReportOutputSchema` 与 `SurveyAnalysisReportOutputSchema` SHALL 新增可选字段 `generationMeta: GenerationMetaSchema.optional()`,新字段不影响现有渲染（`/reports/[surveyId]` 不读取它）。
2. WHERE `GenerationMetaSchema` THEN SHALL 至少包含: `promptVersion: string`、`attemptCount: z.number().int().nonnegative()`、`hallucinationRatio: z.number().min(0).max(1)`、`createdWith: z.array(z.object({stage, model, inputTokens, outputTokens}))`。允许向前兼容地扩展更多 key（`z.object` + `.passthrough()` 或独立扩展字段）。
3. WHERE Appwrite schema THEN `analysis_reports` collection SHALL 新增 attribute `generationMeta: string` (JSON_SIZE,可选),Function 落库时序列化写入。
4. WHEN 两个 Function 落库 THEN 它们 SHALL 在 `generationMeta.promptVersion` 中写入硬编码的版本字符串 (`"session.v2.0"` / `"survey.v2.0"`),版本号一旦发布即不可变,prompt 改了必须 bump 到 v2.1 / v3.0 等。
5. WHERE Morris `analyzeData` 工具 THEN SHALL 不感知 generationMeta（继续只读 `themes` / `insights` 字段集），保持向前兼容。

### Requirement 3: 抗幻觉校验（Hallucination Ratio Reject + Retry）

**User Story:** 作为研究员,我需要 AnalysisReport 中的每条 segmentRef 真的能在对应 transcript 里找到——绝不要"AI 说了一段听起来很合理的引文,我点进去发现 transcript 没那段"的事故。

#### Acceptance Criteria

1. WHERE 纯函数 `checkHallucinationRatio(report, validRefs): { ratio, ok, badRefs }` THEN SHALL 提供在 `apps/functions/<name>/src/hallucination.ts`,纯函数,可单测。`validRefs` 是 `Set<"transcriptId#segmentIndex">`,`badRefs` 列出指向不存在条目的引用。
2. WHEN `analyzeSession` 调用 LLM 拿到结构化输出 THEN 它 SHALL 在落库前调一次 `checkHallucinationRatio`,把 `themes[].evidence[]` 与 `citations[].segmentRef` 一并校验。
3. IF `ratio > HALLUCINATION_RATIO_THRESHOLD`（默认 0.15）AND `attemptCount === 1` THEN Function SHALL 不落库,带"幻觉提示"重新调一次 LLM,attemptCount 累加。重试 prompt 的语义是**用 valid refs 替换 bad refs**(不是删除):每个 theme 至少要留 1 条 valid evidence (满足 `.min(1)`); 若某 theme 找不到任何 valid refs 可用,该 theme 在第二次输出中**整体丢弃**,从而避免与 `themes[].evidence: z.array(...).min(1)` 约束冲突。
4. IF 重试后 `ratio` 仍超阈值 THEN Function SHALL **不写脏数据**,而是: (a) 把 `interview_sessions.errorContext = { reason: "hallucination_threshold_exceeded", ratio, attemptCount, badRefs: badRefs.slice(0, 10) }`,(b) 返回 `500 analysis_failed`(如果是同步调用方) 或 `409 analysis_rejected`,(c) 在服务端日志里 warn。
5. WHEN `analyzeSurvey` 二段式 rollup 完成 THEN 它 SHALL 校验 `themes[].evidence` / `citations[].segmentRef` 全部指向"实际存在于该 survey 的某条已 stored AnalysisReport(scope=session) 的 transcripts 集合"中的条目。
6. WHERE Appwrite schema 已记录的历史 AnalysisReport（v1）THEN SHALL 不被本机制反向作废（仍按原状态保留）;校验只对 v2 路径产生的新报告生效。
7. WHERE `HALLUCINATION_RATIO_THRESHOLD` THEN SHALL 是常量在 `prompts/` 同目录的 `constants.ts` 中,允许后续根据线上数据调优。
8. WHERE `generationMeta.hallucinationRatio` THEN SHALL 记录"**通过那次 attempt 的 ratio**"(不是最大、不是最后);两次都失败的情况下整次 reject 不落库,因此 generationMeta 也不会写出。

### Requirement 4: analyzeSurvey 二段式 rollup

**User Story:** 作为平台维护者,我需要 N 个 session 聚合时 LLM 不再一次干四件事(找 themes / 算 mentions / 写 insights / 写 perQuestion summary),否则 N 涨到 30+ 时会幻觉 + 算错比例。

#### Acceptance Criteria

1. WHERE `apps/functions/analyzeSurvey/src/rollup.ts` THEN SHALL 提供两个独立的纯函数边界:
   - `extractThemesWithLLM(sessionReports): Promise<ExtractedThemesList>` —— 第一次 LLM 调用,只做"跨 session 找共性 themes",输出不带归属。
   - `assignThemesWithLLM(themes, sessionReports): Promise<ThemeAssignmentList>` —— 第二次 LLM 调用,对每个 session 决定它属于哪些 themes,输出 `assignments: [{themeId, sessionIds[], evidenceRefs[]}]`。
2. WHERE 纯函数 `enrichSurveyThemes(themes, assignments, totalSessions): SurveyThemeBlock[]` THEN SHALL 由代码计算 `mentions = sessionIds.length` 与 `pct = mentions / totalSessions × 100`,**LLM 不再做算术**。
3. WHEN handler 编排 THEN 它 SHALL 依次执行: `aggregateQuestionStats`(已有) → `extractThemesWithLLM` → `assignThemesWithLLM` → `enrichSurveyThemes` → 第三次 LLM 调用 `composeInsightsAndCitations`(基于 enrichedThemes 写 insights / citations / topics / sentimentBreakdown / perQuestion summary)。
4. WHERE 中间态 THEN `ExtractedThemesList` 与 `ThemeAssignmentList` 仅在 Function 内存活,不持久化到 Appwrite,不进契约 entity 层。它们的 zod schema 在 `packages/contracts/src/api.ts` 内私有(不 export 给消费者)。
5. WHEN 任一 LLM 调用失败 THEN handler SHALL 走 R3 的重试机制（同一阶段重试一次）;两次都失败则整次 reject,不写半途数据。
6. WHEN 二段式产出的最终 `SurveyAnalysisReportOutput` 落库 THEN 它 SHALL 与单段式产出**在 schema 上完全等价**(`themes` / `insights` / `citations` / 等字段结构不变),保证 `/reports/[surveyId]` 渲染零改动。
7. WHEN P-ANL-04 (themes share ≤ 1.0) 由代码保证 THEN `enrichSurveyThemes` SHALL 显式做 sum(pct/100) ≤ 1.0 + ε 的断言,超出时按 mentions 降序 normalize 到 1.0 之内。

### Requirement 6: 大样本 chunk + combination 三段式（D15 撤销 D8）

**User Story:** 作为研究员，当我的 study 收到 15-30 个访谈时，单次 prompt 拼所有 session-level reports 会接近 DeepSeek 上下文窗口上限并降低 theme 抽取精度；我需要 analyzeSurvey 在大样本下自动启用 hogai 风格的"分块抽取 → LLM 合并 → 分块分派 → 代码聚合"。

#### Acceptance Criteria

1. WHEN `sessionReports.length > EXTRACTION_CHUNK_THRESHOLD`（默认 10） THEN handler SHALL 把 `sessionReports` 按 `EXTRACTION_CHUNK_SIZE`（默认 10）切成多个 chunk，并行跑 `extractThemesWithLLM` 得 `ExtractedThemes[]`，再调一次 `combineThemesWithLLM(rawList)` 把多份 themes 合并去重为统一的 `ExtractedThemes`。
2. WHEN `sessionReports.length <= EXTRACTION_CHUNK_THRESHOLD` THEN handler SHALL 保持 v2 单次 `extractThemesWithLLM(allReports)` 路径，**不**调用 combination LLM（节省一次 token 成本）。
3. WHEN `assign` 阶段 THEN handler SHALL 始终把 `sessionReports` 按 `ASSIGNMENT_CHUNK_SIZE`（默认 10）切成 chunk 并行跑 `assignThemesWithLLM(themes, chunk)`，得 `ThemeAssignments[]`，再用纯函数 `mergeThemeAssignments(list)` 按 `themeId` 合并 `sessionIds`（dedupe）+ `evidenceRefs`（dedupe by `transcriptId#segmentIndex`）。该路径在 N=1 与 N=100 时均生效（不再判分支）。
4. WHERE `apps/functions/analyzeSurvey/src/constants.ts` THEN SHALL 提供 `EXTRACTION_CHUNK_THRESHOLD` / `EXTRACTION_CHUNK_SIZE` / `ASSIGNMENT_CHUNK_SIZE` 三个 export 常量，便于调优。
5. WHERE `apps/functions/analyzeSurvey/src/prompts/theme-combination.ts` THEN SHALL 内嵌 hogai `prompt_consolidation_instructions` 同款"feature area / root cause / 2+ indicators 重叠 → MERGE，否则 KEEP" 判定规则；输出 schema 复用 `ExtractedThemesListSchema`，不引入新 schema。
6. WHEN combination LLM 失败（zod 校验、HTTP 错） THEN handler SHALL 整次 reject（按 R3 同样的 retry-once 然后 fail 的语义；combination 不复用 R3 的 hallucination retry 路径，hallucination 校验在 compose 阶段后进行，与 D15 之前等价）。
7. WHEN chunked 路径产出 `(themes, assignments)` 进入 `enrichSurveyThemes` 与 `composeInsightsWithLLM` THEN 后续流水线 SHALL 与 R4 完全一致（generationMeta、hallucination check、upsert 等无差别）。

### Requirement 5: 验证

#### Acceptance Criteria

1. WHEN 提交前 THEN SHALL 通过 `pnpm typecheck`、`pnpm -F web build`、`pnpm scope-guard`、`pnpm test`、`pnpm test:properties`。
2. WHEN 实现 P-ANL-05 / P-ANL-06 / P-ANL-07 / P-ANL-08 THEN SHALL 在 `tests/properties/analysis-report-v2/` 放可执行 PBT。
3. WHERE `apps/functions/analyzeSession/tests/` 与 `apps/functions/analyzeSurvey/tests/` THEN SHALL 覆盖:
   - 规则路径: 受访者 silent → qualityFlags 含 `silent`;受访者发言 < 30s → 含 `too-short`;正常 → 不含 mechanical flag。
   - LLM 路径: 给定 mock LLM 返回的"全部偏题"回复时,推导出 `off-topic`;返回"shallow"时推导出 `shallow`;正常深入访谈推导出 `fluent`。
   - hallucination 注入: mock LLM 返回包含 N 个 segmentRef,其中 M 个是不存在的;ratio = M/N,M/N > 0.15 时第一次 reject + 重试,第二次仍超时 Function 返回 `analysis_rejected`,`interview_sessions.errorContext` 写入 `hallucination_threshold_exceeded`。
   - 二段式 rollup: 给定 N 份 mock session reports,两次 LLM 调用 mock 返回,验证 `enrichSurveyThemes` 计算的 mentions/pct 与"原 LLM 一段式 mock 输出"在 schema 字段上完全等价。
4. WHEN 端到端 THEN SHALL 在本地 stack（`pnpm stack:up` + `pnpm schema:apply`）上跑通 `pnpm smoke` 或等价的 Function 触发链,验证 v2 路径的 AnalysisReport 落库且 generationMeta.promptVersion 写入正确。
5. WHEN 本 Spec 范围内的代码改动落地 THEN ADR-0003 的核心结论 SHALL 不变（DeepSeek 仍是唯一分析 LLM,Gemini 仍只做视觉分析,scope=session/survey 仍是分析报告唯二两种）。

## Correctness Properties（本 Spec 拥有）

- **P-ANL-05 — Stored Hallucination-Free 不变量**：对任意已落库（`scope=session` 或 `scope=survey`）的 `AnalysisReport`,所有 `themes[].evidence[]` 与 `citations[].segmentRef` 中的 `(transcriptId, segmentIndex)` 二元组,必能在对应 `Transcript.segments` 中找到（`segmentIndex < segments.length`）。换言之: hallucination ratio 在落库后必然为 0。失败的报告**根本不会落库**。
- **P-ANL-06 — qualityFlags 互斥规则**：`SessionQualityFlagSchema` 枚举集合中互斥的子集（如 `silent` 与 `fluent` 不共存,`too-short` 与 `deep-engagement` 不共存）由 zod superRefine 在 schema 层强制,推导函数不允许产出违反组合;若发生 LLM 输出违反规则,推导层 SHALL 按规则优先级（mechanical > LLM）剔除冲突项。
- **P-ANL-07 — 二段式 rollup mentions/pct 精确性**：对任意输入 `(themes, assignments, totalSessions)`,`enrichSurveyThemes(...)` 输出的每个 theme 的 `mentions` 严格等于 `assignments[i].sessionIds.length`,`pct` 严格等于 `mentions / totalSessions × 100`(向下取整或保留 2 位小数,见 design D5);所有 themes 的 `pct/100` 之和满足 P-ANL-04（≤ 1.0,超出时由代码 normalize）。
- **P-ANL-08 — chunked rollup 等价性**：在不开启 LLM combination 的纯函数维度上，对任意输入 `(themes, assignments, totalSessions)`：
  - `chunkSessionReports(reports, size)` 满足 `concat ∘ chunkSessionReports(_, size) = id`（无丢失、无重复、保序）；
  - `mergeThemeAssignments` 满足结合律 + 交换律：把同一组 `assignments` 拆成任意分组并 merge，得到的 `(themeId → sessionIds)` 映射与一次性 merge 结果完全一致；
  - 同一 `(themeId, sessionId)` 在合并后不重复出现（保护 P-ANL-07 的 mentions 精确性）；
  - 当 N ≤ THRESHOLD 时，单次路径与（人为强制走 chunked 后）纯函数 merge 路径产出的 `(themes, assignments) → enrichSurveyThemes` 落库形态字段集（`themes[].id/label/mentions/pct` 集合）一致。


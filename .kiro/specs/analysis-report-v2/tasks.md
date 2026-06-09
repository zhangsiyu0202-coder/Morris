# Implementation Plan — analysis-report-v2

每个任务保持 `pnpm typecheck` 绿、可独立提交与回退。涉及 Function 改动的任务需用 `apps/functions/<name>/tests/` 内存 deps 跑通,涉及 Appwrite schema 的任务需 `pnpm schema:apply && pnpm schema:verify` 验证幂等。

## Wave A — 契约改动（contracts-first）

- [ ] **T1** 在 `packages/contracts/src/entities.ts` 新增 `SessionQualityFlagSchema = z.enum([...])`(8 个值, 见 design §4.1)与 `SessionQualityFlag` 类型;给 `InterviewSessionSchema` 加 `qualityFlags: z.array(SessionQualityFlagSchema).default([])`,并在 schema 末尾用 `superRefine` 落 P-ANL-06 互斥规则。`pnpm -F @merism/contracts typecheck` 与契约测试全绿。

- [ ] **T2** 在 `packages/contracts/src/api.ts` 新增 `GenerationMetaSchema`(含 `promptVersion / attemptCount / hallucinationRatio / createdWith[]`,`.passthrough()` 兼容扩展);给 `AnalysisReportOutputSchema` 与 `SurveyAnalysisReportOutputSchema` 各加 `generationMeta: GenerationMetaSchema.optional()`。导出类型 `GenerationMeta = z.infer<typeof GenerationMetaSchema>`。

- [ ] **T3** （仅备忘,无产出文件）二段式中间态 `ExtractedThemesListSchema` / `ThemeAssignmentListSchema` 与对应类型**不上 contracts**(D14 决策),改为在 Wave D T20 中,直接定义在 `apps/functions/analyzeSurvey/src/rollup.ts` 本地。本任务为防止后续误把它们加到 `packages/contracts` 设的"占位 + 提醒"项,无需提交 commit。

- [ ] **T4** 全仓 typecheck 修补面: `apps/functions/analyzeSession/src/handler.ts` 与 `analyzeSurvey/src/handler.ts` 的 `AnalyzeSessionResult` / `AnalyzeSurveyResult` 类型签名因 generationMeta 可选字段加入而需要更新(只是 type-level,不动运行时逻辑)。`pnpm typecheck` 全绿。

## Wave B — Appwrite Schema

- [ ] **T5** 在 `packages/appwrite-schema/src/schema.ts::interview_sessions.attributes` 加:
  ```ts
  { key: "qualityFlags", type: "string", size: 32, required: false, array: true }
  ```
  **不写 `default: []`** —— 当前 `AttrDef.default` 联合类型不接受数组(C2 复审决策)。Appwrite 数组字段对已存文档默认为 `[]`,新文档由 `InterviewSessionSchema` 的 zod `.default([])` 兜底,效果等价。
  并在 `indexes` 加 `{ key: "by_quality", type: "key", attributes: ["qualityFlags"] }`(用于按 flag 过滤查询)。

- [ ] **T6** 在 `analysis_reports.attributes` 加:
  ```ts
  { key: "generationMeta", type: "string", size: JSON_SIZE, required: false }
  ```
  无需新索引(generationMeta 是 read-only 元数据,不参与查询)。

- [ ] **T7** 跑 `pnpm schema:apply` 验证幂等添加(已应用过的不动,新增字段平滑落地)+ `pnpm schema:verify` 通过。给现有的 `interview_sessions` / `analysis_reports` 文档**不做**回填(D12 决策:历史数据不回填),新写入路径自然带新字段。

## Wave C — analyzeSession 加固

- [ ] **T8** 新增 `apps/functions/analyzeSession/src/constants.ts`: 导出 `HALLUCINATION_RATIO_THRESHOLD = 0.15`、`SESSION_QUALITY_FLAG_LLM_TEMPERATURE = 0.2`、`SILENT_RESPONDENT_MIN_CHARS = 50`、`TOO_SHORT_RESPONDENT_MAX_CHARS = 200`、`TOO_LONG_DURATION_MS = 60 * 60_000`。

- [ ] **T9** 新增 `apps/functions/analyzeSession/src/prompts/version.ts`: `export const PROMPT_VERSION = "session.v2.0"`。

- [ ] **T10** 新增纯函数 `apps/functions/analyzeSession/src/hallucination.ts`: `checkHallucinationRatio(args)` 接受 `{ themes, citations, validRefs, threshold }`,返回 `{ ratio, ok, totalRefs, badRefs }`(见 design §6.1)。`badRefs` 切片到前 10 个。加 `tests/hallucination.test.ts` 单测覆盖 ratio 计算、ok 边界、空 refs 路径。

- [ ] **T11** 新增 `apps/functions/analyzeSession/src/quality-flags.ts`:
  - `deriveQualityFlagsRule(transcript, totalDurationMs)`: 纯函数,产 mechanical flags 子集(silent / too-short / too-long)。
  - `deriveQualityFlagsLLM(transcript, surveyContext, deps.deriveQualityFlagsWithLLM)`: 调 LLM,产 semantic flags 子集。
  - `enforceMutex(flags)`: 按 design §5.3 互斥表剔除冲突。
  - `deriveQualityFlags(transcript, surveyContext, totalDurationMs, deps)`: 编排上述三步(silent/too-short 时 LLM 跳过)。
  加 `tests/quality-flags.test.ts` 覆盖 7 类典型样本。

- [ ] **T12** 新增 `apps/functions/analyzeSession/src/prompts/quality-flags.ts`: 系统 prompt + user 模板(见 design §5.2)+ zod 输出 schema `QualityFlagsLLMOutputSchema = z.object({ flags: z.array(SessionQualityFlagSchema) })`。

- [ ] **T13** 改 `analyzeSession/src/deps.ts` (C3 复审决策):
  - **改造现有** `analyzeWithLLM(input)`: 加可选第二参数 `opts?: { hallucinationHint?: { badRefs: SegmentRef[] } }`,签名变为 `analyzeWithLLM(input: AnalysisReportInput, opts?: { hallucinationHint?: { badRefs: { transcriptId: string; segmentIndex: number }[] } }): Promise<AnalysisReportOutput>`。adapter 内部实现: 有 hint 时,把 hint prompt 前置到 user message 顶部 (见 design §6.3);无 hint 时按原逻辑跑。
  - 新增 `deriveQualityFlagsWithLLM(input): Promise<{flags: SessionQualityFlag[]}>`。
  - 新增 `updateInterviewSessionFlags(sessionId, flags): Promise<void>`。
  - 新增 `updateSessionErrorContext(sessionId, ctx): Promise<void>`。
  `createRealDeps()` 实现上述新增/改造方法。

- [ ] **T14** 改 `analyzeSession/src/handler.ts`:
  1. 在 LLM 主分析后调 `checkHallucinationRatio`(R3): ratio 超阈值 + attempt=1 → 带 hallucination hint 重试一次。
  2. 通过后调 `deriveQualityFlags`(R1)。
  3. 落 `AnalysisReport` 时把 `generationMeta = { promptVersion: PROMPT_VERSION, attemptCount, hallucinationRatio, createdWith: [...] }` 写入。
  4. 调 `deps.updateInterviewSessionFlags` 双写 qualityFlags(best-effort,失败仅 log warn)。
  5. 重试两次仍超阈值 → 调 `deps.updateSessionErrorContext` 写入 `{ reason: "hallucination_threshold_exceeded", ratio, attemptCount, badRefs: badRefs.slice(0, 10), promptVersion }`,return `{ status: 409, body: { error: "analysis_rejected", reason: "hallucination_threshold_exceeded" } }`。

- [ ] **T15** 改 `analyzeSession/tests/handler.test.ts`: 加测试覆盖 R3 reject + retry + final-fail 全路径,以及 R1 qualityFlags 双写成功 / 双写失败但 AnalysisReport 仍落库的两条路径。

## Wave D — analyzeSurvey 二段式 rollup

- [ ] **T16** 新增 `apps/functions/analyzeSurvey/src/constants.ts`: 导出 `HALLUCINATION_RATIO_THRESHOLD = 0.15`、`ROLLUP_LLM_TEMPERATURE = 0.3`(与 analyzeSession constants 同形,但物理隔离便于独立调优)。

- [ ] **T17** 新增 `apps/functions/analyzeSurvey/src/prompts/version.ts`: `export const PROMPT_VERSION = "survey.v2.0"`。

- [ ] **T18** 新增 `apps/functions/analyzeSurvey/src/hallucination.ts`: 与 analyzeSession 同款 `checkHallucinationRatio`,但 `validRefs` 由 `sessionLevelReports` 的并集生成(见 design §6.4)。加 `tests/hallucination.test.ts`。

- [ ] **T19** 新增三个 prompt 文件:
  - `prompts/theme-extraction.ts`: 系统 prompt + user 模板 + zod 输出 schema `ExtractedThemesListSchema`(私有 import)。
  - `prompts/theme-assignment.ts`: 同上 + zod 输出 `ThemeAssignmentListSchema`(私有 import)。
  - `prompts/compose-insights.ts`: 同上 + zod 输出 `Pick<SurveyAnalysisReportOutput, "insights" | "citations" | "topics" | "sentimentBreakdown" | "perQuestionSummary">`(以 questionStats.summary 形式回写)。

- [ ] **T20** 新增 `apps/functions/analyzeSurvey/src/rollup.ts` (按 design §4.3 + §7.2 修订版):
  - **本地定义**: `ExtractedThemeSchema` / `ExtractedThemesListSchema` / `ThemeAssignmentSchema` / `ThemeAssignmentListSchema` 与对应类型(D14 决策,不上 contracts)。
  - 本地定义中间态类型 `ThemeContext` 与 `SurveyThemePreSentiment = Omit<SurveyTheme, "sentiment">` 与 `EnrichedRollupThemes = { themes: SurveyThemePreSentiment[]; themeContexts: ThemeContext[] }`(C1 修订)。
  - `extractThemesWithLLM(sessionReports, deps)` → `Promise<ExtractedThemes>`
  - `assignThemesWithLLM(themes, sessionReports, deps)` → `Promise<ThemeAssignments>`
  - `enrichSurveyThemes(themes, assignments, totalSessions): EnrichedRollupThemes` (纯函数,见 design §7.2 修订版,**双输出**: themes 不含 sentiment、themeContexts 不出 Function)。
  - `composeInsightsAndCitations(enrichedRollupThemes, sessionReports, questionStats, deps)` → `Pick<SurveyAnalysisReportOutput, "insights"|"citations"|"topics"|"sentimentBreakdown">` + `themeSentiments: Record<string, "positive"|"neutral"|"negative">` + `perQuestionSummary`(回写到 questionStats.summary)。
  - 编排器 (在 handler 里) 把 `themeSentiments` 回填到 `enrichedRollupThemes.themes[].sentiment`,得到最终 `SurveyTheme[]` 落库形态。
  加 `tests/rollup.test.ts` 覆盖 enrichSurveyThemes 各分支(空 themes / mentions=0 过滤 / share normalize / sentiment 字段在 themes 中确实缺省)。

- [ ] **T21** 改 `analyzeSurvey/src/deps.ts`: 把现有 `rollupWithLLM(input)` 拆为 `extractThemesWithLLM(input)`/`assignThemesWithLLM(input)`/`composeInsightsAndCitationsWithLLM(input)` 三个独立 effect;`createRealDeps()` 实现这三个方法,各自对应一次 DeepSeek 调用 + zod 校验。删除旧 `rollupWithLLM` 的调用边界(handler 不再调用)。

- [ ] **T22** 改 `analyzeSurvey/src/handler.ts`: 把现有"一次 rollupWithLLM"换成三步编排:
  1. `extractThemesWithLLM` (R3 重试机制)
  2. `assignThemesWithLLM` (R3 重试机制)
  3. `enrichSurveyThemes` (纯)
  4. `composeInsightsAndCitationsWithLLM` (R3 重试机制)
  5. `checkHallucinationRatio` 在 compose 输出上;ratio 超阈值 → compose 阶段重试一次;仍超 → 整次 reject。
  6. 落 AnalysisReport 时 `generationMeta.createdWith` 含 3 条 (extract / assign / compose)。

- [ ] **T23** 删除 `analyzeSurvey/src/prompts/survey-rollup.ts`(物理删除,git 里仍能查阅);从 `aggregate.ts` 与 `handler.ts` 中清理对它的引用。

- [ ] **T24** 改 `analyzeSurvey/tests/handler.test.ts`: 加测试覆盖三阶段编排正常路径、任一阶段失败 reject、二段式 enrich 输出与单段 mock 在 schema 字段集等价。

## Wave E — 验证与 PBT

- [ ] **T25** 新增 `tests/properties/analysis-report-v2/p-anl-05-stored-no-hallucination.test.ts`(见 design §9)。

- [ ] **T26** 新增 `tests/properties/analysis-report-v2/p-anl-06-quality-flags-mutex.test.ts`(见 design §9)。

- [ ] **T27** 新增 `tests/properties/analysis-report-v2/p-anl-07-rollup-mentions-pct.test.ts`(见 design §9)。

- [ ] **T28** 全量校验: `pnpm typecheck`、`pnpm -F web build`、`pnpm scope-guard`、`pnpm test`、`pnpm test:properties` 全绿。`pnpm schema:apply` 与 `pnpm schema:verify` 在本地 stack 上幂等通过。

## Wave F — chunk + combination 三段式（D15 撤销 D8）

- [ ] **T29** `analyzeSurvey/src/constants.ts` 加 `EXTRACTION_CHUNK_THRESHOLD = 10` / `EXTRACTION_CHUNK_SIZE = 10` / `ASSIGNMENT_CHUNK_SIZE = 10`。

- [ ] **T30** `analyzeSurvey/src/rollup.ts` 加两个纯函数:
  - `chunkSessionReports(reports, size): SessionLevelReport[][]` — 按 size 切块,最后一块可不满。
  - `mergeThemeAssignments(list: ThemeAssignments[]): ThemeAssignments` — 按 themeId 合并 sessionIds (dedupe) + evidenceRefs (dedupe by `transcriptId#segmentIndex`),保持顺序确定。

- [ ] **T31** 新增 `analyzeSurvey/src/prompts/theme-combination.ts`:
  - `THEME_COMBINATION_SYSTEM` 嵌 hogai `prompt_consolidation_instructions` 同款判定规则 (相同 feature area + 相似 root cause / 2+ indicators 重叠 → MERGE,否则 KEEP)。
  - `buildThemeCombinationUserPrompt(rawThemesList): string` 把 N 份 raw themes 序列化成"chunk #1 / chunk #2 / ..."拼接后注入 user。
  - 输出 schema 复用 `ExtractedThemesListSchema`(D15)。

- [ ] **T32** 改 `analyzeSurvey/src/deps.ts`: 加 `combineThemesWithLLM(input): Promise<ExtractedThemes>` adapter,system prompt = `THEME_COMBINATION_SYSTEM`,温度沿用现有 LLM 配置。

- [ ] **T33** 改 `analyzeSurvey/src/handler.ts`:
  - `AnalyzeSurveyDeps` 加 `combineThemesWithLLM`。
  - 主流程 if-else 分支:
    - `if (sessionReports.length > EXTRACTION_CHUNK_THRESHOLD)`: chunked 路径 (extract chunks parallel → combine);
    - else: 单次 extract (现状)。
  - assignment 阶段一律走 chunked + `mergeThemeAssignments` (代码合并不引入 LLM)。
  - `generationMeta.createdWith` 在 chunked 路径下含 `extract × N + combine × 1 + assign × M + compose × 1` 共 N+M+2 条。

- [ ] **T34** 测试覆盖:
  - 改 `analyzeSurvey/tests/handler.test.ts` 加: N=10 边界 (单 chunk, 不调 combine) / N=11 (拆 [10,1] + 调 combine) / N=15 等价 (chunk size=10, [10,5]) / combine 失败时 reject。
  - 改 `analyzeSurvey/tests/rollup.test.ts` 加 `chunkSessionReports` 与 `mergeThemeAssignments` 单元测试 (空数组 / N≤size / N>size / 任意 themeId 顺序 / 重复 sessionId 不重计)。
  - 新增 `tests/properties/analysis-report-v2/p-anl-08-chunked-rollup-equivalence.test.ts` (见 design §9 / §11)。

- [ ] **T35** Wave F 全量校验: `pnpm typecheck && pnpm test && pnpm test:properties && pnpm scope-guard` 全绿; commit 入 git。

## 依赖波次

```
A(T1→T2→T3→T4) ── B(T5→T6→T7) ──┬── C(T8→T9→T10→T11→T12→T13→T14→T15)
                                  │                                       ↓
                                  └── D(T16→T17→T18→T19→T20→T21→T22→T23→T24) ── E(T25→T26→T27→T28) ── F(T29→T30→T31→T32→T33→T34→T35)
```

C 与 D 之间不强依赖(两个 Function 独立),可并行实施;但 E 必须在 C 与 D 都完成后跑;F 必须在 E 完成后跑(依赖 v2 二段式骨架)。

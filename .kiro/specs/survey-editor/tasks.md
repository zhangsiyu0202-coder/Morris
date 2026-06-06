# Implementation Plan — survey-editor

每个任务保持 `pnpm typecheck` 绿、可独立提交与回退。涉及 Appwrite 读写的任务需本地 stack（`pnpm stack:up` + `pnpm schema:apply`）验证。

## Wave A — 契约收敛（contracts-first）

- [ ] **T1** 在 `packages/contracts/src/api.ts` 给 `SurveyDraftQuestionSchema` 加 `allowSkip: z.boolean().default(false)`；导出类型不变。跑 `pnpm -F @merism/contracts typecheck` 与契约测试。
- [ ] **T2** 修复 `allowSkip` 引入的全仓破坏点：`buildInterviewRuntimeStudy`/`buildInterviewWorkflowConfigFromDraft` 透传或忽略；必要时同步 `apps/agent/agent/contracts.py`（字段名 `allow_skip`）。`pnpm typecheck` 全绿。
- [ ] **T3** `apps/web/lib/guide.ts`：删除与契约重复的枚举/schema，类型改引用 `@merism/contracts`；保留 `localId`/`emptyQuestion`/`emptySection`/`countQuestions`/`normalizeGuide` 与 UI 文案映射。更新 `GuideEditor` 引用，`pnpm -F web typecheck` 绿。

## Wave B — 读路径

- [ ] **T4** 新增纯函数 `apps/web/lib/survey-draft.ts::assembleSurveyDraft(survey, sections, questions): SurveyDraft`（§4 映射，含 `flowConfig` meta、`config.options/allowSkip`、status 映射 D5）。加单测。
- [ ] **T5** 改 `app/studies/[id]/layout.tsx` 与 `guide/page.tsx`：`getCurrentUserId()` + `getStudy(ownerUserId, id)` + `assembleSurveyDraft`；null → 未授权/空态。`GuideEditor` props 改为 `{ surveyId, draft }`。

## Wave C — 写路径

- [ ] **T6** 新增 `apps/web/lib/actions/survey.ts`：`createSurvey`/`saveSurveyDraft`/`updateSurveyStatus`/`deleteSurvey`，边界用 `SurveyDraftSchema.parse`，每个 action 经 `getCurrentUserId` + ownership 闸门，写用 `withErrorBoundary`/`traceId`。
- [ ] **T7** 实现规范化全量替换写（§5 D2）：以 surveyId 为根删旧建新 sections/questions，`order`/`orderInSection` 由下标决定；建 survey 失败回滚 best-effort。
- [ ] **T8** 接 `GuideEditor` 的保存/新建/删除/改状态到 T6 actions；`studies-home` 新建/删除改用 `survey.ts`。

## Wave D — Appwrite schema / 权限

- [ ] **T9** `@merism/appwrite-schema`：确认/补 `survey_sections`/`question_blocks` 的 attributes（`config` 容纳 options/allowSkip）、索引（`surveyId`）、权限（写仅 owner 研究员，匿名无写）。`pnpm schema:apply` 幂等非破坏，`pnpm schema:verify` 通过。

## Wave E — 工作台只读视图接线

- [ ] **T10** `lib/workspace-data.ts`：`loadStudyOverview`/`loadStudyResults`/`loadStudyTranscript` 接 read layer（§8 映射），未配置/未登录/空 → 回退 mock。
- [ ] **T11**（可选）Morris `createStudyDraft` 工具接 `survey.ts::createSurvey`（analysis-report 的 TODO）。

## Wave F — 退役 Drizzle

- [ ] **T12** 删除 `apps/web/lib/db/*`、`apps/web/lib/actions/studies.ts`；`guide-ai.ts` 迁为产出 `SurveyDraft` 的 DeepSeek server action 或退役。
- [ ] **T13** 从 `apps/web/package.json` 移除 `drizzle-orm`/`pg`/`@types/pg`，刷新 `pnpm-lock.yaml`；`pnpm scope-guard` 绿。

## Wave G — 验证

- [ ] **T14** PBT：`tests/properties/survey-editor/draft-roundtrip.test.ts`（P-DATA-01）、`owner-scope.test.ts`（P-SEC-04）。
- [ ] **T15** 端到端：本地 stack 上 `pnpm schema:apply` + `pnpm smoke`（或等价读写校验）；`pnpm typecheck`/`pnpm -F web build`/`pnpm test`/`pnpm test:properties`/`pnpm scope-guard` 全绿。

## 依赖波次

```
A(T1→T2→T3) ─┬─ B(T4→T5) ─┬─ C(T6→T7→T8) ── D(T9) ── G
             └─ E(T10,T11) ┘                    F(T12→T13) ── G
```

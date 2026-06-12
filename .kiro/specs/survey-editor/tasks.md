# Implementation Plan — survey-editor

每个任务保持 `pnpm typecheck` 绿、可独立提交与回退。涉及 Appwrite 读写的任务需本地 stack（`pnpm stack:up` + `pnpm schema:apply`）验证。

> **状态对账（2026-06-11）**：本 Spec 的代码实现早已落地，但此前勾选框未同步。经逐任务核对（typecheck / test:properties / scope-guard / web build / schema:verify / live 往返校验全绿）已更新如下。
> - 已完成：T1、T2、T4、T5、T6、T7、T8、T9、T10、T12、T13、T14、T15。
> - **T3 设计偏离**：未按字面「删除 guide.ts 的枚举/schema」，而是把它们保留为**编辑态层**（带本地 id 的 `Guide`），并新增 `guideFromDraftSections`/`draftSectionsFromGuide` 在 `@merism/contracts` 的 `SurveyDraft` ↔ 编辑态 `Guide` 之间转换。意图（编辑器以契约为准）已满足；偏离已被接受并在此记录。
> - **唯一未完成**：T11（可选，Morris 仍是临时只读工具，按设计延后）。

## Wave A — 契约收敛（contracts-first）

- [x] **T1** 在 `packages/contracts/src/api.ts` 给 `SurveyDraftQuestionSchema` 加 `allowSkip: z.boolean().default(false)`；导出类型不变。跑 `pnpm -F @merism/contracts typecheck` 与契约测试。 — 已落地（`api.ts:199`）。
- [x] **T2** 修复 `allowSkip` 引入的全仓破坏点：`buildInterviewRuntimeStudy`/`buildInterviewWorkflowConfigFromDraft` 透传或忽略；必要时同步 `apps/agent/agent/contracts.py`（字段名 `allow_skip`）。`pnpm typecheck` 全绿。 — 已确认 `pnpm typecheck` 全绿。
- [~] **T3** `apps/web/lib/guide.ts`：~~删除与契约重复的枚举/schema~~，类型改引用 `@merism/contracts`；保留 `localId`/`emptyQuestion`/`emptySection`/`countQuestions`/`normalizeGuide` 与 UI 文案映射。更新 `GuideEditor` 引用，`pnpm -F web typecheck` 绿。 — **设计偏离（已接受）**：`guide.ts` 作为编辑态层保留 `guideSchema`/`guideQuestionSchema` 等，并以 `guideFromDraftSections`/`draftSectionsFromGuide` 桥接契约。`pnpm -F web typecheck` 绿。

## Wave B — 读路径

- [x] **T4** 新增纯函数 `apps/web/lib/survey-draft.ts::assembleSurveyDraft(survey, sections, questions): SurveyDraft`（§4 映射，含 `flowConfig` meta、`config.options/allowSkip`、status 映射 D5）。加单测。 — 已落地；P-DATA-01 往返测试通过。
- [x] **T5** 改 `app/studies/[id]/guide/page.tsx`：经 `lib/survey-read.ts::loadSurveyDraft`（内部 `getCurrentUserId` + read layer + `assembleSurveyDraft`）；null → `notFound()`。`GuideEditor` props 已为 `{ surveyId, draft }`。 — 已落地（实现以 `loadSurveyDraft` 封装替代 spec 中的内联写法，等价）。

## Wave C — 写路径

- [x] **T6** 新增 `apps/web/lib/actions/survey.ts`：`createSurvey`/`saveSurveyDraft`/`updateSurveyStatus`/`deleteSurvey`，边界用 `SurveyDraftSchema.parse`，每个 action 经 `getCurrentUserId` + ownership 闸门，写用 `withErrorBoundary`/`traceId`。 — 已落地（四个 action 均在）。
- [x] **T7** 实现规范化全量替换写（§5 D2）：以 surveyId 为根删旧建新 sections/questions，`order`/`orderInSection` 由下标决定；建 survey 失败回滚 best-effort。 — 已落地；P-DATA-01 往返无损测试通过。
- [x] **T8** 接 `GuideEditor` 的保存/新建/删除/改状态到 T6 actions；`studies-home` 新建/删除改用 `survey.ts`。 — 已落地（`guide-editor`→`saveSurveyDraft`、`studies-home`→`createSurvey`/`deleteSurvey`、`study-status-actions`→`updateSurveyStatus`）。

## Wave D — Appwrite schema / 权限

- [x] **T9** `@merism/appwrite-schema`：确认/补 `survey_sections`/`question_blocks` 的 attributes（`config` 容纳 options/allowSkip）、索引（`surveyId`）、权限（写仅 owner 研究员，匿名无写）。`pnpm schema:apply` 幂等非破坏，`pnpm schema:verify` 通过。 — 已落地；`pnpm schema:verify` 对 live stack 通过（2026-06-11）。

## Wave E — 工作台只读视图接线

- [x] **T10** `lib/workspace-data.ts`：`loadStudyOverview`/`loadStudyResults`/`loadStudyTranscript` 接 read layer（§8 映射），未配置/未登录/空 → 回退 mock。 — 已落地。
- [ ] **T11**（可选）Morris `createStudyDraft` 工具接 `survey.ts::createSurvey`（analysis-report 的 TODO）。 — **未做**：当前 `tools/create-study-draft.ts` 仍是「临时、只在对话展示、不写 Appwrite」。保持延后。

## Wave F — 退役 Drizzle

- [x] **T12** 删除 `apps/web/lib/db/*`、`apps/web/lib/actions/studies.ts`；`guide-ai.ts` 迁为产出 `SurveyDraft` 的 DeepSeek server action 或退役。 — 已落地（`lib/db`/`studies.ts` 不存在；`guide-ai.ts` 已是直连 DeepSeek、产出编辑态 Guide、无 Drizzle 引用）。
- [x] **T13** 从 `apps/web/package.json` 移除 `drizzle-orm`/`pg`/`@types/pg`，刷新 `pnpm-lock.yaml`；`pnpm scope-guard` 绿。 — 已落地（`package.json` 无；lockfile 0 处 `drizzle-orm`；scope-guard OK）。

## Wave G — 验证

- [x] **T14** PBT：`tests/properties/survey-editor/draft-roundtrip.test.ts`（P-DATA-01）、`owner-scope.test.ts`（P-SEC-04）。 — 两者均已落地并通过（roundtrip 1 + owner-scope 3）。
- [x] **T15** 端到端：本地 stack 上 `pnpm schema:verify` 通过 + `scripts/verify-survey-editor.ts`（写→读→组装→清理，对真实 Appwrite）OK；`pnpm typecheck`/`pnpm -F web build`/`pnpm test:properties`/`pnpm scope-guard` 全绿（2026-06-11）。

## Wave H — AI moderator instruction 增量(后续追加,2026-06-11)

> 借鉴 PostHog `user_interviews.agent_context` + LiveKit "persona 写成可听见行为" + Vapi 范式(GitHub 调研结论:问题与主持指令是分开字段、运行时合成)。产品决策:语调/语速/风格作为 **prompt 行为描述**(不碰 TTS 参数层);访谈目标复用 `flowConfig.researchGoal` 不重复;**独立字段**(非 flowConfig)。

- [x] **T16** 契约:`Survey.moderatorInstruction`(`entities.ts`,default "")+ `SurveyDraft.moderatorInstruction`(`api.ts`,default "");`buildInterviewWorkflowConfigFromDraft` 把它合成进既有 `InterviewWorkflowConfig.supervisorInstruction`(persona 前置 + 操作性默认,显式 arg 仍优先)。契约测试覆盖合成 + 默认空。**重新 build dist**。 — 已落地(commit `3900742`)。
- [x] **T17** schema:`surveys` 加 `moderatorInstruction`(`TEXT_SIZE`,独立列,非 flowConfig);`schema:apply` 已落 live stack,`schema:verify` 无该列 diff。 — 已落地。
- [x] **T18** web 读写 + 撰写 UI:`survey/read.ts` 读 doc 字段、`survey/draft.ts::assembleSurveyDraft` 映射、`actions/survey.ts` create/save 写独立列、`guide-editor.tsx` `IntroOptions` 加"主持风格指令" textarea。`draft.test` fixture + 断言。 — 已落地。
- [x] **T19** agent 消费:无需改 agent——`InterviewSupervisorAgent(instructions=workflowConfig.supervisorInstruction)` 自动消费合成串(ai-interview-engine spec §B2 已治理)。 — 确认。

## 依赖波次

```
A(T1→T2→T3) ─┬─ B(T4→T5) ─┬─ C(T6→T7→T8) ── D(T9) ── G
             └─ E(T10,T11) ┘                    F(T12→T13) ── G
H(T16→T17→T18→T19) 独立后续,依赖 A 的契约基线
```

> 图例：`[x]` 完成 · `[~]` 部分/偏离（见任务行说明）· `[ ]` 未完成。

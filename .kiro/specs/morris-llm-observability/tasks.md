# morris-llm-observability — Tasks

## Wave A — Schema + 包装器基础设施 (`packages/observability`)

- [ ] **T1** `packages/observability/src/llm-call.ts` — `LLMCallEventSchema` zod + `LLMCallStatus` / `LLMCallProvider` enum + `LLMCallSink` 类型 + `installLLMCallSink` / `sinkOrDefault` (default 走 logger). 不可变单例 frozen.
- [ ] **T2** `packages/observability/src/concurrency.ts` — `createLLMConcurrencyGate(max)` + `llmGate` export, 用 p-limit. env `MERISM_LLM_MAX_CONCURRENT` 默认 8.
- [ ] **T3** `packages/observability/src/debug-snippets.ts` — `extractDebugSnippets({prompt, completion})` env-gated, R7 三态.
- [ ] **T4** `packages/observability/src/with-llm-call.ts` — `withLLMCall<T>(opts, fn)` + `classifyError`. 抽 usage 取自 `result.usage`. 错误 re-throw 但 sink 仍写.
- [ ] **T5** `packages/observability/src/llm-middleware.ts` — `llmObservabilityMiddleware(opts)` Vercel AI SDK 6 LanguageModelV2Middleware: wrapGenerate (调 withLLMCall) + wrapStream (transform stream 收集 finish chunk usage).
- [ ] **T6** `packages/observability/src/index.ts` — re-export 上述全部 + p-limit 依赖.
- [ ] **T7** 加 p-limit 依赖到 `packages/observability/package.json`.
- [ ] **T8** Wave A 单元测试: `llm-call.test.ts` + `with-llm-call.test.ts` + `llm-middleware.test.ts` + `concurrency.test.ts` + `debug-snippets.test.ts`. 共 28 用例 (Layer 1).
- [ ] **T9** Wave A typecheck + test 全绿.

## Wave B — 接入 5 个 LLM call site

- [ ] **T10** `apps/web/lib/assistant/model.ts` — 用 `wrapLanguageModel` 包 CHAT_MODEL + REASONING_MODEL, scope 用 `morris.toolloop` / `morris.toolloop.reasoner`. randomUUID per call.
- [ ] **T11** `apps/web/lib/assistant/compaction.ts` — `summarizeMessages` 内层显式 `withLLMCall`, scope=`morris.compaction.summarize`. (注意: model 已 middleware 包装, 会产生双 event — 见 design §7.2.)
- [ ] **T12** `apps/web/lib/actions/notebooks.ts` — `withLLMCall` 包 generateText, scope=`action.notebooks.generateReport`.
- [ ] **T13** `apps/functions/analyzeSession/src/deps.ts` — `withLLMCall` 包两个 generateText, scope=`function.analyzeSession.text-pass` + `function.analyzeSession.visual-consolidate`. 加 attempt 参数 wire (per `withRetry`).
- [ ] **T14** `apps/functions/analyzeSurvey/src/deps.ts` — `withLLMCall` 包两个 generateText, scope=`function.analyzeSurvey.rollup` + `function.analyzeSurvey.aggregate`. 加 attempt 参数 wire.
- [ ] **T15** Wave B typecheck (apps/web + 2 functions) 全绿.

## Wave C — 集成测试 (Layer 3)

- [ ] **T16** `packages/observability/test/fixtures/install-mocks.ts` — fakeLogger / fakeSink (in-memory event array) + helper `setMockEnv(...)`.
- [ ] **T17** `apps/web/lib/assistant/__tests__/model-middleware.test.ts` — 用 Vercel AI SDK `mockLanguageModelV1` 跑 wrapLanguageModel 链路, 断言 sink 收到正确 event (scope=`morris.toolloop`, status=success/error 两个分支).
- [ ] **T18** `apps/web/lib/assistant/__tests__/compaction-llm-call.test.ts` — summarizeMessages 跑后 sink 收到 scope=`morris.compaction.summarize` event.
- [ ] **T19** `apps/web/lib/actions/__tests__/notebooks-llm-call.test.ts` — generateNotebookReport 跑后 sink 收到 scope=`action.notebooks.generateReport` event.
- [ ] **T20** `apps/functions/analyzeSession/tests/llm-instrumentation.test.ts` — fake deps + sink 验证 scope=`function.analyzeSession.text-pass`.
- [ ] **T21** `apps/functions/analyzeSurvey/tests/llm-instrumentation.test.ts` — 同上, scope=`function.analyzeSurvey.rollup`.
- [ ] **T22** Wave C 全测试绿.

## Wave D — Property-based tests

- [ ] **T23** `tests/properties/morris-llm-observability/event-roundtrip.test.ts` — fast-check 任意合法 LLMCallEvent zod parse / JSON.stringify ↔ parse 闭环 (P-LLMOBS-01).
- [ ] **T24** `tests/properties/morris-llm-observability/attempt-monotonic.test.ts` — withLLMCall 配 withRetry 时 attempt 序列 0/1/2 严格递增 (P-LLMOBS-02).
- [ ] **T25** `tests/properties/morris-llm-observability/secret-masking.test.ts` — env unset 时 default sink 收到的 event 序列化后**不含** prompt/completion 字符 (P-LLMOBS-03 / R4 / K-LLMOBS-06).
- [ ] **T26** Wave D PBT 全绿 (3 PBT × 100 runs).

## Wave E — 文档同步 (R9)

- [ ] **T27** `.kiro/steering/errors-and-observability.md::Provider adapter rules` 加 binding 条 — LLM 调用必须走 withLLMCall 或 middleware.
- [ ] **T28** `apps/web/AGENTS.md::Morris page assistant` 加 LLM observability 接入规则节 — 5 site + scope 命名规范 + double event 解释.
- [ ] **T29** 根 `AGENTS.md::Repository Map` / Sub-spec roadmap 节加 morris-llm-observability.
- [ ] **T30** `.kiro/steering/architecture.md::Where new things go` 表加 "LLM 调用观测" 行.

## Wave F — 全量回归 + 验收

- [ ] **T31** `pnpm typecheck` (root, recursive) — 4 包绿 (排除 ADR-0005 进行中的 analyzeSessionVisual).
- [ ] **T32** `pnpm test` — 含本 spec 28 单元 + 5 集成 = 33 新增, 全绿.
- [ ] **T33** `pnpm test:properties` — 含本 spec 3 PBT, 全绿.
- [ ] **T34** `pnpm scope-guard` — OK.
- [ ] **T35** `pnpm -F web build` — ✓.
- [ ] **T36** `grep -rn 'await generateText\b' apps packages | grep -v 'withLLMCall\|llmObservabilityMiddleware\|test'` — 无 hit (R9 强制 / 错过的 site 抓出来).

## 验收 checklist (10 项)

- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm test` 33 新增用例全绿
- [ ] `pnpm test:properties` 3 PBT 全绿
- [ ] `pnpm scope-guard` OK
- [ ] `pnpm -F web build` ✓
- [ ] 5 site 全部接入 (T10-T14)
- [ ] `MERISM_DEBUG_PROVIDERS` 三态测试通过 (T8 / K-LLMOBS-09)
- [ ] secret masking 边界测试通过 (T25 / K-LLMOBS-06)
- [ ] `errors-and-observability.md` + `apps/web/AGENTS.md` + 根 `AGENTS.md` + `architecture.md` 已更新 (T27-T30)
- [ ] design.md §12 拒绝列表 6+ 备选都有"为什么不"

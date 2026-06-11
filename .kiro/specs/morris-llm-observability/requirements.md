# morris-llm-observability — Requirements

## 背景

借鉴 PostHog `products/ai_observability/backend/llm/` 的"集中 Client + AnalyticsContext + Provider 抽 Usage"模式, 把 MerismV2 内部所有 LLM 调用 (Morris ToolLoopAgent / Notebook AI 报告 / analyzeSession / analyzeSurvey / compaction) 接入统一观测层。**仅基础设施观测**, 不做客户产品形态的 ai_observability。

scope 边界 (引用 `.kiro/steering/`):
- ✅ 基础设施层 LLM 调用观测 (`errors-and-observability.md::Provider adapter rules` 的扩展)
- ❌ Multi-LLM provider router (锁定 DeepSeek, ADR-0002)
- ❌ 给客户的 ai_observability 产品 (`scope.md` 单研究员, 不是 SaaS 平台)
- ❌ 研究员行为 analytics (`scope.md`: 我们分析访谈内容, 不是研究员点击)
- ❌ 接外部 SaaS (LangSmith / Sentry / Datadog) — `errors-and-observability.md::Secret masking` + 数据出境

LLM 调用 site 全集 (TS 侧, 调研结果):
1. `apps/web/lib/assistant/model.ts` — Morris 主 model 实例 (ToolLoopAgent + compaction 共享)
2. `apps/web/lib/assistant/compaction.ts` — 对话压缩 summarizer
3. `apps/web/lib/actions/notebooks.ts` — Notebook AI 报告 (server action)
4. `apps/web/lib/actions/guide-ai.ts` — Drizzle legacy (等 survey-editor sub-spec, 本 spec 接但不优化)
5. `apps/functions/analyzeSession/src/deps.ts` — 2 个 generateText
6. `apps/functions/analyzeSurvey/src/deps.ts` — 2 个 generateText

Python 侧 (`apps/agent/agent/providers/{deepseek,qwen}.py`) **不在本 spec 范围** — 走自己的 `agent.logging`, 后续若需对齐再开 `morris-llm-observability-py`。

## R1 — LLMCallEvent 契约 (single source of truth)

`packages/observability` 加 `LLMCallEventSchema` (zod), 单一定义所有调用观测点共用的字段。

```
LLMCallEvent = {
  scope: string                  // "morris.tool.analyzeData" / "analyzeSession.text-pass" / ...
  model: string                  // "deepseek-chat" / "deepseek-reasoner"
  provider: "deepseek"           // 当前唯一; 字段保留以备未来 ADR 改 provider
  status: "success" | "error" | "rate_limit" | "timeout"
  latencyMs: number
  inputTokens: number            // 取自 Vercel AI SDK 6 result.usage.inputTokens
  outputTokens: number
  cacheReadTokens?: number       // DeepSeek 支持 cache, 字段保留
  totalTokens: number            // = inputTokens + outputTokens
  traceId: string                // 与 createLogger 的 traceId 一致
  errorClass?: string            // "TransientProviderError" / "PermanentProviderError" / 原 class.name
  errorCode?: string             // PostHog 风格 stable code (`rate_limited` / `auth` / `internal`)
  attempt: number                // 0-based; 配合 withRetry 用
}
```

K-LLMOBS-01..05 测试强制每条字段在 schema parse 后保留, 字段类型不漂移。

`scope` 命名规范 (binding):
- Morris 工具调用: `morris.tool.<toolName>` (e.g. `morris.tool.analyzeData`)
- Morris 对话压缩: `morris.compaction.summarize`
- Function 内 LLM 调用: `function.<functionName>.<phase>` (e.g. `function.analyzeSession.text-pass`)
- Server Action LLM 调用: `action.<actionName>` (e.g. `action.notebooks.generateReport`)

## R2 — withLLMCall 包装器 + Vercel AI SDK middleware

`packages/observability` 暴露**两层**接入面:

### R2.1 显式包装 `withLLMCall<T>(scope, fn) → Promise<T>`

```ts
const result = await withLLMCall("action.notebooks.generateReport", async () => {
  return await generateText({ model, prompt, ... });
});
```

约束:
- `fn` 必须返回 Vercel AI SDK 的 result (含 `usage` / 错误)
- wrapper 自动抽 usage / 算 latency / 分类错误 / 调 logger
- 失败时仍 re-throw (不吞错), 但事件记完
- 不修改 prompt / completion (`secret masking`: prompt 可能含 PII, 不写 default log)

### R2.2 Vercel AI SDK middleware `llmObservabilityMiddleware`

通过 `wrapLanguageModel({ model, middleware: llmObservabilityMiddleware })` 包 model 实例, 让 ToolLoopAgent 内部 LLM 调用 (调用点不可见) 也被观测。

```ts
// apps/web/lib/assistant/model.ts
export const CHAT_MODEL = wrapLanguageModel({
  model: deepseek("deepseek-chat"),
  middleware: llmObservabilityMiddleware({ scope: "morris.toolloop" }),
});
```

middleware 拦截 `wrapGenerate` + `wrapStream`, 同样产生 LLMCallEvent。

## R3 — 强制 logger 出口, 不接外部 SaaS

LLMCallEvent 的默认 sink = `createLogger(scope).info("llm.call", event)`。

不允许的 sink:
- LangSmith / OpenAI 内部 telemetry / Sentry / Datadog / 任何 HTTP POST 外网
- 写本仓 `function_errors` / `audit_events` collection (可选 — 等 sub-spec 单独决定)

允许的 sink (运行时可注入, 测试用):
- 内存 array (测试)
- 自定义 callback (例如未来接 Appwrite collection)

`packages/observability/src/llm-call.ts` 暴露 `installLLMCallSink(sink)` 让运行时注入, default 走 logger。

## R4 — Secret/PII masking 强制边界

`errors-and-observability.md::Secret masking` 已经规定 logger 不能含 secret。本 spec 加强:

- LLMCallEvent 默认 **不** 含 prompt / completion 文本
- `MERISM_DEBUG_PROVIDERS=1` 时 sink 收到 `debugSnippets: { promptHead?: string, completionHead?: string }`, 各截首 200 字符
- `MERISM_DEBUG_PROVIDERS` 默认 unset = 关闭, production 永远不开
- 这条规则 K-LLMOBS-06 测试强制: default 调用产生的 event JSON 序列化后**不**含 prompt / completion 字段

## R5 — 接入面完整性 (5 个 site)

Wave B 必须接入 (binding, K-LLMOBS-07 强制):

| Site | 接入方式 | scope |
|---|---|---|
| `apps/web/lib/assistant/model.ts` | middleware | `morris.toolloop` (覆盖 ToolLoopAgent 内部 + compaction 间接复用) |
| `apps/web/lib/assistant/compaction.ts` | `withLLMCall` 显式 (不复用 model 中间件 — 因为压缩有自己的 scope) | `morris.compaction.summarize` |
| `apps/web/lib/actions/notebooks.ts` | `withLLMCall` 显式 | `action.notebooks.generateReport` |
| `apps/functions/analyzeSession/src/deps.ts` | `withLLMCall` 显式 (per phase) | `function.analyzeSession.text-pass` / `function.analyzeSession.visual-consolidate` |
| `apps/functions/analyzeSurvey/src/deps.ts` | `withLLMCall` 显式 (per phase) | `function.analyzeSurvey.rollup` / `function.analyzeSurvey.aggregate` |

接入但不优化的:
- `apps/web/lib/actions/guide-ai.ts` (Drizzle legacy, 等 survey-editor sub-spec)

不接入 (ADR-0005 进行中):
- `apps/functions/analyzeSessionVisual/*` — 等另一个 AI 完成 ADR-0005 实施后由对应 PR 接入

## R6 — 并发上限 (provider rate limit 防护)

DeepSeek API 有 RPM 限制。当多个 ToolLoopAgent 步并发 + analyzeSession 后台任务同时跑时, 可能撞 429。

R6.1: `packages/observability` 暴露 `createLLMConcurrencyGate(maxConcurrent: number)`
- 用 `p-limit` (npm package, 1k+ stars, deterministic queue)
- 默认 `MERISM_LLM_MAX_CONCURRENT=8`, env 可调
- middleware 内置自动用; 显式 `withLLMCall` 也走同一个 gate (单 process 共享一个 limit instance)

R6.2: 撞 429 时:
- adapter 抛 `TransientProviderError` (`errors-and-observability.md::Provider adapter rules`)
- `withRetry` 自动重试 (status=`rate_limit` event 记录 attempt+1)
- K-LLMOBS-08: 模拟 429 重试场景, attempt=0/1/2 各产生独立 event

## R7 — `MERISM_DEBUG_PROVIDERS=1` 真生效

`errors-and-observability.md::Provider adapter rules` 已规定 "Adapters MUST NOT log raw prompts / generated text at info. Debug-level logging is allowed only when explicitly gated by `MERISM_DEBUG_PROVIDERS=1`"。

本 spec 真正实现:
- LLMCallEvent.debugSnippets 字段仅 `MERISM_DEBUG_PROVIDERS=1` 才填
- logger 内置 level filter: 默认仅 info+, debug snippet 走 debug level
- K-LLMOBS-09: env unset / "0" / "true" / "1" 各场景 event shape 验证

## R8 — 测试覆盖 (4 layer)

按 `testing.md` 四层模型:
- **Unit**: schema 自洽 + withLLMCall + middleware 单元测试 (≥15 用例)
- **Property-based**: 任意合法 LLMCallEvent round-trip, 任意 attempt count + status 组合
- **Integration with fakes**: middleware 接 mockLanguageModelV1 (Vercel AI SDK 提供) 跑端到端
- **Live integration** (gated by `MERISM_LIVE_TESTS=1`): 真 DeepSeek call → middleware → 验证 usage tokens 非 0 (可选, 不卡 default CI)

测试 fixture 集中在 `packages/observability/test/fixtures/install-mocks.ts` 跟 `testing.md::Test double pattern §1` 一致。

## R9 — 文档同步 (binding)

- `.kiro/steering/errors-and-observability.md::Provider adapter rules` 段加一条: "LLM 调用 MUST 走 packages/observability::withLLMCall 或 wrapLanguageModel + llmObservabilityMiddleware"
- `apps/web/AGENTS.md::Morris page assistant` 段加 LLM observability 接入规则
- 根 `AGENTS.md::Repository Map` 提及本 spec

## 验收 (10 项 checklist)

- [ ] `pnpm typecheck` 全包绿
- [ ] `pnpm test` 新增 ≥15 用例全绿
- [ ] `pnpm test:properties` 新增 ≥3 PBT 全绿
- [ ] `pnpm scope-guard` OK
- [ ] `pnpm -F web build` ✓
- [ ] 5 个 site 全部接入 (R5)
- [ ] `MERISM_DEBUG_PROVIDERS` 三态测试通过 (R7 / K-LLMOBS-09)
- [ ] secret masking 边界测试通过 (R4 / K-LLMOBS-06)
- [ ] AGENTS.md / errors-and-observability.md 已更新 (R9)
- [ ] 拒绝列表里的 6+ 备选都在 design.md 里有"为什么不"

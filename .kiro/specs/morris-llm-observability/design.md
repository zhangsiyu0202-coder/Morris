# morris-llm-observability — Design

## 1. Overview

```
                         ┌─────────────────────────────────┐
                         │ packages/observability          │
                         │  ┌───────────────────────────┐  │
                         │  │ LLMCallEventSchema (zod)  │  │
                         │  │ withLLMCall<T>(scope, fn) │  │
                         │  │ llmObservabilityMiddleware│  │
                         │  │ createLLMConcurrencyGate  │  │
                         │  │ installLLMCallSink(sink)  │  │
                         │  │ default sink → logger     │  │
                         │  └─────────────┬─────────────┘  │
                         └────────────────┼────────────────┘
                                          │ (同进程内, 共享 gate)
       ┌──────────────────────────────────┼──────────────────────────────────┐
       │                                  │                                  │
┌──────▼──────────┐         ┌─────────────▼──────────┐         ┌─────────────▼──────────┐
│ Morris ToolLoop │         │ Server Actions / Funct │         │ Compaction summarizer  │
│ (apps/web)      │         │ generateText 显式调用  │         │                        │
│                 │         │                        │         │                        │
│ model.ts:       │         │ withLLMCall("action.   │         │ withLLMCall("morris.   │
│   wrapLang...() │         │  notebooks.gen", ...) │         │  compaction.sum", ...) │
│  + middleware   │         │                        │         │                        │
└──────┬──────────┘         └────────────┬───────────┘         └────────────┬───────────┘
       │                                 │                                  │
       └─────────────────────────────────┼──────────────────────────────────┘
                                         │
                            event ↓ (LLMCallEvent)
                                         │
                            ┌────────────▼────────────┐
                            │ default: logger.info     │
                            │  ("llm.call", event)     │
                            │ traceId 与 createLogger  │
                            │  共享                    │
                            └──────────────────────────┘
```

**核心思想** (借鉴 PostHog `Client + AnalyticsContext + Provider.complete()`):
1. **集中 schema** — `LLMCallEventSchema` 是所有调用观测点共用的契约 (PostHog `Usage` + `AnalyticsContext` 合并)
2. **集中接入** — `packages/observability` 的 `withLLMCall` 是 PostHog `Client.complete()` 的 TS 化对应
3. **Provider 抽象** — Vercel AI SDK 6 已经把 provider 接口标准化为 `LanguageModel`, 我们在它**之上**加一层 middleware 拦截 (PostHog 在 OpenAI/Anthropic 各自 adapter 里手工抽 `Usage` — 我们用 SDK middleware 一处拦截多 provider)
4. **不入网** — sink 默认走 logger, 永远不接 SaaS

## 2. PostHog `ai_observability/backend/llm/` 字段对照表

PostHog 源:
- `client.py::Client.__init__` — 9 个参数 (provider_key/config/distinct_id/trace_id/properties/groups/capture_analytics/...)
- `types.py::CompletionRequest` — 12 个字段
- `types.py::CompletionResponse` — 4 个字段
- `types.py::Usage` — 5 个字段
- `types.py::AnalyticsContext` — 5 个字段

合计约 35 字段。我们对照如下:

| PostHog 字段 | MerismV2 决定 | 原因 |
|---|---|---|
| `Client.provider_key` (custom keys per team) | ❌ 拒绝 | scope 单研究员, 无 multi-tenant |
| `Client.config.api_key` / `base_url` | 已在 `model.ts::createDeepSeek({apiKey, baseURL})` | 已有 |
| `Client.distinct_id` | ❌ 拒绝 (PostHog 用于研究员行为分析) | scope 排除研究员 analytics |
| `Client.trace_id` | ✅ 采纳 → `LLMCallEvent.traceId` | 必需 (跨模块 trace 传递) |
| `Client.properties` (free-form) | ❌ 拒绝 | YAGNI; scope 字段足够 |
| `Client.groups` (PostHog Groups 概念) | ❌ 拒绝 | scope 排除 teams/orgs |
| `Client.capture_analytics` (toggle) | ✅ 采纳 → `installLLMCallSink(noopSink)` 关闭 | 测试用 |
| `CompletionRequest.model` | ✅ 采纳 → `LLMCallEvent.model` | 必需 |
| `CompletionRequest.provider` | ✅ 采纳 → `LLMCallEvent.provider` (锁 deepseek) | 字段保留, 值唯一 |
| `CompletionRequest.messages` | ❌ 拒绝写入 event | secret masking, R4 |
| `CompletionRequest.system` | ❌ 拒绝 | secret masking |
| `CompletionRequest.tools` | ❌ 拒绝 | secret masking + ToolLoopAgent 自管 |
| `CompletionRequest.temperature/top_p/seed` | ❌ 拒绝 | 调用点参数, 不入观测层 |
| `CompletionRequest.max_tokens` | ❌ 拒绝 | 同上 |
| `CompletionRequest.response_format` | ❌ 拒绝 | 同上 |
| `CompletionRequest.thinking/reasoning_level` | ❌ 拒绝 | DeepSeek 不暴露 |
| `CompletionResponse.content` | ❌ 拒绝 (default) / ✅ debugSnippets.completionHead 200 字符 (env-gated) | secret masking + R4 |
| `CompletionResponse.model` | ✅ 采纳 (实际返回 model, 与 request.model 可能差异) | 验证用 |
| `CompletionResponse.usage.input_tokens` | ✅ 采纳 → `LLMCallEvent.inputTokens` | 必需 (cost / billing tracking) |
| `CompletionResponse.usage.output_tokens` | ✅ 采纳 → `LLMCallEvent.outputTokens` | 必需 |
| `CompletionResponse.usage.total_tokens` | ✅ 采纳 → `LLMCallEvent.totalTokens` | 必需 |
| `CompletionResponse.usage.cache_read_tokens` | ✅ 采纳 → `LLMCallEvent.cacheReadTokens?` | DeepSeek 支持 prompt cache |
| `CompletionResponse.usage.cache_write_tokens` | ❌ 拒绝 | DeepSeek API 不返 |
| `CompletionResponse.parsed` (structured) | ❌ 拒绝 | 调用点处理 |
| `StreamChunk.type` | 内部 — 不入 event | 统计在 wrapStream 完成后 |
| `AnalyticsContext.distinct_id` | ❌ 拒绝 | 见上 |
| `AnalyticsContext.trace_id` | ✅ 同 Client.trace_id | 重复条目 |
| `AnalyticsContext.properties` | ❌ 拒绝 | 见上 |
| `AnalyticsContext.groups` | ❌ 拒绝 | 见上 |
| `AnalyticsContext.capture` | ✅ 同 capture_analytics | 重复条目 |

新增 (PostHog 没显式建模, 我们补):
| MerismV2 字段 | 来源 |
|---|---|
| `scope` | Wave A 设计 — Morris/Function/Action 都需要"是谁在调"的 stable 字符串 |
| `status` (success / error / rate_limit / timeout) | `errors-and-observability.md::Error codes` 风格扩展到 LLM 层 |
| `latencyMs` | 包装器算 `Date.now() - start`, PostHog 没显式建模但内部追了 |
| `errorClass` / `errorCode` | `errors-and-observability.md::Provider adapter rules` 强制 |
| `attempt` | 配合 `withRetry` 用, attempt 0 / 1 / 2 各产生独立 event |
| `debugSnippets.{promptHead, completionHead}` | env-gated (R4 + R7) |

## 3. 模块边界

| 文件 | 职责 |
|---|---|
| `packages/observability/src/llm-call.ts` | LLMCallEventSchema + LLMCallSink 接口 + installLLMCallSink + default loggerSink |
| `packages/observability/src/with-llm-call.ts` | `withLLMCall<T>(scope, fn)` — 显式包装器 + concurrency gate |
| `packages/observability/src/llm-middleware.ts` | `llmObservabilityMiddleware(opts)` — Vercel AI SDK 6 LanguageModelMiddleware |
| `packages/observability/src/concurrency.ts` | `createLLMConcurrencyGate(max)` — p-limit 包装 |
| `packages/observability/src/debug-snippets.ts` | `extractDebugSnippets(prompt, completion)` — env-gated 截首 200 字符 |
| `packages/observability/src/index.ts` | re-export 上述 + 已有 logger/retry/withErrorBoundary |
| `apps/web/lib/assistant/model.ts` | 用 `wrapLanguageModel` 接入 middleware |
| `apps/web/lib/assistant/compaction.ts` | 用 `withLLMCall` 包 generateText |
| `apps/web/lib/actions/notebooks.ts` | 用 `withLLMCall` 包 generateText |
| `apps/functions/analyzeSession/src/deps.ts` | 用 `withLLMCall` 包 2 个 generateText |
| `apps/functions/analyzeSurvey/src/deps.ts` | 用 `withLLMCall` 包 2 个 generateText |

## 4. LLMCallEventSchema (zod)

```ts
// packages/observability/src/llm-call.ts
import { z } from "zod";

export const LLMCallStatus = z.enum([
  "success",
  "error",         // 通用错误 (not transient, not rate_limit)
  "rate_limit",    // 429 / Provider rate limit
  "timeout",       // 调用超时 / 网络
]);
export type LLMCallStatusValue = z.infer<typeof LLMCallStatus>;

export const LLMCallProvider = z.enum(["deepseek"]); // ADR-0002 唯一; 改要新 ADR
export type LLMCallProviderValue = z.infer<typeof LLMCallProvider>;

const DebugSnippetsSchema = z.object({
  promptHead: z.string().max(200).optional(),
  completionHead: z.string().max(200).optional(),
}).strict();

export const LLMCallEventSchema = z.object({
  scope: z.string().min(1),
  model: z.string().min(1),
  provider: LLMCallProvider,
  status: LLMCallStatus,
  latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  traceId: z.string().min(1),
  errorClass: z.string().optional(),
  errorCode: z.string().optional(),
  attempt: z.number().int().nonnegative(),
  debugSnippets: DebugSnippetsSchema.optional(),
}).strict();
export type LLMCallEvent = z.infer<typeof LLMCallEventSchema>;

export type LLMCallSink = (event: LLMCallEvent) => void;
```

K-LLMOBS-01..05 强制:
- 01: schema parse 任意合法 event idempotent
- 02: status 是 4 个固定值之一, 否则 reject
- 03: totalTokens === inputTokens + outputTokens (superRefine; 不严格强制因为 provider 可能返还非 sum 值, 但记录 mismatch warning)
- 04: provider === "deepseek" (其他 provider reject 直到新 ADR)
- 05: scope 命名格式正则 `^(morris|function|action)\.[a-zA-Z][\w-]*(\.[a-zA-Z][\w-]*)*$`

## 5. withLLMCall 实现

```ts
// packages/observability/src/with-llm-call.ts
import type { LLMCallEvent, LLMCallProviderValue } from "./llm-call.js";
import { sinkOrDefault } from "./llm-call.js";
import { llmGate } from "./concurrency.js";
import { extractDebugSnippets } from "./debug-snippets.js";

const DEEPSEEK: LLMCallProviderValue = "deepseek";

export interface WithLLMCallOpts {
  scope: string;
  attempt?: number;          // default 0; withRetry 调时增量
  traceId: string;            // 必需 — 由调用方从 createLogger.traceId 传入
  prompt?: string;            // 可选 — debug snippets 用
}

export interface VercelAIResult {
  // Vercel AI SDK 6 generateText 返回的最小子集 (满足 type narrow)
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
  };
  text?: string;
  // 其他字段保留 (pass-through)
}

export async function withLLMCall<T extends VercelAIResult>(
  opts: WithLLMCallOpts,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const event: Partial<LLMCallEvent> = {
    scope: opts.scope,
    provider: DEEPSEEK,
    traceId: opts.traceId,
    attempt: opts.attempt ?? 0,
  };
  try {
    const result = await llmGate(() => fn());
    const latencyMs = Date.now() - start;
    const usage = result.usage ?? {};
    sinkOrDefault({
      ...event,
      model: extractModel(result) ?? "unknown",
      status: "success",
      latencyMs,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      cacheReadTokens: usage.cachedInputTokens,
      debugSnippets: extractDebugSnippets({ prompt: opts.prompt, completion: result.text }),
    } as LLMCallEvent);
    return result;
  } catch (err) {
    const latencyMs = Date.now() - start;
    const { status, errorClass, errorCode } = classifyError(err);
    sinkOrDefault({
      ...event,
      model: "unknown",
      status,
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      errorClass,
      errorCode,
    } as LLMCallEvent);
    throw err; // 不吞错
  }
}
```

`classifyError`:
- `TransientProviderError` + message 含 `429`/`rate` → `status: "rate_limit"`
- `TransientProviderError` + message 含 `timeout`/`AbortError` → `status: "timeout"`
- 其他 → `status: "error"`

## 6. middleware 实现 (Vercel AI SDK 6)

```ts
// packages/observability/src/llm-middleware.ts
import type { LanguageModelV2Middleware } from "@ai-sdk/provider";
import { withLLMCall } from "./with-llm-call.js";

export interface LLMObsMiddlewareOpts {
  scope: string;
  traceId: string | (() => string);  // 函数形式让每次调用拿新 traceId
}

export function llmObservabilityMiddleware(
  opts: LLMObsMiddlewareOpts,
): LanguageModelV2Middleware {
  return {
    wrapGenerate: async ({ doGenerate, params }) => {
      const traceId = typeof opts.traceId === "function" ? opts.traceId() : opts.traceId;
      // 不抽 prompt 进 default event (R4 secret masking); debug-gated 时由 extractDebugSnippets 处理
      return withLLMCall({ scope: opts.scope, traceId }, () => doGenerate());
    },
    wrapStream: async ({ doStream, params }) => {
      const traceId = typeof opts.traceId === "function" ? opts.traceId() : opts.traceId;
      const start = Date.now();
      // streaming 略 — 收集 usage 在最终 chunk
      const result = await doStream();
      // TODO: 在 result.fullStream 的 finish chunk 上记录 event (Wave A 实施时定具体形态)
      return result;
    },
  };
}
```

`wrapGenerate` 直接复用 `withLLMCall` (DRY)。`wrapStream` 因为 streaming usage 信号在最终 finish chunk, 实现路径稍微不同 — 在 transform stream 里收集 usage, finish chunk 触发 sink (Wave A 落地时确认 SDK 6 API 形态)。

## 7. 5 Site 接入设计

### 7.1 `apps/web/lib/assistant/model.ts` — middleware 接入

```ts
import { createDeepSeek } from "@ai-sdk/deepseek";
import { wrapLanguageModel } from "ai";
import { llmObservabilityMiddleware } from "@merism/observability";
import { randomUUID } from "node:crypto";

const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });

export const CHAT_MODEL = wrapLanguageModel({
  model: deepseek("deepseek-chat"),
  middleware: llmObservabilityMiddleware({
    scope: "morris.toolloop",
    traceId: randomUUID, // 每次 wrapGenerate 调用拿新 traceId
  }),
});

export const REASONING_MODEL = wrapLanguageModel({
  model: deepseek("deepseek-reasoner"),
  middleware: llmObservabilityMiddleware({
    scope: "morris.toolloop.reasoner",
    traceId: randomUUID,
  }),
});
```

**重要**: ToolLoopAgent 内部每个 step 调 LLM 都会经过 middleware, 每个 step 产生独立 LLMCallEvent (含独立 traceId)。多步访谈对应多条 event, 可以用 `scope.endsWith(".toolloop")` 过滤。

### 7.2 `apps/web/lib/assistant/compaction.ts`

```ts
import { withLLMCall } from "@merism/observability";

export const summarizeMessages: Summarizer = async (messages) => {
  const traceId = createLogger("morris.compaction").traceId;
  return withLLMCall(
    { scope: "morris.compaction.summarize", traceId },
    () => generateText({ model: CHAT_MODEL, prompt: ... }),
  );
};
```

注意: `CHAT_MODEL` 自身已 wrap middleware, 所以内层 wrapGenerate 也会触发一次 sink。**两条 event** (一条 scope=`morris.toolloop`, 一条 scope=`morris.compaction.summarize`)。这是 by design — 让 logs 既看到"哪个调用点"(compaction summarizer) 又看到"哪个 model"(toolloop chain)。**去重** 由日志查询层做 (e.g. `traceId=xxx AND scope LIKE 'morris.compaction.%'`)。

替代设计 (拒绝): 只用 middleware, 不在 compaction 显式 wrap — 会丢失"是 compaction 调的"信息, 因为 middleware 看到的 scope 全是 `morris.toolloop`。

### 7.3 `apps/web/lib/actions/notebooks.ts`

```ts
"use server";
import { withLLMCall, createLogger } from "@merism/observability";

export async function generateNotebookReport(...) {
  const log = createLogger("action.notebooks.generateReport");
  return withLLMCall(
    { scope: "action.notebooks.generateReport", traceId: log.traceId },
    () => generateText({ model: deepseek("deepseek-chat"), ... }),
  );
}
```

注意: 这里的 model 是**本地 createDeepSeek 实例** (没经过 middleware)。所以这条调用产生**单条** event。如果未来想把所有 server action 的 LLM 调用走 middleware, 抽出 `apps/web/lib/server/llm-models.ts` 集中管理。

### 7.4 `apps/functions/analyzeSession/src/deps.ts`

```ts
import { withLLMCall } from "@merism/observability";

export function createRealDeps(env, log): AnalyzeSessionDeps {
  return {
    callLLM: async (prompt, attempt = 0) => withLLMCall(
      { scope: "function.analyzeSession.text-pass", traceId: log.traceId, attempt },
      () => generateText({ model: deepseekModel, ...prompt }),
    ),
    callVisualConsolidate: async (prompt) => withLLMCall(
      { scope: "function.analyzeSession.visual-consolidate", traceId: log.traceId },
      () => generateText({ model: deepseekModel, ...prompt }),
    ),
    // ...
  };
}
```

`attempt` 配合 `withRetry`: 调用方循环 `withRetry({maxAttempts: 3}, () => deps.callLLM(prompt, attemptCount++))` (要在 deps 上加 attempt 参数 wire 进 withLLMCall)。

### 7.5 `apps/functions/analyzeSurvey/src/deps.ts`

形态同 7.4, scope 分别 `function.analyzeSurvey.rollup` 和 `function.analyzeSurvey.aggregate`。

## 8. 并发 gate (R6)

```ts
// packages/observability/src/concurrency.ts
import pLimit from "p-limit";

const MAX = Number(process.env.MERISM_LLM_MAX_CONCURRENT ?? "8");
const limit = pLimit(MAX);

export const llmGate = <T>(fn: () => Promise<T>): Promise<T> => limit(fn);
```

单进程内一个 gate (Web 进程 + 每个 Function 进程 各自一个 — 不共享 cross-process)。

跨进程限流 (例如 web + function 同时撞 DeepSeek 429): **不在本 spec 范围**。需要时引入 Redis-based distributed gate, 但当前规模 single-instance 部署足够。

## 9. Debug snippets (R7)

```ts
// packages/observability/src/debug-snippets.ts
const DEBUG_ENABLED = process.env.MERISM_DEBUG_PROVIDERS === "1";

export function extractDebugSnippets(opts: {
  prompt?: string;
  completion?: string;
}): { promptHead?: string; completionHead?: string } | undefined {
  if (!DEBUG_ENABLED) return undefined;
  const out: { promptHead?: string; completionHead?: string } = {};
  if (opts.prompt) out.promptHead = opts.prompt.slice(0, 200);
  if (opts.completion) out.completionHead = opts.completion.slice(0, 200);
  return Object.keys(out).length > 0 ? out : undefined;
}
```

K-LLMOBS-09 测试三态:
- env unset → `extractDebugSnippets({prompt: "x"})` returns `undefined`
- env=`"0"` → returns `undefined`
- env=`"1"` → returns `{promptHead: "x"}`
- env=`"true"` (非 "1") → returns `undefined` (严格 "1" 才启用)

## 10. 测试设计

按 `testing.md::Four layers`:

### Layer 1 — Unit (`packages/observability/test/`)

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `llm-call.test.ts` | 8 | LLMCallEventSchema 自洽 (K-LLMOBS-01..05) |
| `with-llm-call.test.ts` | 7 | withLLMCall 成功 / 失败 / rate_limit / timeout / attempt 增量 |
| `llm-middleware.test.ts` | 6 | wrapGenerate 拦截 / wrapStream 拦截 / 多 middleware 链路 |
| `concurrency.test.ts` | 4 | gate 限流 / 顺序 / env 解析 |
| `debug-snippets.test.ts` | 3 | env 三态 (K-LLMOBS-09) |

总 28 用例。

### Layer 2 — Property-based (`tests/properties/morris-llm-observability/`)

| 文件 | 性质 |
|---|---|
| `event-roundtrip.test.ts` | 任意合法 LLMCallEvent zod parse 后 `JSON.stringify ↔ parse` 闭环 |
| `attempt-monotonic.test.ts` | withRetry 模拟 attempt 序列 0/1/2 严格递增 |
| `secret-masking.test.ts` | env unset 时, default sink 收到的 event 序列化后**不含** prompt/completion 字符 (R4 / K-LLMOBS-06) |

3 个 PBT × 100 runs = 300 invariant 触发。

### Layer 3 — Integration with fakes

接入面集成测试 (5 site 各一份):
- `apps/web/lib/assistant/__tests__/model-middleware.test.ts` — 用 Vercel AI SDK 6 的 `mockLanguageModelV1` (PostHog `FakeChatOpenAI` 等价物) 跑 middleware 链路, 验证 sink 收到正确 LLMCallEvent
- `apps/functions/analyzeSession/tests/llm-instrumentation.test.ts` — withLLMCall + fake deps
- 等

### Layer 4 — Live integration (gated)

`MERISM_LIVE_TESTS=1` + 真 DeepSeek API key (本地 `.env.local`, gitignored) 跑端到端:
- 生成 1 个简短 generateText
- 验证 sink 收到 event, `inputTokens > 0`, `latencyMs > 0`, `status === "success"`

不在 default CI 跑。

测试 fixture 集中在 `packages/observability/test/fixtures/install-mocks.ts`, 跟 `testing.md::Test double pattern §1` 一致。

## 11. 文档同步 (R9)

### 11.1 `.kiro/steering/errors-and-observability.md::Provider adapter rules`

加一条 (binding):
> Every LLM call MUST go through `packages/observability::withLLMCall` (explicit) or `wrapLanguageModel({middleware: llmObservabilityMiddleware(...)})` (implicit). Direct `generateText` / `streamText` without one of these is forbidden — detection: `grep -rn 'await generateText\b' apps packages | grep -v 'withLLMCall\|llmObservabilityMiddleware'` should be empty (excluding tests).

### 11.2 `apps/web/AGENTS.md::Morris page assistant`

加 LLM observability binding 节, 列 5 个接入点 + scope 命名规范。

### 11.3 根 `AGENTS.md::Repository Map`

提及 `morris-llm-observability` sub-spec, 让它进 sub-spec 规划链。

### 11.4 `.kiro/steering/architecture.md::Where new things go`

加一行:
| New thing | Goes in |
|---|---|
| LLM 调用观测 | 走 `packages/observability::withLLMCall` 或 `llmObservabilityMiddleware`, scope 用规范命名 |

## 12. 拒绝的 6 个备选方案

### 备选 A — 接 LangSmith / OpenAI built-in tracing
**拒绝**: 数据出境 (researcher prompt 含访谈内容), `errors-and-observability.md::Secret masking` 不允许; 且 ADR 锁定 DeepSeek 不走 OpenAI。

### 备选 B — 接 Sentry / Datadog SaaS error tracking
**拒绝**: 同上数据出境; 当前规模 logger.info 已够。Sentry SaaS 需要新 ADR + 数据合规审查。

### 备选 C — 接 OpenTelemetry-LLM (otel-genai semantic conventions)
**拒绝**: 标准还在 "Experimental" 状态; 引入 OTLP exporter + collector 复杂度高于当前需求; 我们用更轻的 logger sink 即可。**未来如果运维需要**, 可以加一个 OpenTelemetry sink (作为 plug-in), 不改 schema。**保留接口**, 不实施。

### 备选 D — 把 PostHog ai_observability SDK 当 npm 装上用
**拒绝**: 它是 PostHog 的客户产品 SDK, 把数据 POST 到 cloud.posthog.com — 数据出境同 A/B。形态对 (我们在借鉴它的 schema), 但实现路径不能照搬。

### 备选 E — LangChain CallbackHandler
**拒绝**: 我们不用 LangChain (`scope.md::Globally forbidden`: "LangGraph as the realtime interview controller" — 从来没把 LangChain 引入 TS 侧)。Morris 用 Vercel AI SDK 6 直接, 没 LangChain layer。

### 备选 F — 调用点显式 `withLLMCall` (而不用 middleware)
**部分拒绝, 部分采纳**: 
- ToolLoopAgent 内部 LLM 调用是**框架自动调**, 调用点不可见 — 必须 middleware 才能拦截
- Server Action / Function 调用点可见 — 显式 `withLLMCall` 反而**更精确** (能保留 scope 信息)
- 因此采纳**双层** (R2): middleware (model.ts) + 显式 (compaction / actions / functions)

### 备选 G — 在 `LLMCallEvent` 里塞 `messages` / `prompt` 完整字段
**拒绝**: secret masking — researcher prompt 含访谈原文, 不能默认 log。debug 路径用 `MERISM_DEBUG_PROVIDERS=1` env-gated 截首 200 字符 (R4/R7) 已足。

## 13. 边界 (out of scope, 等后续 sub-spec)

- Python 侧 `apps/agent/agent/providers/*` 的 LLM 调用观测 — 走另一份 `morris-llm-observability-py`, 现在不做
- 跨进程限流 — single-instance 当前足够
- LLM cost/billing 计算 — 可以加但不必, 调用方按 token 自己估
- LLM call 持久化到 Appwrite collection 做 dashboard — 等 `function_errors` 类似 spec 一起规划
- Multi-LLM provider router — ADR-0002 锁定 DeepSeek, 改要新 ADR
- Frontend RUM — 不在 scope (researcher 单用户产品)

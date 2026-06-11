---
inclusion: always
---

# Errors & Observability (binding)

`packages/observability` is the only allowed primitive for logging, retry, error boundaries, and secret masking. `apps/agent/agent/logging.py` and `apps/agent/agent/retry.py` mirror the same shape on the Python side. This file is the operational rulebook for `try/catch` discipline, structured logging, error codes, secret handling, and `traceId` propagation. Read together with `architecture.md` Function shape.

## try/catch matrix (binding)

A `catch` clause MUST do exactly one of:

| Case | What to do | Example |
|---|---|---|
| **Known, expected error** (e.g. Appwrite 409, link not found) | Translate to a typed result code and return | `if (e?.code === 409) return false` in `createSession` |
| **Unknown error from a side effect** | Re-throw or let it propagate to `withErrorBoundary` | default behaviour in `handler.ts` |
| **Best-effort cleanup / rollback** | `.catch(() => {})` with an explicit comment why silent continuation is correct | `deleteRoom(...).catch(() => {})` after partial failure |
| **Provider transient failure** | Throw `TransientProviderError`; let `withRetry` decide | LLM/STT/TTS adapters |
| **Provider permanent failure** | Throw `PermanentProviderError`; never retried | invalid api key, rejected payload |

**NEVER** allowed:

- `try { ... } catch {}` with no comment
- `try { ... } catch (e) { /* ignored */ }` outside of best-effort cleanup
- `try { ... } catch { return null }` to "make TypeScript happy"
- `try { ... } catch { return [] }` to mask data-source failures (this hides production breakage)
- Swallowing an error in render code instead of surfacing to an error boundary

Detection:

```bash
# bare empty catches
grep -RIn 'catch[[:space:]]*([[:space:]]*[a-zA-Z_]*[[:space:]]*)[[:space:]]*{[[:space:]]*}' apps packages
# catches that immediately return a default
grep -RIn 'catch.*{[^}]*return \(null\|undefined\|\[\]\|{}\)' apps packages
```

A hit that is NOT a documented best-effort cleanup is a defect.

## Logger contract (binding)

Logger is the only entry point for diagnostic output.

- TypeScript: `import { createLogger, maskSecret } from "@merism/observability"`
- Python: `from agent.logging import create_logger`

Rules:

- One logger per Function invocation / agent session. NEVER a module-level singleton — each invocation gets its own `traceId`.
- `console.log` / `print` are NOT allowed in `apps/`, `packages/`, or `apps/agent/agent/`. (Test output and one-off scripts in `scripts/` may use them.)
- Log entries are JSON. Required fields: `timestamp`, `level`, `traceId`, `scope`, `message`. Optional: `sessionId`, `surveyId`, plus any structured fields the call passes.
- Pass the logger explicitly to inner functions; do not import a global.

Levels:

| Level | Use |
|---|---|
| `info` | Lifecycle events (token issued, session completed, function invoked) |
| `warn` | Recoverable failures, rate-limit hits, missing optional config |
| `error` | Unrecoverable failures, unhandled exceptions caught at the boundary |

Provider adapters (LLM, ASR, TTS) MUST NOT log raw prompts or generated text at `info`. Those go to `debug` only and are gated by an env flag, never enabled in production.

## Error codes (binding)

Cross-module errors carry an explicit string `error` code, never a stack trace and never a free-form message.

Canonical codes used today:

| Code | Status | Meaning |
|---|---|---|
| `invalid_input` | 400 | request schema rejected the body |
| `link_not_found` | 404 | interview link token does not resolve |
| `link_expired` | 410 | link past `expiresAt` |
| `link_revoked` | 410 | `isRevoked === true` |
| `link_exhausted` | 410 | all slots claimed |
| `survey_not_published` | 410 | publish gate failed |
| `internal_error` | 500 | uncaught error caught by `withErrorBoundary` |

Rules:

- Adding a new code requires a comment in the schema or handler explaining when it fires and which client UI handles it.
- Client-facing response bodies MUST NOT include stack traces or raw error messages. Return `{ error: "<code>", traceId? }` only. The full stack is in the server log under the same `traceId`.
- Error code strings are stable forever once shipped; if semantics change, introduce a new code and deprecate the old one (parallel to schema deprecation).

## Secret masking (binding)

`maskSecret(value, visible=4)` is the only allowed serialization of secret-bearing values.

Subject to masking: LiveKit JWT, Appwrite API key, provider API keys, OAuth tokens, Cookie values, anything in `.env` with `*KEY` / `*SECRET` / `*TOKEN` in its name.

Rules:

- Secrets MUST NOT appear in any log line at any level. Use `maskSecret(token)` (returns `"abcd***"`).
- Secrets MUST NOT appear in response bodies (issued tokens are an obvious exception — they are the response payload, but they MUST NOT also appear in `logger.info` at full length).
- `.env*` files are gitignored. `.env.example` carries placeholder values only.
- Test snapshots MUST NOT contain real secrets. Use `<masked>` / `<jwt-redacted>` placeholders.
- Pure-core handlers (`handler.ts`) MUST NOT receive raw secrets; secrets stay in `main.ts` and are passed to the LiveKit / Appwrite SDKs there.

Detection:

```bash
# any literal that looks like a JWT or hex key in source
grep -RIn 'eyJhbGciOi\|sk_live_\|sk_test_\|[A-Fa-f0-9]\{32,\}' apps packages tests
```

A non-`.env.example` hit is a defect.

## Retry semantics (binding)

`withRetry` is the only allowed retry wrapper. `setTimeout(fn, ms)` loops, `for ... await sleep(...)`, and ad-hoc `Promise.retry`-style helpers are forbidden.

- `TransientProviderError` is retried with exponential backoff up to `maxAttempts` (default 3).
- `PermanentProviderError` is never retried.
- Any other error is re-thrown without retry.
- Backoff and jitter are configured at the call site (`withRetry(fn, { maxAttempts, baseDelayMs })`), not inside the adapter.
- Adapters classify errors into `TransientProviderError` vs `PermanentProviderError` and let the call site decide retry policy.

Python mirror: `agent.retry.with_retry` follows the same shape (`TransientProviderError` / `PermanentProviderError`).

## traceId propagation (binding)

- Every Function entry point creates a `traceId` via `createLogger(scope)`.
- Every realtime session creates a `traceId` via `create_logger(scope)` on the agent worker.
- Cross-module log lines that share work MUST share the same `traceId`. If a Function spawns an agent task, the `traceId` propagates via room metadata or RPC payload.
- Function 5xx responses MUST include `{ error, traceId }`. Function 2xx responses MUST NOT include `traceId` (avoid leaking server identifiers needlessly).
- The Function 4xx response shape is `{ error: "<code>" }` without `traceId` — 4xx is a client problem and the trace is in the server log if needed.

## Function error boundary (binding)

`withErrorBoundary(scope, handler)` is the only allowed wrapper for an Appwrite Function entry point.

- It catches any uncaught throw, logs the stack with `logger.error("unhandled function error", { stack })`, and returns `{ ok: false, status: 500, error: "internal_error", traceId }`.
- The wrapped handler returns `{ ok: true, data }` on success. The SDK wrapper (`main.ts`) then maps that to the Appwrite Function `res.json(...)`.
- Handlers MUST NOT directly return a 5xx body. If a 5xx is needed, throw and let the boundary shape it.
- Handlers MUST return 4xx via the structured result type (`{ status: 400, body: { error: "invalid_input" } }`) — those are not exceptional control flow.

## Provider adapter rules (binding)

- DeepSeek is the only LLM. Qwen is reserved for ASR/TTS. Adding a second provider for either role requires a new ADR in `docs/adr/`.
- Adapters live in `apps/agent/agent/providers/<vendor>.py` (Python) or `apps/web/lib/assistant/providers/<vendor>.ts` (page-assistant TS).
- An adapter implements one provider behind a narrow interface. Swapping providers means writing a new adapter, not editing call sites.
- Adapters MUST classify failures into `TransientProviderError` vs `PermanentProviderError` so `withRetry` can act.
- Adapters MUST NOT log raw prompts, raw completions, or raw audio at `info`. Debug-level logging is allowed only when explicitly gated by `MERISM_DEBUG_PROVIDERS=1` and disabled by default.

## LLM call observability (binding)

Per `.kiro/specs/morris-llm-observability/`. 借鉴 PostHog `products/ai_observability/backend/llm/Client + AnalyticsContext` 但仅基础设施层观测, 不接外部 SaaS, 不做客户产品形态.

### Approved entry points

Every LLM call MUST go through one of:

1. **`withLLMCall<T>(opts, fn)`** (`@merism/observability`) — 调用点可见时 (Server Actions / Function deps / compaction summarizer).
2. **`wrapLanguageModel({ middleware: llmObservabilityMiddleware(opts) })`** — 调用点不可见时 (ToolLoopAgent 内部, 走 model 实例).

直接 `await generateText(...)` / `streamText(...)` 没经过任一是 forbidden. 检测:

```bash
grep -rn 'await generateText\b\|await streamText\b' apps packages \
  --include='*.ts' --include='*.tsx' \
  | grep -v node_modules | grep -v '__tests__' | grep -v '\.test\.\|\.spec\.' \
  | grep -v 'withLLMCall\|llmObservabilityMiddleware'
# 上面输出应为空; 否则该 site 漏接
```

### Scope naming (binding)

`scope` 字段必须满足正则 `^(morris|function|action)\.[a-zA-Z][\w-]*(\.[a-zA-Z][\w-]*)*$` (代码中常量为 `LLM_CALL_SCOPE_RE`):

| Prefix | 用途 | 例 |
|---|---|---|
| `morris.tool.<toolName>` | Morris 工具调用 (未来) | `morris.tool.analyzeData` |
| `morris.compaction.<phase>` | Morris 对话压缩 | `morris.compaction.summarize` |
| `morris.toolloop[.suffix]` | ToolLoopAgent 内部 (middleware 自动) | `morris.toolloop` / `morris.toolloop.reasoner` |
| `function.<functionName>.<phase>` | Appwrite Function 内 LLM 调用 | `function.analyzeSession.text-pass` |
| `action.<actionName>` | Server Action 内 LLM 调用 | `action.notebooks.generateReport` |

### LLMCallEvent schema (R1)

只暴露这几个字段; 不允许再加 prompt / completion / messages 等含敏感内容:

`scope / model / provider / status / latencyMs / inputTokens / outputTokens / totalTokens / cacheReadTokens? / traceId / errorClass? / errorCode? / attempt / debugSnippets?`

`debugSnippets` 仅 `MERISM_DEBUG_PROVIDERS=1` 时存在 (env 严格 "1"; "true" / "0" / unset 均关闭), 各字段截首 200 字符.

### Sink rule (R3)

Default sink = `createLogger(scope).info("llm.call", event)`. 不允许的 sink: LangSmith / Sentry / Datadog / 任何向公网 POST 的服务. 内存 array (测试) / Appwrite collection (未来) 允许.

### Concurrency gate (R6)

LLM 调用全部走 `llmGate` (p-limit 包装), default 最多 8 并发, env `MERISM_LLM_MAX_CONCURRENT` 可调. 这是单进程内 gate; 跨进程不在范围.

### Wave B 接入清单

| 接入点 | 方式 | scope |
|---|---|---|
| `apps/web/lib/assistant/model.ts::CHAT_MODEL/REASONING_MODEL` | middleware | `morris.toolloop` / `morris.toolloop.reasoner` |
| `apps/web/lib/assistant/compaction.ts::summarizeMessages` | withLLMCall | `morris.compaction.summarize` |
| `apps/web/lib/actions/notebooks.ts::createNotebook` | withLLMCall | `action.notebooks.generateReport` |
| `apps/web/lib/actions/guide-ai.ts::generateGuide / expandSection` | withLLMCall | `action.guide-ai.<fn>` |
| `apps/functions/analyzeSession/src/deps.ts` (text-pass + quality-flags) | withLLMCall | `function.analyzeSession.<phase>` |
| `apps/functions/analyzeSurvey/src/deps.ts` (extract / assign / combine / compose) | withLLMCall | `function.analyzeSurvey.<phase>` |
| `apps/web/lib/conversations/title.ts::generateConversationTitle` | withLLMCall | `morris.title.generate` |

新增 LLM 调用 site 必须同步登记到此表. ADR-0005 `analyzeSessionVisual` 由对应 PR 接入.

### Non-LLM 信号 logger scope

下列**非 LLM** 调用也走 `createLogger(scope).info(event, ...)`, 与 `llm.call` 共享日志基础设施 (per `errors-and-observability.md::Logger contract`). 这些 scope 不进 LLMCallEventSchema (它们不是 LLM 调用), 但日志查询统一:

| scope | 事件 | 用途 |
|---|---|---|
| `action.conversations.feedback` | `morris.feedback` | thumbs up/down + 可选 textarea (per `morris-conversation-persistence` Wave 2 + code-review P2 #11) |
| `action.conversations` | `conversation.created` / `conversation.deleted` / `conversation.title.generated` | conversation lifecycle |
| `action.memories` | `memory.created` / `memory.updated` / `memory.deleted` / `memory.query.embedding.failed` | memory lifecycle (per `morris-memory`) |
| `memories.embed` | `memory.embed.saved` / `memory.embed.failed` | Qwen embed background task |

## Feature flags / env toggles (binding)

项目用环境变量驱动若干运行时开关. **所有 boolean 类 env flag 必须登记到本表**, 且必须用**严格字面量比较** (`=== "1"`), 不允许 `Boolean(...)` / `!!process.env.X` / 模糊 truthy 检查.

### 当前清单

| Flag | 类型 | 值语义 | 用途 | 登记于 |
|---|---|---|---|---|
| `MERISM_LLM_MAX_CONCURRENT` | int | 1+ (default 8) | `packages/observability::llmGate` 单进程内 LLM 并发上限 | `packages/observability/src/concurrency.ts` |
| `MERISM_DEBUG_PROVIDERS` | bool | 严格 `"1"` 启用 | LLM 调用 event 含 prompt/completion 截首 200 字符 (production 永远不开) | `packages/observability/src/debug-snippets.ts` |
| `MERISM_LIVE_TESTS` | bool | 严格 `"1"` 启用 | Layer 4 live integration tests (需 Appwrite Docker stack) | `tests/properties/foundation-setup/permission-matrix.test.ts` |
| `MERISM_FAKE_PROVIDERS` | bool | 严格 `"1"` 启用 (规划中, 未实现) | 替换真 LLM/ASR/TTS provider 为 deterministic fake (live tests 用) | (规划) |
| `GEMINI_VISUAL_ANALYSIS_ENABLED` | bool | 严格 `"true"` 启用 (ADR-0005) | analyzeSessionVisual Function 是否实际调用 Gemini | `apps/functions/analyzeSessionVisual/src/main.ts` |

### 不一致点 (历史保留, 不重构)

`GEMINI_VISUAL_ANALYSIS_ENABLED` 用 `=== "true"` 而其他 MERISM_* flag 用 `=== "1"` — 是 ADR-0005 那个独立工作流引入的, 不在本项目重构范围. **新 flag 一律用 `=== "1"`**.

### 加新 flag 的规则 (binding)

1. 命名: `MERISM_<DOMAIN>_<NAME>` 全大写 + 下划线 (例: `MERISM_LLM_MAX_CONCURRENT`)
2. 类型 + 值: 必须明确 (bool 严格 `"1"`; int 用 `parseInt` + 兜底 default; string 直接读)
3. 必须登记到本表 + 在 `.env.example` 给 placeholder + 在使用文件的 JSDoc 标注用途
4. **不要**写 isEnabled helper / FlagsContext 类抽象 — 当前规模 (5 个 flag, 4 个 boolean) 不需要 indirection 层
5. flag 默认值必须**安全**: 即"unset → 关闭" / "unset → 安全行为" (例: DEBUG_PROVIDERS unset 关闭, LIVE_TESTS unset 跳过, MAX_CONCURRENT unset 用 default 8)

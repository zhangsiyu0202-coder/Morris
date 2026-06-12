---
inclusion: always
---

# Testing (binding)

Four-layer test model with mandatory property-based coverage. Tests ship in the SAME PR as the code under test — never deferred. Read together with `architecture.md` Function shape and `contracts.md` invariants.

## Four layers (binding)

| Layer | Where | What it covers | Runs in CI |
|---|---|---|---|
| **Unit** | `*.test.ts` next to source, `tests/test_*.py` | Pure functions, schemas, pure-core handlers with in-memory deps | every PR |
| **Property-based** | `tests/properties/*.test.ts`, `apps/agent/tests/properties/*.py` | Invariants, state machines, concurrency, secret leakage | every PR |
| **Integration with fakes** | `*/tests/test_*.py` with fake repos / fake livekit | Cross-component flow without real infra | every PR |
| **Live integration** | same files, gated by `MERISM_LIVE_TESTS=1` | Real Appwrite + LiveKit Docker stack | nightly + on-demand |

A new feature ships with **at least Unit + Property** coverage in its first PR. Integration / live integration are added when the surface stabilizes — but never deferred more than one sub-spec cycle.

## Property-based mandatory scenarios (binding)

For every Function, agent workflow component, and contract change, the following property tests MUST exist (or be extended) in the same PR:

| Domain | Property |
|---|---|
| **Schema round-trip** | `Schema.parse(Schema.parse(x))` is idempotent for any valid input the generator produces |
| **Schema rejection** | Inputs that violate any `superRefine` clause are rejected with a stable issue path |
| **Permission** | Anonymous role can never read/write owner-scoped collections; owner role can never read another owner's data |
| **Token issuance** | Every issued LiveKit token has `ttl <= TOKEN_TTL_SECONDS`, scoped room == sessionId, identity prefix == `interviewee:` |
| **Secret leakage** | No log line, no response body, and no test snapshot contains a literal that matches `eyJhbGci\|sk_(live\|test)_\|[A-Fa-f0-9]{32,}` |
| **State machine** | Survey status, session state, and quality flags only transition via documented edges (`SURVEY_STATUS_TRANSITIONS`, `SessionQualityFlagSchema` mutex pairs) |
| **Concurrency** | N concurrent claims to a single-use link produce exactly one session; N concurrent claims to a reusable link produce min(N, maxUses) sessions, never more |
| **Rollback** | Partial-failure paths leave no orphan room, no orphan session, and no inflated `usedCount` |

The property tests for each Function live next to the unit tests (`apps/functions/<name>/tests/`). The cross-cutting ones (permission, secret leakage) live in the workspace root `tests/properties/`.

Reference templates already in the repo: `tests/properties/`, `apps/agent/tests/properties/`. New property tests follow the same fast-check / hypothesis style.

## Live integration gating (binding)

- Live integration tests MUST be gated by `MERISM_LIVE_TESTS=1`. The default `pnpm test` / `pnpm test:py` run MUST pass without any Docker dependency.
- The `--extra realtime` Python deps are also gated: foundation tests MUST run with plain `uv sync` (no realtime extra). Tests that require livekit-agents are tagged and skipped when the import fails.
- Live integration test scripts:
  ```bash
  pnpm stack:up                                  # Appwrite + LiveKit via Docker
  pnpm schema:apply                              # idempotent
  MERISM_LIVE_TESTS=1 pnpm test:properties       # permission matrix, token leakage
  pnpm smoke                                     # researcher → survey → link → token end-to-end
  ```
- Live tests MUST NOT use real provider keys (DeepSeek / Qwen). Use the `MERISM_FAKE_PROVIDERS=1` flag to substitute deterministic fakes.

## Test naming and placement (binding)

- TS unit / property: `<name>.test.ts`, vitest. No Jest. Place next to source under `__tests__/` or as a sibling.
- Python unit / property: `tests/test_<name>.py`, pytest + hypothesis.
- Cross-package property tests in workspace root: `tests/properties/`.
- Test fixtures MUST NOT be imported from production code. Production code MUST NOT have `if (process.env.NODE_ENV === 'test')` branches; use Deps injection instead.

## Coverage expectations (binding)

- Pure-core handlers (`apps/functions/*/src/handler.ts`): **100%** branch coverage. Tested via in-memory `Deps`.
- zod schemas with `superRefine`: every clause has at least one positive test (input that passes) and one negative test (input that fails with the expected issue path).
- Workflow state functions in `apps/agent/agent/interview/workflow.py`: every transition function has unit + property test.
- SDK wrappers (`main.ts`, `appwrite_repository.py` `from_env`): integration tested only — no need for branch coverage on the env wiring.

## Test double pattern (binding)

借鉴 PostHog `ee/hogai/utils/tests.py::FakeChatOpenAI` (LangChain `FakeMessagesListChatModel` 子类) 的"接口级 fake 类 + factory 集中维护"模式。Vitest 在 TS 侧的对应实现:

### 1. Fake 实现集中在 fixtures, 不重复粘贴

PostHog 的 `FakeChatOpenAI` 是一份 export 的类, 测试文件 `patch("...node._model", return_value=FakeChatOpenAI(...))` 复用. 我们在 vitest 里对应:

```ts
// apps/web/lib/assistant/__tests__/fixtures/install-mocks.ts
export function fakeQueriesModule() {
  return {
    listStudies: vi.fn(),
    searchTranscriptSegments: vi.fn(),
    getLatestAnalysisReport: vi.fn(),
    parseSurveyReportBody: vi.fn(),
    getStudy: vi.fn(),
  };
}
// + fakeNotebooksServerModule / fakeEmbedderQwenModule / fakeNodeAppwriteModule 同模式
```

### 2. 测试文件用 async factory + dynamic import 引用 fixtures

Vitest 把 `vi.mock(path, factory)` hoist 到 imports 之前. 直接 `vi.mock("...", fakeQueriesModule)` 引用 named import 会撞 `Cannot access __vi_import_0__ before initialization`. 用 async factory + dynamic import 让 fake 在 mock 第一次被命中时才 lazy 加载:

```ts
// apps/web/lib/assistant/__tests__/metadata.test.ts (示例)
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queries", async () => (await import("./fixtures/install-mocks")).fakeQueriesModule());
vi.mock("@/lib/server/notebooks", async () => (await import("./fixtures/install-mocks")).fakeNotebooksServerModule());
vi.mock("@/lib/server/embedder-qwen", async () => (await import("./fixtures/install-mocks")).fakeEmbedderQwenModule());
vi.mock("node-appwrite", async () => (await import("./fixtures/install-mocks")).fakeNodeAppwriteModule());
```

每个 vi.mock 是单行, 整体 4-5 行. fake 内部实现集中在 fixtures/install-mocks.ts, 改一处所有测试同步。

### 3. 优先级阶梯 (按 testability 取舍)

| 阶梯 | 何时用 | 例子 |
|---|---|---|
| **1. 真路径** (无 mock) | 模块只依赖纯函数 / 内存数据 | `compaction.test.ts` / `page-context.test.ts` / `tool-metadata.test.ts` 自洽部分 |
| **2. 接口级 fake 类** | 需要替换协议性依赖 (LLM / queue / DB read 层) | PostHog `FakeChatOpenAI`; 我们将来若做 Layer 4 live integration 用 Vercel AI SDK 的 `mockLanguageModelV1` |
| **3. 模块级 vi.mock + factory 集中** | 需要拦截 server-only module load (Appwrite SDK / @/lib/server/*) | 当前 `metadata.test.ts` / `tools.test.ts` / `create-notebook.test.ts` |
| **4. 字符串 vi.mock 复制粘贴** | **禁止** | — |

### 4. 借鉴 PostHog 不能照抄的部分

| PostHog | 我们的等价物 / 差异 |
|---|---|
| `FakeChatOpenAI(responses=[AIMessage(content="X")])` 预塞响应列表 | 暂未需要 (Morris 工具测试不直接走 LLM); 若做 Layer 4 用 Vercel AI SDK 的 `mockLanguageModelV1` |
| `patch("module.path._model", return_value=FakeXxx())` 注入工厂方法 | TS 没有 `patch` 装饰器; 等价方式是依赖注入 (builder 接 deps ctx) 或 `vi.mock` 模块拦截 |
| Django `BaseTest` + `@pytest.mark.django_db` 真 DB transaction | 我们用 `vi.mock("node-appwrite")` 拦截 (无 Docker stack 时); Layer 4 live integration 用真 Appwrite Docker stack |
| `posthog/temporal/ai/eval_slack_repo_selection.py` (DEBUG-only local script) | 同模式: 真 provider key 永远在本地 `.env.local` (gitignored), 不入 CI、不入仓库 (`errors-and-observability.md::Secret masking`) |

## Forbidden in tests (binding)

- Real provider API keys, even when expired. Use `MERISM_FAKE_PROVIDERS=1` fakes.
- Network calls to anything except `localhost` (Docker stack). External URLs cause flaky CI.
- `console.log` / `print` left in passing tests. Failing tests may temporarily print for debug, but final commit removes it.
- Sleeping (`setTimeout(..., 1000)` or `time.sleep(1)`) as a substitute for proper synchronization. Use deterministic fakes that resolve immediately.
- Snapshot tests that capture full HTTP response bodies (they leak headers and timestamps). Snapshot only the structured result subset.
- Sharing mutable state between tests (`let users = []` at module level). Each test sets up its own state.
- Inline `vi.mock(path, () => ({ ...factory body }))` 复制粘贴在多个测试文件. 用 `Test double pattern` §1-§2 的 fixtures + async factory + dynamic import 模式. 检测: `grep -RIn 'vi.mock("@\|vi.mock("node-appwrite' apps/web -A2 | grep -B1 'vi.fn\|class' | wc -l` 在多文件出现同样 fake 形状是漂移信号.

## Enforcement commands

```bash
# Workspace
pnpm test                              # vitest across the workspace
pnpm test:properties                   # fast-check property suites
pnpm test:py                           # pytest in apps/agent
pnpm typecheck                         # tsc --noEmit
pnpm lint                              # eslint

# Per-package
pnpm -F @merism/contracts test
pnpm -F @merism/observability test
cd apps/agent && uv run pytest

# Live (requires running stack)
MERISM_LIVE_TESTS=1 pnpm test:properties
pnpm smoke
```

A PR that does not pass `pnpm test && pnpm typecheck && pnpm test:py` is not ready to merge.

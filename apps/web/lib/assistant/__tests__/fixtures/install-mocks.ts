/**
 * Morris 测试 mock factory (testing.md / morris-tool-metadata Wave H 改进).
 *
 * 设计动机:
 * 三个 Morris 测试 (metadata.test.ts / tools.test.ts / create-notebook.test.ts)
 * 都要在 module load 时拦截 `@/lib/queries` / `@/lib/server/*` / `node-appwrite`
 * 这几个 server-only 依赖, 让 builder 链能跑过. 之前每个测试文件复制 4-5 块
 * `vi.mock(...)` —— 看着恶心、改一处要同步多处. 借鉴 PostHog ee/hogai 的
 * `FakeChatOpenAI` 模式 (LangChain `FakeMessagesListChatModel` 子类), 把
 * "fake 模块的内部实现" 集中在 factory 函数, 测试文件只写 vi.mock 字符串绑定.
 *
 * Vitest hoisting 的限制 (factory 必须是 named export 才能被 hoist):
 *   ✅ vi.mock("@/lib/queries", fakeQueriesModule)
 *   ❌ vi.mock("@/lib/queries", () => ({...}))   // 重复粘贴
 *
 * 改 fake 形状的规则:
 * - fake 字段 MUST 与 production module 的实际 export 保持同步.
 * - 新增 production export 时, 先在这里加 fake 实现, 再在 production 用.
 * - K-METADATA-* 之类断言已经强制了 builder ↔ manifest 一致, 这里只需保证 vi.fn() 类型对.
 */

import { vi } from "vitest";

/** Fake `@/lib/queries` (Appwrite-backed read layer). */
export function fakeQueriesModule() {
  return {
    listStudies: vi.fn(),
    searchTranscriptSegments: vi.fn(),
    getLatestAnalysisReport: vi.fn(),
    parseSurveyReportBody: vi.fn(),
    getStudy: vi.fn(),
  };
}

/** Fake `@/lib/server/notebooks` (server-only Notebook write helper). */
export function fakeNotebooksServerModule() {
  return {
    saveNotebookFromMarkdown: vi.fn(),
  };
}

/** Fake `@/lib/actions/survey` (server actions: create + persist SurveyDraft). */
export function fakeSurveyActionsModule() {
  return {
    createSurveyFromDraft: vi.fn(),
    createSurvey: vi.fn(),
    saveSurveyDraft: vi.fn(),
    updateSurveyStatus: vi.fn(),
    deleteSurvey: vi.fn(),
  };
}

/** Fake `@/lib/server/embedder-qwen` (Qwen text-embedding-v3 client). */
export function fakeEmbedderQwenModule() {
  return {
    embedText: vi.fn(),
    EMBEDDING_DIM: 1024,
    EMBEDDING_MODEL_TAG: "qwen.text-embedding-v3",
  };
}

/**
 * Fake `node-appwrite` SDK module.
 *
 * 必要: tools/search-across-studies.ts 在 module load 时构造一个 Client 实例,
 * 没有 env vars 时真实 SDK 会爆. 这里给 zero-arg 兼容的 stub.
 */
export function fakeNodeAppwriteModule() {
  class StubClient {
    setEndpoint() {
      return this;
    }
    setProject() {
      return this;
    }
    setKey() {
      return this;
    }
  }
  return {
    Client: StubClient,
    Databases: class {},
    Query: {
      equal: () => ({}),
      search: () => ({}),
      select: () => ({}),
      limit: () => ({}),
    },
    ID: { unique: () => "mock-id" },
    Permission: {
      read: () => "",
      update: () => "",
      delete: () => "",
    },
    Role: { user: () => "" },
  };
}

/**
 * 一行调用安装 Morris 工具测试通用的全部 mock.
 *
 * vitest hoisting 要求 `vi.mock` 在 module top-level, 且 factory 是 named export.
 * 因此本函数**不**直接 install — 它只是签名记录"应安装哪几个". 真正的安装在
 * 测试文件 top-level 用:
 *
 *   vi.mock("@/lib/queries", fakeQueriesModule);
 *   vi.mock("@/lib/server/notebooks", fakeNotebooksServerModule);
 *   vi.mock("@/lib/server/embedder-qwen", fakeEmbedderQwenModule);
 *   vi.mock("node-appwrite", fakeNodeAppwriteModule);
 *
 * 这是 vitest API 的固有限制, 不是设计缺陷. 集中点已经从"4 块复制粘贴"
 * 缩小到"4 行 vi.mock + factory 在 fixtures 里".
 */
export const MOCKED_MODULE_PATHS = [
  "@/lib/queries",
  "@/lib/server/notebooks",
  "@/lib/server/embedder-qwen",
  "node-appwrite",
] as const;

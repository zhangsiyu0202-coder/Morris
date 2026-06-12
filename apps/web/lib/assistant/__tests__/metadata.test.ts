/**
 * Morris ToolMetadata schema 自洽测试 (Wave A T2 / morris-tool-metadata).
 *
 * 本文件只测 `validateToolMetadata` 自身在固定 fixture 下的行为, 覆盖 R1 §3-§6
 * 的每条 invariant 与每条防 cast 路径。Wave B 完成后 (T11) 再扩展为遍历真实
 * `buildAssistantToolMetadata(ctx)` 输出的 K-METADATA-01..08 套件。
 *
 * 不依赖 `buildAssistantTools` / `buildAssistantToolMetadata` — 这两者要求
 * 7 个工具 builder 的 metadata 字段已经填齐 (Wave B), 当前 Wave A 还未到那一步。
 */

import { describe, expect, it, vi } from "vitest";

// 拦截 server-only module load 让 buildAssistantTools / buildAssistantToolMetadata
// 的静态 import 通过. factory 实现集中在 fixtures/install-mocks.ts. vitest hoisting
// 把 vi.mock 提到 imports 之前 — 用 async factory + dynamic import 绕开,
// fake 在 mock 第一次被命中时才 lazy 加载 (testing.md::Test double pattern).
vi.mock("@/lib/queries", async () => (await import("./fixtures/install-mocks")).fakeQueriesModule());
vi.mock("@/lib/server/notebooks", async () => (await import("./fixtures/install-mocks")).fakeNotebooksServerModule());
vi.mock("@/lib/server/embedder-qwen", async () => (await import("./fixtures/install-mocks")).fakeEmbedderQwenModule());
vi.mock("node-appwrite", async () => (await import("./fixtures/install-mocks")).fakeNodeAppwriteModule());

import {
  ENRICH_URL_PLACEHOLDER_RE,
  MIN_DESCRIPTION_CHARS,
  TOOL_TYPES,
  UNKNOWN_TOOL_METADATA,
  validateToolMetadata,
  type ToolMetadata,
} from "../tool-metadata";
import type { AssistantToolContext } from "../tool-types";

/** 一个合法的 read 类工具 metadata, 给各负面用例做基线深拷贝。 */
function validReadFixture(): ToolMetadata {
  return {
    title: "示例只读工具",
    description:
      "这是一个测试 fixture, 描述足够长以满足 MIN_DESCRIPTION_CHARS=120 阈值。" +
      "它代表一个典型的 read 类工具: 从 Appwrite 读出某个研究员的资源列表, 不写库, " +
      "结果可被后续工具串联或 UI 渲染。",
    annotations: { readOnly: true, destructive: false, idempotent: true },
    requiredScopes: ["study:read"],
    type: "read",
    enabled: true,
  };
}

function validWriteFixture(): ToolMetadata {
  return {
    title: "示例写入工具",
    description:
      "这是一个测试 fixture, 描述长度满足 ≥ 120 字符的硬约束。" +
      "它代表 write 类工具: 在 Appwrite 中创建新文档, 同样输入会产出不同 $id, " +
      "因此 idempotent=false, 但创建动作不破坏现有数据所以 destructive=false。",
    annotations: { readOnly: false, destructive: false, idempotent: false },
    requiredScopes: ["notebook:write"],
    enrichUrl: "/notebooks/{shortId}",
    type: "write",
    enabled: true,
  };
}

function validMetaFixture(): ToolMetadata {
  return {
    title: "示例元工具",
    description:
      "这是一个 meta 类工具的 fixture, 描述长度合规, 满足 MIN_DESCRIPTION_CHARS=120 的硬阈值。" +
      "meta 工具不与持久存储交互, 仅用于让 agent 自管 todo 列表 / 内部状态。" +
      "requiredScopes 必须为空数组, readOnly 必须为 true。",
    annotations: { readOnly: true, destructive: false, idempotent: false },
    requiredScopes: [],
    type: "meta",
    enabled: true,
  };
}

describe("validateToolMetadata — happy paths", () => {
  it("accepts a valid read tool", () => {
    expect(validateToolMetadata("listFoo", validReadFixture())).toEqual([]);
  });

  it("accepts a valid write tool with enrichUrl", () => {
    expect(validateToolMetadata("createFoo", validWriteFixture())).toEqual([]);
  });

  it("accepts a valid meta tool with empty scopes", () => {
    expect(validateToolMetadata("todoWrite", validMetaFixture())).toEqual([]);
  });

  it("UNKNOWN_TOOL_METADATA itself is structurally valid", () => {
    expect(validateToolMetadata("unknown", UNKNOWN_TOOL_METADATA)).toEqual([]);
  });
});

describe("validateToolMetadata — title and description", () => {
  it("rejects empty title", () => {
    const m = { ...validReadFixture(), title: "  " };
    const issues = validateToolMetadata("foo", m);
    expect(issues).toContain("foo.title is empty");
  });

  it("rejects description shorter than MIN_DESCRIPTION_CHARS", () => {
    const m = { ...validReadFixture(), description: "太短了" };
    const issues = validateToolMetadata("foo", m);
    expect(issues.some((s) => s.includes("description.length=3"))).toBe(true);
    expect(issues.some((s) => s.includes(`>= ${MIN_DESCRIPTION_CHARS}`))).toBe(true);
  });
});

describe("validateToolMetadata — type ↔ annotations invariants", () => {
  it("rejects type=read with readOnly=false", () => {
    const m: ToolMetadata = {
      ...validReadFixture(),
      annotations: { readOnly: false, destructive: false, idempotent: true },
    };
    const issues = validateToolMetadata("foo", m);
    expect(issues).toContain("foo.type=read requires annotations.readOnly === true");
  });

  it("rejects type=read with destructive=true", () => {
    const m: ToolMetadata = {
      ...validReadFixture(),
      annotations: { readOnly: true, destructive: true, idempotent: true },
    };
    const issues = validateToolMetadata("foo", m);
    expect(issues).toContain("foo.type=read requires annotations.destructive === false");
  });

  it("rejects type=draft with readOnly=false", () => {
    const m: ToolMetadata = {
      ...validReadFixture(),
      type: "draft",
      requiredScopes: [],
      annotations: { readOnly: false, destructive: false, idempotent: false },
    };
    const issues = validateToolMetadata("foo", m);
    expect(issues).toContain("foo.type=draft requires annotations.readOnly === true");
  });

  it("rejects type=meta with non-empty requiredScopes", () => {
    const m: ToolMetadata = {
      ...validMetaFixture(),
      requiredScopes: ["meta:rw"],
    };
    const issues = validateToolMetadata("foo", m);
    expect(issues).toContain("foo.type=meta requires requiredScopes === []");
  });

  it("rejects type=meta with readOnly=false", () => {
    const m: ToolMetadata = {
      ...validMetaFixture(),
      annotations: { readOnly: false, destructive: false, idempotent: false },
    };
    const issues = validateToolMetadata("foo", m);
    expect(issues).toContain("foo.type=meta requires annotations.readOnly === true");
  });

  it("rejects unknown type via cast", () => {
    const m = {
      ...validReadFixture(),
      type: "wrong" as unknown as ToolMetadata["type"],
    };
    const issues = validateToolMetadata("foo", m);
    expect(issues.some((s) => s.includes('type="wrong"'))).toBe(true);
  });
});

describe("validateToolMetadata — enrichUrl placeholder", () => {
  it("accepts undefined enrichUrl", () => {
    const m = validReadFixture();
    expect(m.enrichUrl).toBeUndefined();
    expect(validateToolMetadata("foo", m)).toEqual([]);
  });

  it("rejects static enrichUrl without placeholder", () => {
    const m: ToolMetadata = {
      ...validWriteFixture(),
      enrichUrl: "/notebooks/all",
    };
    const issues = validateToolMetadata("foo", m);
    expect(issues.some((s) => s.includes("lacks {key} placeholder"))).toBe(true);
  });

  it("ENRICH_URL_PLACEHOLDER_RE matches valid placeholders", () => {
    expect(ENRICH_URL_PLACEHOLDER_RE.test("/foo/{id}")).toBe(true);
    expect(ENRICH_URL_PLACEHOLDER_RE.test("/foo/{shortId}")).toBe(true);
    expect(ENRICH_URL_PLACEHOLDER_RE.test("/foo/{user_id}")).toBe(true);
    expect(ENRICH_URL_PLACEHOLDER_RE.test("/foo/{1invalid}")).toBe(false);
    expect(ENRICH_URL_PLACEHOLDER_RE.test("/foo/all")).toBe(false);
  });
});

describe("validateToolMetadata — defensive runtime checks (cast attacks)", () => {
  it("rejects non-boolean readOnly even when TS would allow via cast", () => {
    const m = {
      ...validReadFixture(),
      annotations: { readOnly: "yes" as unknown as boolean, destructive: false, idempotent: true },
    };
    const issues = validateToolMetadata("foo", m);
    expect(issues.some((s) => s.includes("annotations.readOnly must be boolean"))).toBe(true);
  });

  it("rejects empty-string requiredScopes element", () => {
    const m: ToolMetadata = {
      ...validReadFixture(),
      requiredScopes: ["study:read", ""],
    };
    const issues = validateToolMetadata("foo", m);
    expect(issues.some((s) => s.includes("requiredScopes[1] must be non-empty string"))).toBe(true);
  });
});

describe("constants", () => {
  it("TOOL_TYPES has exactly 4 entries", () => {
    expect(TOOL_TYPES).toEqual(["read", "write", "draft", "meta"]);
  });

  it("MIN_DESCRIPTION_CHARS is 120", () => {
    expect(MIN_DESCRIPTION_CHARS).toBe(120);
  });
});

// ---------------- Wave B 完成后的 K-METADATA-01..08 全套 (T11 enables this) ----------------

import { buildAssistantTools, buildAssistantToolMetadata } from "../tools";

const REAL_CTX: AssistantToolContext = { ownerUserId: "test_owner_user_id" };

describe("K-METADATA-01..08 — real Morris manifest", () => {
  const tools = buildAssistantTools(REAL_CTX);
  const manifest = buildAssistantToolMetadata(REAL_CTX);

  it("K-METADATA-01: tools and manifest have identical keys", () => {
    expect(Object.keys(tools).sort()).toEqual(Object.keys(manifest).sort());
  });

  it.each(Object.entries(manifest))(
    "K-METADATA-02..08: %s metadata is well-formed",
    (name, m) => {
      const issues = validateToolMetadata(name, m);
      expect(issues, `metadata issues for ${name}: ${issues.join("; ")}`).toEqual([]);
    },
  );

  it("K-METADATA-02: every description >= MIN_DESCRIPTION_CHARS", () => {
    for (const [name, m] of Object.entries(manifest)) {
      expect(m.description.length, `description too short for ${name}`)
        .toBeGreaterThanOrEqual(MIN_DESCRIPTION_CHARS);
    }
  });

  it("manifest covers 8 expected Morris tools", () => {
    expect(Object.keys(manifest).sort()).toEqual([
      "analyzeData",
      "createNotebook",
      "createStudyDraft",
      "listStudies",
      "manageMemories",
      "searchAcrossStudies",
      "searchInterviewData",
      "todoWrite",
    ]);
  });
});

// ============================================================
// K-METADATA-09 — TOOL_ENRICH_URLS 镜像与 manifest 一致 (Wave E T24)
// ============================================================

import { TOOL_ENRICH_URLS } from "../tool-enrich-urls";

describe("K-METADATA-09 — TOOL_ENRICH_URLS mirrors manifest.enrichUrl", () => {
  const manifest = buildAssistantToolMetadata(REAL_CTX);

  it("every manifest tool appears in TOOL_ENRICH_URLS", () => {
    for (const name of Object.keys(manifest)) {
      expect(TOOL_ENRICH_URLS, `TOOL_ENRICH_URLS missing tool: ${name}`).toHaveProperty(name);
    }
  });

  it("every TOOL_ENRICH_URLS tool appears in manifest (no orphans)", () => {
    for (const name of Object.keys(TOOL_ENRICH_URLS)) {
      expect(manifest, `TOOL_ENRICH_URLS has orphan tool not in manifest: ${name}`).toHaveProperty(name);
    }
  });

  it("enrichUrl values are byte-equal between manifest and TOOL_ENRICH_URLS", () => {
    for (const [name, m] of Object.entries(manifest)) {
      expect(
        TOOL_ENRICH_URLS[name],
        `TOOL_ENRICH_URLS[${name}] drifted from manifest.enrichUrl`,
      ).toBe(m.enrichUrl);
    }
  });
});

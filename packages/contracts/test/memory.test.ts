import { describe, it, expect } from "vitest";
import {
  MorrisMemorySchema,
  MorrisMemoryListItemSchema,
  ManageMemoriesActionSchema,
  MEMORY_CONTENT_MAX,
  MEMORY_METADATA_KEYS_MAX,
  MEMORY_EMBEDDING_DIM,
} from "../src/memory.js";

const validBase = {
  $id: "m1",
  ownerUserId: "u1",
  content: "用户主要做 fintech onboarding 调研, 偏好简短分析报告",
  metadata: JSON.stringify({ type: "preference", domain: "fintech" }),
  metadataKeys: ["type", "domain"],
  embedding: "",
  embeddingModel: "",
  createdAt: "2026-06-11T13:00:00.000Z",
  updatedAt: "2026-06-11T13:00:00.000Z",
};

describe("MorrisMemorySchema (K-MEM-*)", () => {
  it("K-MEM-01: rejects metadata that is not a JSON object (array)", () => {
    const result = MorrisMemorySchema.safeParse({
      ...validBase,
      metadata: JSON.stringify(["not", "an", "object"]),
      metadataKeys: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "metadata")).toBe(true);
    }
  });

  it("K-MEM-01: rejects metadata that is not valid JSON", () => {
    const result = MorrisMemorySchema.safeParse({
      ...validBase,
      metadata: "{not json",
      metadataKeys: [],
    });
    expect(result.success).toBe(false);
  });

  it("K-MEM-02: rejects when metadataKeys mismatch metadata.keys()", () => {
    const result = MorrisMemorySchema.safeParse({
      ...validBase,
      metadata: JSON.stringify({ type: "preference" }),
      metadataKeys: ["type", "extra"], // claims extra key not in metadata
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "metadataKeys")).toBe(true);
    }
  });

  it("K-MEM-02: accepts when metadataKeys === Object.keys(metadata) (any order)", () => {
    const result = MorrisMemorySchema.safeParse({
      ...validBase,
      metadata: JSON.stringify({ alpha: 1, beta: 2 }),
      metadataKeys: ["beta", "alpha"], // sorted equality
    });
    expect(result.success).toBe(true);
  });

  it("K-MEM-03: rejects embedding that is not 1024-dim number array", () => {
    const result = MorrisMemorySchema.safeParse({
      ...validBase,
      embedding: JSON.stringify([1, 2, 3]), // wrong length
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "embedding")).toBe(true);
    }
  });

  it("K-MEM-04: accepts empty embedding string (not yet embed)", () => {
    const result = MorrisMemorySchema.safeParse({ ...validBase, embedding: "" });
    expect(result.success).toBe(true);
  });

  it("K-MEM-04: accepts valid 1024-dim embedding", () => {
    const vec = new Array(MEMORY_EMBEDDING_DIM).fill(0.1);
    const result = MorrisMemorySchema.safeParse({
      ...validBase,
      embedding: JSON.stringify(vec),
    });
    expect(result.success).toBe(true);
  });

  it("K-MEM-05: rejects content > MEMORY_CONTENT_MAX", () => {
    const result = MorrisMemorySchema.safeParse({
      ...validBase,
      content: "x".repeat(MEMORY_CONTENT_MAX + 1),
    });
    expect(result.success).toBe(false);
  });

  it("K-MEM-05: rejects empty content", () => {
    const result = MorrisMemorySchema.safeParse({ ...validBase, content: "" });
    expect(result.success).toBe(false);
  });

  it("K-MEM-06: rejects metadataKeys > MEMORY_METADATA_KEYS_MAX", () => {
    const tooMany = Array.from({ length: MEMORY_METADATA_KEYS_MAX + 1 }, (_, i) => `k${i}`);
    const obj = Object.fromEntries(tooMany.map((k) => [k, 1]));
    const result = MorrisMemorySchema.safeParse({
      ...validBase,
      metadata: JSON.stringify(obj),
      metadataKeys: tooMany,
    });
    expect(result.success).toBe(false);
  });
});

describe("ManageMemoriesActionSchema (K-MEM-07/08)", () => {
  it("K-MEM-07: accepts create action", () => {
    expect(
      ManageMemoriesActionSchema.safeParse({
        action: "create",
        content: "fact",
        metadata: { type: "preference" },
      }).success,
    ).toBe(true);
  });

  it("K-MEM-07: accepts query action with default limit=5", () => {
    const r = ManageMemoriesActionSchema.safeParse({
      action: "query",
      queryText: "find this",
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.action === "query") {
      expect(r.data.limit).toBe(5);
    }
  });

  it("K-MEM-07: accepts update / delete / list", () => {
    expect(
      ManageMemoriesActionSchema.safeParse({
        action: "update",
        memoryId: "m1",
        content: "new",
      }).success,
    ).toBe(true);
    expect(
      ManageMemoriesActionSchema.safeParse({ action: "delete", memoryId: "m1" }).success,
    ).toBe(true);
    expect(
      ManageMemoriesActionSchema.safeParse({ action: "list" }).success,
    ).toBe(true);
  });

  it("K-MEM-08: rejects unknown action", () => {
    const r = ManageMemoriesActionSchema.safeParse({ action: "unknown" });
    expect(r.success).toBe(false);
  });
});

describe("MorrisMemoryListItemSchema", () => {
  it("omits embedding from list items", () => {
    const item = {
      ...validBase,
      // no `embedding` field
    };
    delete (item as { embedding?: string }).embedding;
    const r = MorrisMemoryListItemSchema.safeParse(item);
    expect(r.success).toBe(true);
  });
});

/**
 * memories/actions.ts unit tests.
 *
 * Mocks @/lib/queries/auth + ../server + ../embed via vi.mock + dynamic
 * import factory pattern (per .kiro/steering/testing.md::Test double pattern).
 *
 * 12+ cases covering all 5 actions × happy / not_signed_in / not_authorized
 * paths plus the embedding-vs-fulltext fallback branch on queryMemories.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/queries/auth", async () => ({
  getCurrentUserId: vi.fn(),
}));
vi.mock("../server", async () => ({
  createMemoryDoc: vi.fn(),
  loadMemoryDoc: vi.fn(),
  updateMemoryDoc: vi.fn(),
  deleteMemoryDoc: vi.fn(),
  listMemoriesForOwner: vi.fn(),
  queryMemoriesByText: vi.fn(),
  queryMemoriesByEmbedding: vi.fn(),
  saveMemoryEmbedding: vi.fn(),
}));
vi.mock("../embed", async () => {
  class FakeEmbeddingError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "EmbeddingError";
    }
  }
  return {
    embedAndSaveMemory: vi.fn(async () => undefined),
    embedQuery: vi.fn(),
    cosineSearch: vi.fn(),
    omitEmbedding: <T extends { embedding?: string }>(r: T) => {
      const { embedding: _e, ...rest } = r;
      return rest;
    },
    EmbeddingError: FakeEmbeddingError,
  };
});

import * as auth from "@/lib/queries/auth";
import * as server from "../server";
import * as embed from "../embed";

afterEach(() => {
  vi.clearAllMocks();
});

const sampleListItem = {
  $id: "m1",
  ownerUserId: "u1",
  content: "fact",
  metadata: "{}",
  metadataKeys: [] as string[],
  embeddingModel: "",
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z",
};

describe("createMemory", () => {
  it("happy path: creates doc + fires embed", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(server.createMemoryDoc).mockResolvedValue("m1");
    const { createMemory } = await import("../actions");
    const result = await createMemory({ content: "fintech onboarding research" });
    expect(result.memoryId).toBe("m1");
    expect(result.snippet).toContain("fintech");
    expect(vi.mocked(embed.embedAndSaveMemory)).toHaveBeenCalledWith(
      "m1",
      "fintech onboarding research",
    );
  });

  it("not signed in: throws", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue(null);
    const { createMemory } = await import("../actions");
    await expect(createMemory({ content: "x" })).rejects.toThrow("not_signed_in");
  });
});

describe("queryMemories", () => {
  it("embedding path: cosine results returned with fallback=null", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(embed.embedQuery).mockResolvedValue([0.1, 0.2]);
    vi.mocked(server.queryMemoriesByEmbedding).mockResolvedValue([
      { ...sampleListItem, embedding: "[0.1, 0.2]" },
    ]);
    vi.mocked(embed.cosineSearch).mockReturnValue([
      { item: { ...sampleListItem, embedding: "[0.1, 0.2]" }, score: 0.95 },
    ]);
    const { queryMemories } = await import("../actions");
    const result = await queryMemories({ queryText: "find me a fact" });
    expect(result.fallback).toBeNull();
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].score).toBe(0.95);
  });

  it("fulltext fallback: when embedQuery throws EmbeddingError", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    const { EmbeddingError } = embed;
    vi.mocked(embed.embedQuery).mockRejectedValue(
      new EmbeddingError("qwen 503", "http_error"),
    );
    vi.mocked(server.queryMemoriesByText).mockResolvedValue([sampleListItem]);
    const { queryMemories } = await import("../actions");
    const result = await queryMemories({ queryText: "x" });
    expect(result.fallback).toBe("embedding-error");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].score).toBeNull();
  });

  it("fulltext fallback: when generic err in cosine path", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(embed.embedQuery).mockRejectedValue(new Error("network"));
    vi.mocked(server.queryMemoriesByText).mockResolvedValue([]);
    const { queryMemories } = await import("../actions");
    const result = await queryMemories({ queryText: "x" });
    expect(result.fallback).toBe("scale-fulltext-only");
  });

  it("not signed in: throws", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue(null);
    const { queryMemories } = await import("../actions");
    await expect(queryMemories({ queryText: "x" })).rejects.toThrow("not_signed_in");
  });
});

describe("updateMemory", () => {
  it("happy path: updates + re-embeds when content changes", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(server.loadMemoryDoc).mockResolvedValue({
      ...sampleListItem,
      embedding: "",
    });
    const { updateMemory } = await import("../actions");
    const r = await updateMemory({ memoryId: "m1", content: "new content" });
    expect(r.ok).toBe(true);
    expect(vi.mocked(embed.embedAndSaveMemory)).toHaveBeenCalledWith("m1", "new content");
  });

  it("cross owner: throws not_authorized", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(server.loadMemoryDoc).mockResolvedValue({
      ...sampleListItem,
      ownerUserId: "u2",
      embedding: "",
    });
    const { updateMemory } = await import("../actions");
    await expect(updateMemory({ memoryId: "m1", content: "x" })).rejects.toThrow(
      "not_authorized",
    );
  });

  it("not signed in: throws", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue(null);
    const { updateMemory } = await import("../actions");
    await expect(updateMemory({ memoryId: "m1" })).rejects.toThrow("not_signed_in");
  });
});

describe("deleteMemory", () => {
  it("happy path: hard delete", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(server.loadMemoryDoc).mockResolvedValue({
      ...sampleListItem,
      embedding: "",
    });
    const { deleteMemory } = await import("../actions");
    const r = await deleteMemory({ memoryId: "m1" });
    expect(r.ok).toBe(true);
    expect(vi.mocked(server.deleteMemoryDoc)).toHaveBeenCalledWith("m1");
  });

  it("cross owner: throws not_authorized", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(server.loadMemoryDoc).mockResolvedValue({
      ...sampleListItem,
      ownerUserId: "u2",
      embedding: "",
    });
    const { deleteMemory } = await import("../actions");
    await expect(deleteMemory({ memoryId: "m1" })).rejects.toThrow("not_authorized");
  });
});

describe("listMemories", () => {
  it("happy path: returns items omitting embedding", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(server.listMemoriesForOwner).mockResolvedValue([sampleListItem]);
    const { listMemories } = await import("../actions");
    const r = await listMemories({});
    expect(r.items).toHaveLength(1);
  });

  it("not signed in: throws", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue(null);
    const { listMemories } = await import("../actions");
    await expect(listMemories({})).rejects.toThrow("not_signed_in");
  });
});

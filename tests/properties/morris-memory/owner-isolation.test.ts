/**
 * P-MEM-02: Owner isolation invariant — actions guard cross-owner access.
 *
 * Mocks @/lib/queries/auth + ../server + ../embed; verifies that any random
 * (currentUser, ownerOfDoc) where they differ leads to not_authorized on
 * update/delete. listMemoriesForOwner / queryMemoriesByEmbedding receive
 * ownerUserId from the action so isolation is server.ts's responsibility —
 * we test that actions.ts always passes the *current user's* ownerUserId,
 * never an attacker-supplied id.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as fc from "fast-check";

vi.mock("@/lib/queries/auth", async () => ({
  getCurrentUserId: vi.fn(),
}));
vi.mock("@/lib/memories/server", async () => ({
  createMemoryDoc: vi.fn(),
  loadMemoryDoc: vi.fn(),
  updateMemoryDoc: vi.fn(),
  deleteMemoryDoc: vi.fn(),
  listMemoriesForOwner: vi.fn(),
  queryMemoriesByText: vi.fn(),
  queryMemoriesByEmbedding: vi.fn(),
  saveMemoryEmbedding: vi.fn(),
}));
vi.mock("@/lib/memories/embed", async () => ({
  embedAndSaveMemory: vi.fn(async () => undefined),
  embedQuery: vi.fn(),
  cosineSearch: vi.fn(() => []),
  omitEmbedding: <T extends { embedding?: string }>(r: T) => {
    const { embedding: _e, ...rest } = r;
    return rest;
  },
  EmbeddingError: class extends Error {},
}));

afterEach(() => {
  vi.clearAllMocks();
});

const baseDoc = {
  $id: "m1",
  content: "fact",
  metadata: "{}",
  metadataKeys: [] as string[],
  embedding: "",
  embeddingModel: "",
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z",
};

describe("P-MEM-02: owner isolation invariant", () => {
  it("updateMemory throws not_authorized when current user != ownerUserId", async () => {
    const { updateMemory } = await import("@/lib/memories/actions");
    const auth = await import("@/lib/queries/auth");
    const server = await import("@/lib/memories/server");

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 24 }),
        async (currentUser, ownerOfDoc, memId) => {
          if (currentUser === ownerOfDoc) return; // skip same-owner
          vi.mocked(auth.getCurrentUserId).mockResolvedValue(currentUser);
          vi.mocked(server.loadMemoryDoc).mockResolvedValue({
            ...baseDoc,
            $id: memId,
            ownerUserId: ownerOfDoc,
          });
          await expect(
            updateMemory({ memoryId: memId, content: "x" }),
          ).rejects.toThrow("not_authorized");
        },
      ),
      { numRuns: 30 },
    );
  });

  it("deleteMemory throws not_authorized when current user != ownerUserId", async () => {
    const { deleteMemory } = await import("@/lib/memories/actions");
    const auth = await import("@/lib/queries/auth");
    const server = await import("@/lib/memories/server");

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 24 }),
        async (currentUser, ownerOfDoc, memId) => {
          if (currentUser === ownerOfDoc) return;
          vi.mocked(auth.getCurrentUserId).mockResolvedValue(currentUser);
          vi.mocked(server.loadMemoryDoc).mockResolvedValue({
            ...baseDoc,
            $id: memId,
            ownerUserId: ownerOfDoc,
          });
          await expect(deleteMemory({ memoryId: memId })).rejects.toThrow(
            "not_authorized",
          );
        },
      ),
      { numRuns: 30 },
    );
  });

  it("listMemories never reads memories tagged to a different owner — passes the current user's id", async () => {
    const { listMemories } = await import("@/lib/memories/actions");
    const auth = await import("@/lib/queries/auth");
    const server = await import("@/lib/memories/server");

    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 16 }), async (uid) => {
        vi.mocked(auth.getCurrentUserId).mockResolvedValue(uid);
        vi.mocked(server.listMemoriesForOwner).mockResolvedValue([]);
        await listMemories({});
        expect(vi.mocked(server.listMemoriesForOwner)).toHaveBeenCalledWith(
          uid,
          expect.anything(),
        );
      }),
      { numRuns: 30 },
    );
  });
});

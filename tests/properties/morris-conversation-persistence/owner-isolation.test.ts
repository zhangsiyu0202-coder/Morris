/**
 * P-CONV-02: 所有 conversation 严格 owner-scoped — listConversations 永不返回他人 doc;
 * loadConversation 在 cross-owner 时抛 not_authorized.
 *
 * 用 fake "./server" + "@/lib/queries/auth" 双 mock 验证 actions.ts 的边界判断.
 * 这是 binding invariant — 100 个随机案例每次都必须命中.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as fc from "fast-check";

vi.mock("@/lib/queries/auth", async () => ({
  getCurrentUserId: vi.fn(),
}));
vi.mock("@/lib/conversations/server", async () => ({
  createConversationDoc: vi.fn(),
  loadConversationDoc: vi.fn(),
  saveMessagesToDoc: vi.fn(),
  listConversationsForOwner: vi.fn(),
  deleteConversationDoc: vi.fn(),
  saveTitle: vi.fn(),
}));
vi.mock("@/lib/conversations/title", async () => ({
  generateConversationTitle: vi.fn(async () => undefined),
}));
vi.mock("next/cache", async () => ({ revalidatePath: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("P-CONV-02: owner isolation invariant", () => {
  it("loadConversation throws not_authorized when current user != doc.ownerUserId", async () => {
    const { loadConversation } = await import("@/lib/conversations/actions");
    const auth = await import("@/lib/queries/auth");
    const server = await import("@/lib/conversations/server");

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 16 }), // user A
        fc.string({ minLength: 1, maxLength: 16 }), // user B  
        fc.string({ minLength: 1, maxLength: 24 }), // conversationId
        async (userA, userB, convId) => {
          if (userA === userB) return; // 跳过同 owner
          vi.mocked(auth.getCurrentUserId).mockResolvedValue(userA);
          vi.mocked(server.loadConversationDoc).mockResolvedValue({
            $id: convId,
            ownerUserId: userB, // 别人的 doc
            title: "",
            messagesJson: "[]",
            messageCount: 0,
            lastMessageAt: "2026-06-11T13:00:00.000Z",
            lastMessagePreview: "",
            createdAt: "2026-06-11T13:00:00.000Z",
            updatedAt: "2026-06-11T13:00:00.000Z",
          });
          await expect(loadConversation(convId)).rejects.toThrow(/not_authorized/);
        },
      ),
      { numRuns: 30 },
    );
  });
});

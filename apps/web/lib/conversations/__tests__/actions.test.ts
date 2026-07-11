/**
 * Morris Conversation Server Actions tests
 * (per `.kiro/specs/morris-conversation-persistence/design.md` §5 + §9 Layer 1).
 *
 * 13 用例覆盖:
 *  - createConversation: signed in / not signed in
 *  - saveMessages:       signed in / not signed in / not authorized / triggers title (1st msg)
 *  - listConversations:  signed in / empty list
 *  - loadConversation:   not found returns null / cross-owner throws not_authorized
 *  - deleteConversation: signed in / not authorized
 *  - title fire-and-forget 不报错 (saveMessages 内部 .catch 兜底)
 *
 * Mock 策略 (testing.md::Test double pattern §3 阶梯 3):
 * 模块级 vi.mock + async factory + dynamic import — 让 actions.ts 静态 import
 * 的 server-only deps (auth / server.ts / title.ts / next/cache) 解析到 spy.
 * 风格参考 apps/web/lib/assistant/__tests__/metadata.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// async + dynamic import 绕过 vitest hoisting (factory 必须 named export 才能
// 被 hoist; named import 会撞 __vi_import__ before initialization).
vi.mock("@/lib/queries/auth", async () => ({
  getCurrentUserId: vi.fn(),
}));
vi.mock("../server", async () => ({
  createConversationDoc: vi.fn(),
  loadConversationDoc: vi.fn(),
  saveMessagesToDoc: vi.fn(),
  listConversationsForOwner: vi.fn(),
  deleteConversationDoc: vi.fn(),
  saveTitle: vi.fn(),
}));
vi.mock("../title", async () => ({
  generateConversationTitle: vi.fn(),
}));
vi.mock("next/cache", async () => ({
  revalidatePath: vi.fn(),
}));

import * as auth from "@/lib/queries/auth";
import * as server from "../server";
import * as title from "../title";
import {
  createConversation,
  deleteConversation,
  listConversations,
  loadConversation,
  saveMessages,
} from "../actions";

const mockGetCurrentUserId = vi.mocked(auth.getCurrentUserId);
const mockCreateDoc = vi.mocked(server.createConversationDoc);
const mockLoadDoc = vi.mocked(server.loadConversationDoc);
const mockSaveMsgsDoc = vi.mocked(server.saveMessagesToDoc);
const mockListForOwner = vi.mocked(server.listConversationsForOwner);
const mockDeleteDoc = vi.mocked(server.deleteConversationDoc);
const mockGenTitle = vi.mocked(title.generateConversationTitle);

beforeEach(() => {
  mockGetCurrentUserId.mockReset();
  mockCreateDoc.mockReset();
  mockLoadDoc.mockReset();
  mockSaveMsgsDoc.mockReset();
  mockListForOwner.mockReset();
  mockDeleteDoc.mockReset();
  mockGenTitle.mockReset();
});

/** Helper — 构造一个最小 Conversation doc fixture. */
function fixtureDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    $id: "conv-1",
    ownerUserId: "user-1",
    title: "",
    messagesJson: "[]",
    messageCount: 0,
    lastMessageAt: "2026-06-11T00:00:00.000Z",
    lastMessagePreview: "",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    ...overrides,
  } as never;
}

describe("createConversation", () => {
  it("signed in: creates doc and returns conversationId", async () => {
    mockGetCurrentUserId.mockResolvedValue("user-1");
    mockCreateDoc.mockResolvedValue("conv-new");

    const result = await createConversation();

    expect(result).toEqual({ conversationId: "conv-new" });
    expect(mockCreateDoc).toHaveBeenCalledWith({ ownerUserId: "user-1" });
  });

  it("not signed in: throws not_signed_in", async () => {
    mockGetCurrentUserId.mockResolvedValue(null);

    await expect(createConversation()).rejects.toThrow("not_signed_in");
    expect(mockCreateDoc).not.toHaveBeenCalled();
  });
});

describe("saveMessages", () => {
  it("signed in + owner match: persists messages", async () => {
    mockGetCurrentUserId.mockResolvedValue("user-1");
    mockLoadDoc.mockResolvedValue(
      fixtureDoc({ title: "已有标题", messageCount: 3 }),
    );
    mockSaveMsgsDoc.mockResolvedValue();

    const messages = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      { role: "assistant", parts: [{ type: "text", text: "hello" }] },
      { role: "user", parts: [{ type: "text", text: "thanks" }] },
    ];
    const result = await saveMessages("conv-1", messages);

    expect(result).toEqual({ ok: true });
    expect(mockSaveMsgsDoc).toHaveBeenCalledWith("conv-1", messages);
    // title 已经存在 → 不应触发 generator
    expect(mockGenTitle).not.toHaveBeenCalled();
  });

  it("not signed in: throws not_signed_in", async () => {
    mockGetCurrentUserId.mockResolvedValue(null);

    await expect(saveMessages("conv-1", [])).rejects.toThrow("not_signed_in");
    expect(mockLoadDoc).not.toHaveBeenCalled();
    expect(mockSaveMsgsDoc).not.toHaveBeenCalled();
  });

  it("cross-owner: throws not_authorized", async () => {
    mockGetCurrentUserId.mockResolvedValue("user-attacker");
    mockLoadDoc.mockResolvedValue(fixtureDoc({ ownerUserId: "user-victim" }));

    await expect(saveMessages("conv-1", [])).rejects.toThrow("not_authorized");
    expect(mockSaveMsgsDoc).not.toHaveBeenCalled();
  });

  it("triggers title generation when first message saved (no title yet)", async () => {
    mockGetCurrentUserId.mockResolvedValue("user-1");
    mockLoadDoc.mockResolvedValue(
      fixtureDoc({ title: "", messageCount: 0 }),
    );
    mockSaveMsgsDoc.mockResolvedValue();
    mockGenTitle.mockResolvedValue();

    const firstMsg = { role: "user", parts: [{ type: "text", text: "请帮我分析数据" }] };
    await saveMessages("conv-1", [firstMsg]);

    // saveMessagesToDoc 同步 await; generateConversationTitle fire-and-forget
    // 但 mock 是 sync resolved promise, microtask 落地在 await chain 上.
    expect(mockSaveMsgsDoc).toHaveBeenCalledWith("conv-1", [firstMsg]);
    expect(mockGenTitle).toHaveBeenCalledWith("conv-1", firstMsg);
  });
});

describe("listConversations", () => {
  it("signed in: returns owner's conversations sorted by recency", async () => {
    mockGetCurrentUserId.mockResolvedValue("user-1");
    const items = [
      {
        $id: "conv-2",
        ownerUserId: "user-1",
        title: "新分析",
        messageCount: 4,
        lastMessageAt: "2026-06-11T03:00:00.000Z",
        lastMessagePreview: "...",
        createdAt: "2026-06-11T01:00:00.000Z",
        updatedAt: "2026-06-11T03:00:00.000Z",
      },
    ] as never;
    mockListForOwner.mockResolvedValue(items);

    const result = await listConversations();

    expect(result).toBe(items);
    expect(mockListForOwner).toHaveBeenCalledWith("user-1", { limit: 50 });
  });

  it("returns empty list when owner has no conversations", async () => {
    mockGetCurrentUserId.mockResolvedValue("user-1");
    mockListForOwner.mockResolvedValue([]);

    const result = await listConversations();

    expect(result).toEqual([]);
  });
});

describe("loadConversation", () => {
  it("returns null when conversation not found", async () => {
    mockGetCurrentUserId.mockResolvedValue("user-1");
    mockLoadDoc.mockResolvedValue(null);

    const result = await loadConversation("missing-id");

    expect(result).toBeNull();
  });

  it("cross-owner: throws not_authorized", async () => {
    mockGetCurrentUserId.mockResolvedValue("user-attacker");
    mockLoadDoc.mockResolvedValue(fixtureDoc({ ownerUserId: "user-victim" }));

    await expect(loadConversation("conv-1")).rejects.toThrow("not_authorized");
  });
});

describe("deleteConversation", () => {
  it("signed in + owner match: deletes doc", async () => {
    mockGetCurrentUserId.mockResolvedValue("user-1");
    mockLoadDoc.mockResolvedValue(fixtureDoc());
    mockDeleteDoc.mockResolvedValue();

    const result = await deleteConversation("conv-1");

    expect(result).toEqual({ ok: true });
    expect(mockDeleteDoc).toHaveBeenCalledWith("conv-1");
  });

  it("cross-owner: throws not_authorized and does not delete", async () => {
    mockGetCurrentUserId.mockResolvedValue("user-attacker");
    mockLoadDoc.mockResolvedValue(fixtureDoc({ ownerUserId: "user-victim" }));

    await expect(deleteConversation("conv-1")).rejects.toThrow("not_authorized");
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });
});

describe("saveMessages — title fire-and-forget 不报错", () => {
  it("title generator throws → saveMessages still resolves ok", async () => {
    mockGetCurrentUserId.mockResolvedValue("user-1");
    mockLoadDoc.mockResolvedValue(fixtureDoc({ title: "", messageCount: 0 }));
    mockSaveMsgsDoc.mockResolvedValue();
    mockGenTitle.mockRejectedValue(new Error("deepseek_down"));

    const firstMsg = { role: "user", parts: [{ type: "text", text: "hi" }] };
    // 关键: title 失败不应让外层 await 抛
    await expect(saveMessages("conv-1", [firstMsg])).resolves.toEqual({ ok: true });
    // 让 fire-and-forget catch 微任务跑完
    await new Promise((r) => setImmediate(r));
    expect(mockGenTitle).toHaveBeenCalled();
  });
});

/**
 * submitFeedback Server Action — observability-only path. We don't mock the
 * logger; we mock the auth boundary and verify input-shape rejection plus
 * the not_signed_in / happy paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/queries/auth", async () => ({
  getCurrentUserId: vi.fn(),
}));
vi.mock("../server", async () => ({
  loadConversationDoc: vi.fn(),
}));

import * as auth from "@/lib/queries/auth";
import * as server from "../server";

const validDoc = {
  $id: "c1",
  ownerUserId: "u1",
  title: "",
  messagesJson: "[]",
  messageCount: 1,
  lastMessageAt: "2026-06-11T00:00:00.000Z",
  lastMessagePreview: "",
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("submitFeedback", () => {
  it("happy path: rating='up' returns ok", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(server.loadConversationDoc).mockResolvedValue(validDoc);
    const { submitFeedback } = await import("../feedback");
    const r = await submitFeedback({
      conversationId: "c1",
      messageId: "m1",
      rating: "up",
    });
    expect(r.ok).toBe(true);
  });

  it("happy path: rating='down' with feedbackText", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(server.loadConversationDoc).mockResolvedValue(validDoc);
    const { submitFeedback } = await import("../feedback");
    const r = await submitFeedback({
      conversationId: "c1",
      messageId: "m1",
      rating: "down",
      feedbackText: "missed the citation",
    });
    expect(r.ok).toBe(true);
  });

  it("ownership check: cross-owner conversationId throws not_authorized", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("attacker");
    vi.mocked(server.loadConversationDoc).mockResolvedValue({
      ...validDoc,
      ownerUserId: "victim",
    });
    const { submitFeedback } = await import("../feedback");
    await expect(
      submitFeedback({ conversationId: "c1", messageId: "m1", rating: "up" }),
    ).rejects.toThrow("not_authorized");
  });

  it("conversation not found: throws not_authorized (treat 404 as forbidden)", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(server.loadConversationDoc).mockResolvedValue(null);
    const { submitFeedback } = await import("../feedback");
    await expect(
      submitFeedback({ conversationId: "missing", messageId: "m1", rating: "up" }),
    ).rejects.toThrow("not_authorized");
  });

  it("not signed in: throws", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue(null);
    const { submitFeedback } = await import("../feedback");
    await expect(
      submitFeedback({ conversationId: "c1", messageId: "m1", rating: "up" }),
    ).rejects.toThrow("not_signed_in");
  });

  it("rejects unknown rating", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    const { submitFeedback } = await import("../feedback");
    await expect(
      submitFeedback({
        conversationId: "c1",
        messageId: "m1",
        // @ts-expect-error testing schema rejection of unknown rating
        rating: "maybe",
      }),
    ).rejects.toThrow(/invalid_input/);
  });

  it("rejects feedbackText > 2000 chars", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    const { submitFeedback } = await import("../feedback");
    await expect(
      submitFeedback({
        conversationId: "c1",
        messageId: "m1",
        rating: "down",
        feedbackText: "x".repeat(2001),
      }),
    ).rejects.toThrow(/invalid_input/);
  });

  it("rejects empty conversationId", async () => {
    vi.mocked(auth.getCurrentUserId).mockResolvedValue("u1");
    const { submitFeedback } = await import("../feedback");
    await expect(
      submitFeedback({ conversationId: "", messageId: "m1", rating: "up" }),
    ).rejects.toThrow(/invalid_input/);
  });
});

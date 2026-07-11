import { describe, it, expect } from "vitest";
import {
  ConversationSchema,
  ConversationListItemSchema,
  ConversationSaveMessagesRequestSchema,
  ConversationDeleteRequestSchema,
  ConversationCreateRequestSchema,
  MAX_MESSAGES_JSON_BYTES,
  MAX_TITLE_LENGTH,
  MAX_PREVIEW_LENGTH,
} from "@merism/contracts";

const T0 = "2026-06-11T00:00:00.000Z";

function buildValidConversation(overrides: Record<string, unknown> = {}) {
  return {
    $id: "conv1",
    ownerUserId: "user-1",
    title: "调研报告分析",
    messagesJson: JSON.stringify([{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }]),
    messageCount: 1,
    lastMessageAt: T0,
    lastMessagePreview: "hi",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

describe("contracts: ConversationSchema", () => {
  it("K-CONV-01: rejects messagesJson that is not valid JSON", () => {
    const bad = ConversationSchema.safeParse(
      buildValidConversation({ messagesJson: "not-a-json" }),
    );
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const msg = bad.error.issues.find((i) => i.path.includes("messagesJson"))?.message ?? "";
      expect(msg).toContain("not valid JSON");
    }
  });

  it("K-CONV-01b: rejects messagesJson that is JSON but not an array", () => {
    const bad = ConversationSchema.safeParse(
      buildValidConversation({ messagesJson: JSON.stringify({ not: "array" }), messageCount: 0 }),
    );
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const msg = bad.error.issues.find((i) => i.path.includes("messagesJson"))?.message ?? "";
      expect(msg).toContain("must be a JSON array");
    }
  });

  it("K-CONV-02: rejects messageCount mismatch with parsed messagesJson length", () => {
    const bad = ConversationSchema.safeParse(
      buildValidConversation({
        messagesJson: JSON.stringify([{ id: "m1" }, { id: "m2" }]),
        messageCount: 1, // wrong — should be 2
      }),
    );
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const issue = bad.error.issues.find((i) => i.path.includes("messageCount"));
      expect(issue?.message).toContain("mismatch");
    }
  });

  it("K-CONV-03: rejects messagesJson byte size exceeding MAX_MESSAGES_JSON_BYTES", () => {
    // Build a JSON string that exceeds 256KB without parsing through real UIMessages.
    const huge = "x".repeat(MAX_MESSAGES_JSON_BYTES + 100);
    const bad = ConversationSchema.safeParse(
      buildValidConversation({ messagesJson: huge, messageCount: 0 }),
    );
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const issue = bad.error.issues.find((i) => i.path.includes("messagesJson"));
      expect(issue?.message).toContain("exceeds");
    }
  });

  it("K-CONV-04: rejects title exceeding MAX_TITLE_LENGTH", () => {
    const bad = ConversationSchema.safeParse(
      buildValidConversation({ title: "x".repeat(MAX_TITLE_LENGTH + 1) }),
    );
    expect(bad.success).toBe(false);
  });

  it("K-CONV-05: rejects lastMessagePreview exceeding MAX_PREVIEW_LENGTH", () => {
    const bad = ConversationSchema.safeParse(
      buildValidConversation({ lastMessagePreview: "x".repeat(MAX_PREVIEW_LENGTH + 1) }),
    );
    expect(bad.success).toBe(false);
  });

  it("K-CONV-06: ConversationListItemSchema accepts the omit shape (no messagesJson)", () => {
    const listItem = {
      $id: "conv1",
      ownerUserId: "user-1",
      title: "",
      messageCount: 5,
      lastMessageAt: T0,
      lastMessagePreview: "snippet",
      createdAt: T0,
      updatedAt: T0,
    };
    const ok = ConversationListItemSchema.safeParse(listItem);
    expect(ok.success).toBe(true);
    // listing path must not require messagesJson
    expect((ok.success ? ok.data : null) && "messagesJson" in (ok.data as object)).toBe(false);
  });

  it("K-CONV-07: ConversationSaveMessagesRequestSchema enforces messages.max(500)", () => {
    const okShort = ConversationSaveMessagesRequestSchema.safeParse({
      conversationId: "conv1",
      messages: new Array(500).fill({ id: "m" }),
    });
    expect(okShort.success).toBe(true);
    const tooMany = ConversationSaveMessagesRequestSchema.safeParse({
      conversationId: "conv1",
      messages: new Array(501).fill({ id: "m" }),
    });
    expect(tooMany.success).toBe(false);
    const missingId = ConversationSaveMessagesRequestSchema.safeParse({
      conversationId: "",
      messages: [],
    });
    expect(missingId.success).toBe(false);
  });

  it("K-CONV-08: round-trip parse(stringify) is idempotent", () => {
    const valid = buildValidConversation();
    const once = ConversationSchema.parse(valid);
    // Re-feed parse output back through; since superRefine only inspects fields,
    // serializing & re-parsing through JSON keeps shape identical.
    const twice = ConversationSchema.parse(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it("ConversationCreateRequestSchema is strict empty object", () => {
    expect(ConversationCreateRequestSchema.safeParse({}).success).toBe(true);
    expect(
      ConversationCreateRequestSchema.safeParse({ extraField: "no" }).success,
    ).toBe(false);
  });

  it("ConversationDeleteRequestSchema requires non-empty conversationId", () => {
    expect(
      ConversationDeleteRequestSchema.safeParse({ conversationId: "conv1" }).success,
    ).toBe(true);
    expect(
      ConversationDeleteRequestSchema.safeParse({ conversationId: "" }).success,
    ).toBe(false);
  });
});

/**
 * P-CONV-01: messagesJson round-trip — 任意 UIMessage[] 序列化/反序列化等价
 * 且 ConversationSchema.parse 接受。
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ConversationSchema } from "@merism/contracts";

// 简化的 UIMessage shape (text-only parts) 让 fast-check 可控. 真实 UIMessage union
// 含 tool/reasoning/file/source-url 等; 这里测 round-trip 不变性, text-only 已够.
const messageArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 32 }),
  role: fc.constantFrom("user" as const, "assistant" as const, "system" as const),
  parts: fc.array(
    fc.record({
      type: fc.constant("text" as const),
      text: fc.string({ maxLength: 200 }),
    }),
    { maxLength: 5 },
  ),
});

describe("P-CONV-01: messagesJson JSON round-trip is lossless", () => {
  it("any UIMessage[] survives stringify→parse", () => {
    fc.assert(
      fc.property(fc.array(messageArb, { maxLength: 30 }), (messages) => {
        const json = JSON.stringify(messages);
        const parsed = JSON.parse(json);
        expect(parsed).toEqual(messages);
      }),
      { numRuns: 100 },
    );
  });

  it("ConversationSchema accepts well-formed conversation with random messagesJson", () => {
    fc.assert(
      fc.property(fc.array(messageArb, { maxLength: 20 }), (messages) => {
        const messagesJson = JSON.stringify(messages);
        // 跳过 byte cap 超限的样本(实际 maxLength=20+text<=200 远低于 256KB)
        if (messagesJson.length > 256_000) return;
        const conv = {
          $id: "c1",
          ownerUserId: "u1",
          title: "",
          messagesJson,
          messageCount: messages.length,
          lastMessageAt: "2026-06-11T13:00:00.000Z",
          lastMessagePreview: "",
          createdAt: "2026-06-11T13:00:00.000Z",
          updatedAt: "2026-06-11T13:00:00.000Z",
        };
        const result = ConversationSchema.safeParse(conv);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

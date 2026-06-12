/**
 * P-CONV-03: messageCount === messagesJson 数组长度 (ConversationSchema superRefine 强制).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ConversationSchema } from "@merism/contracts";

describe("P-CONV-03: messageCount must match messagesJson length", () => {
  it("matching count → schema accepts", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (n) => {
        const messages = Array.from({ length: n }, (_, i) => ({
          id: `m${i}`,
          role: "user" as const,
          parts: [{ type: "text" as const, text: `msg ${i}` }],
        }));
        const conv = {
          $id: "c1",
          ownerUserId: "u1",
          title: "",
          messagesJson: JSON.stringify(messages),
          messageCount: n,
          lastMessageAt: "2026-06-11T13:00:00.000Z",
          lastMessagePreview: "",
          createdAt: "2026-06-11T13:00:00.000Z",
          updatedAt: "2026-06-11T13:00:00.000Z",
        };
        expect(ConversationSchema.safeParse(conv).success).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it("mismatched count → schema rejects with messageCount issue", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        (actualLen, claimedCount) => {
          if (actualLen === claimedCount) return; // 跳过 trivial pass
          const messages = Array.from({ length: actualLen }, (_, i) => ({
            id: `m${i}`,
            role: "user" as const,
            parts: [{ type: "text" as const, text: "x" }],
          }));
          const conv = {
            $id: "c1",
            ownerUserId: "u1",
            title: "",
            messagesJson: JSON.stringify(messages),
            messageCount: claimedCount,
            lastMessageAt: "2026-06-11T13:00:00.000Z",
            lastMessagePreview: "",
            createdAt: "2026-06-11T13:00:00.000Z",
            updatedAt: "2026-06-11T13:00:00.000Z",
          };
          const result = ConversationSchema.safeParse(conv);
          expect(result.success).toBe(false);
          if (!result.success) {
            const paths = result.error.issues.map((i) => i.path.join("."));
            expect(paths.some((p) => p === "messageCount")).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

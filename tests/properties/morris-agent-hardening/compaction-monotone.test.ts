import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { UIMessage } from "ai";

import {
  applyCompaction,
  estimateTokens,
  planCompaction,
  type Summarizer,
} from "../../../apps/web/lib/assistant/compaction";

/**
 * P-AI-03 — 压缩单调性
 *
 * 对任意 messages 序列, applyCompaction(planCompaction(...)) 输出 messages' 满足:
 * - tokens(messages') ≤ tokens(messages)
 * - keep 严格是 messages 的尾部连续子序列 (action='compact' 时)
 * - 若插入了 summary, 它的 role === 'system' 且位置紧接 keep 之前
 */

const msgArb: fc.Arbitrary<UIMessage> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  role: fc.constantFrom<"user" | "assistant" | "system">("user", "assistant", "system"),
  parts: fc
    .array(fc.record({ type: fc.constant("text"), text: fc.string({ minLength: 0, maxLength: 200 }) }), {
      minLength: 1,
      maxLength: 3,
    })
    .map((parts) => parts as Array<{ type: string; text: string }>),
}) as unknown as fc.Arbitrary<UIMessage>;

const optsArb = fc.record({
  tokenBudget: fc.integer({ min: 50, max: 1500 }),
  minKeepTurns: fc.integer({ min: 0, max: 4 }),
  tailKeep: fc.integer({ min: 1, max: 8 }),
});

const summarizer: Summarizer = async () => "短摘要";

describe("P-AI-03: compaction monotonicity", () => {
  it("token count never grows after compaction", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(msgArb, { maxLength: 30 }),
        optsArb,
        async (messages, opts) => {
          const plan = planCompaction(messages, opts);
          const out = await applyCompaction(messages, plan, summarizer);
          expect(estimateTokens(out)).toBeLessThanOrEqual(estimateTokens(messages));
        },
      ),
    );
  });

  it("keep is a strict tail sub-sequence of input on compact", () => {
    fc.assert(
      fc.property(fc.array(msgArb, { maxLength: 30 }), optsArb, (messages, opts) => {
        const plan = planCompaction(messages, opts);
        if (plan.action === "compact") {
          expect(plan.keep).toEqual(messages.slice(-opts.tailKeep));
          expect([...plan.dropped, ...plan.keep]).toEqual(messages);
        }
      }),
    );
  });

  it("inserted summary message (when present) is system-role and immediately precedes keep", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(msgArb, { maxLength: 30 }),
        optsArb,
        async (messages, opts) => {
          const plan = planCompaction(messages, opts);
          const out = await applyCompaction(messages, plan, summarizer);
          if (plan.action === "compact") {
            expect(out[0].role).toBe("system");
            // 校验剩下的 == plan.keep
            expect(out.slice(1)).toEqual(plan.keep);
          } else {
            // noop: 引用相等
            expect(out).toBe(messages);
          }
        },
      ),
    );
  });
});

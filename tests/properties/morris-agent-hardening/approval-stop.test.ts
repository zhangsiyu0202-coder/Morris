import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  hasPendingApproval,
  proposeApproval,
  type ApprovalEnvelope,
} from "../../../apps/web/lib/assistant/approval";

/**
 * P-AI-05 — Approval 不可绕过
 *
 * 当任意一步的工具结果含 pending_approval 形态, hasPendingApproval 返回 true。
 * 反之返回 false。
 */

const okArtifactArb = fc.oneof(
  fc.record({ studies: fc.array(fc.string(), { maxLength: 3 }) }),
  fc.record({ count: fc.integer({ min: 0, max: 100 }), snippets: fc.array(fc.string(), { maxLength: 3 }) }),
  fc.record({ error: fc.constant(true), message: fc.string({ minLength: 1, maxLength: 20 }) }),
);

function makeEnvelope(): ApprovalEnvelope {
  return proposeApproval({
    toolName: "editQuestion",
    preview: "preview",
    payload: { surveyId: "abc" },
  });
}

describe("P-AI-05: hasPendingApproval truth table", () => {
  it("returns false when no step contains a pending_approval", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            toolResults: fc.array(fc.record({ output: fc.record({ content: fc.string(), artifact: okArtifactArb }) }), { maxLength: 3 }),
          }),
          { maxLength: 5 },
        ),
        async (steps) => {
          const cond = hasPendingApproval as unknown as (
            ctx: { steps: any[] },
          ) => boolean | Promise<boolean>;
          expect(await cond({ steps })).toBe(false);
        },
      ),
    );
  });

  it("returns true if any step has output.artifact === ApprovalEnvelope", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            toolResults: fc.array(
              fc.record({ output: fc.record({ content: fc.string(), artifact: okArtifactArb }) }),
              { maxLength: 3 },
            ),
          }),
          { maxLength: 5 },
        ),
        fc.integer({ min: 0, max: 4 }),
        async (steps, injectAt) => {
          // 在某一步注入 pending_approval
          const env = makeEnvelope();
          const idx = Math.min(injectAt, Math.max(steps.length - 1, 0));
          if (steps.length === 0) {
            steps.push({ toolResults: [] });
          }
          (steps[idx] as { toolResults: any[] }).toolResults.push({
            output: { content: "wait", artifact: env },
          });
          const cond = hasPendingApproval as unknown as (
            ctx: { steps: any[] },
          ) => boolean | Promise<boolean>;
          expect(await cond({ steps })).toBe(true);
        },
      ),
    );
  });

  it("returns true if any step has output === ApprovalEnvelope (top-level)", async () => {
    const env = makeEnvelope();
    const cond = hasPendingApproval as unknown as (
      ctx: { steps: any[] },
    ) => boolean | Promise<boolean>;
    expect(await cond({ steps: [{ toolResults: [{ output: env }] }] })).toBe(true);
  });
});

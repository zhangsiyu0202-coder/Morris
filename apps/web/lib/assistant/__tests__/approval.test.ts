import { describe, it, expect } from "vitest";

import {
  hasPendingApproval,
  isPendingApprovalArtifact,
  proposeApproval,
  type ApprovalEnvelope,
} from "../approval";

describe("proposeApproval", () => {
  it("产出完整字段的 envelope", () => {
    const env = proposeApproval({
      toolName: "editQuestion",
      preview: "## 即将修改\n- Q1: 旧 → 新",
      payload: { surveyId: "abc", questionId: "q1", text: "新题面" },
    });
    expect(env.status).toBe("pending_approval");
    expect(env.toolName).toBe("editQuestion");
    expect(env.preview).toContain("即将修改");
    expect(env.payload).toMatchObject({ surveyId: "abc", questionId: "q1" });
    expect(env.proposalId.length).toBeGreaterThan(0);
    expect(() => new Date(env.createdAt)).not.toThrow();
  });

  it("两次调用产生不同 proposalId", () => {
    const a = proposeApproval({ toolName: "x", preview: "p", payload: {} });
    const b = proposeApproval({ toolName: "x", preview: "p", payload: {} });
    expect(a.proposalId).not.toBe(b.proposalId);
  });

  it("payload 是浅拷贝, 后续修改原对象不影响 envelope", () => {
    const original = { surveyId: "abc" };
    const env = proposeApproval({ toolName: "x", preview: "p", payload: original });
    original.surveyId = "mutated";
    expect((env.payload as { surveyId: string }).surveyId).toBe("abc");
  });
});

describe("isPendingApprovalArtifact", () => {
  const valid: ApprovalEnvelope = {
    status: "pending_approval",
    proposalId: "p1",
    toolName: "x",
    preview: "p",
    payload: {},
    createdAt: new Date().toISOString(),
  };
  it.each([
    ["null", null, false],
    ["undefined", undefined, false],
    ["string", "pending_approval", false],
    ["valid envelope", valid, true],
    ["wrong status", { ...valid, status: "ok" }, false],
    ["missing proposalId", { ...valid, proposalId: 1 }, false],
  ])("%s → %s", (_desc, input, expected) => {
    expect(isPendingApprovalArtifact(input)).toBe(expected);
  });
});

describe("hasPendingApproval stop condition", () => {
  function step(toolResults: { output: unknown }[]): any {
    return { toolResults };
  }
  const env: ApprovalEnvelope = {
    status: "pending_approval",
    proposalId: "p2",
    toolName: "editQuestion",
    preview: "p",
    payload: {},
    createdAt: new Date().toISOString(),
  };

  it("triggers when output IS the envelope", async () => {
    const cond = hasPendingApproval as unknown as (
      ctx: { steps: any[] },
    ) => boolean | Promise<boolean>;
    expect(await cond({ steps: [step([{ output: env }])] })).toBe(true);
  });

  it("triggers when output.artifact is the envelope (ToolResultEnvelope shape)", async () => {
    const cond = hasPendingApproval as unknown as (
      ctx: { steps: any[] },
    ) => boolean | Promise<boolean>;
    expect(
      await cond({
        steps: [step([{ output: { content: "x", artifact: env } }])],
      }),
    ).toBe(true);
  });

  it("does NOT trigger on regular tool results", async () => {
    const cond = hasPendingApproval as unknown as (
      ctx: { steps: any[] },
    ) => boolean | Promise<boolean>;
    expect(
      await cond({
        steps: [
          step([
            { output: { content: "x", artifact: { studies: [] } } },
            { output: { content: "y", artifact: { error: true, message: "oops" } } },
          ]),
        ],
      }),
    ).toBe(false);
  });

  it("returns false on empty steps", async () => {
    const cond = hasPendingApproval as unknown as (
      ctx: { steps: any[] },
    ) => boolean | Promise<boolean>;
    expect(await cond({ steps: [] })).toBe(false);
  });
});

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

// ============================================================
// withApprovalGuard (Wave C T14 / morris-tool-metadata R4)
// ============================================================

import { withApprovalGuard } from "../approval";
import type { ToolMetadata } from "../tool-metadata";
import { vi } from "vitest";

const READ_METADATA: ToolMetadata = {
  title: "Read tool",
  description:
    "Test fixture for a read tool: long enough to satisfy MIN_DESCRIPTION_CHARS = 120 if validated, " +
    "but withApprovalGuard does not enforce description length, only annotations.destructive.",
  annotations: { readOnly: true, destructive: false, idempotent: true },
  requiredScopes: [],
  type: "read",
  enabled: true,
};

const WRITE_DESTRUCTIVE_METADATA: ToolMetadata = {
  title: "Destructive write tool",
  description:
    "Test fixture for a destructive write tool: long enough to satisfy MIN_DESCRIPTION_CHARS = 120, " +
    "destructive=true triggers withApprovalGuard's proposal path when input lacks approvalToken.",
  annotations: { readOnly: false, destructive: true, idempotent: true },
  requiredScopes: ["test:write"],
  type: "write",
  enabled: true,
};

describe("withApprovalGuard — destructive=false (identity wrapper)", () => {
  it("returns the original execute reference (zero-overhead)", () => {
    const exec = vi.fn(async (input: { foo: string; approvalToken?: string }) => ({
      content: "ok",
      artifact: { foo: input.foo },
    }));
    const wrapped = withApprovalGuard<{ foo: string; approvalToken?: string }, { foo: string }>(
      "noopTool",
      READ_METADATA,
      exec as never,
    );
    // identity: 同一个 reference (R4 §2 零开销保证)
    expect(wrapped).toBe(exec);
  });

  it("forwards calls to the underlying execute", async () => {
    const exec = vi.fn(async () => ({
      content: "ok",
      artifact: { value: 42 },
    }));
    const wrapped = withApprovalGuard<{ approvalToken?: string }, { value: number }>(
      "noopTool",
      READ_METADATA,
      exec as never,
    );
    const result = await wrapped({});
    expect(exec).toHaveBeenCalledTimes(1);
    expect((result.artifact as { value?: number }).value).toBe(42);
  });
});

describe("withApprovalGuard — destructive=true without approvalToken", () => {
  it("returns pending_approval envelope without calling execute", async () => {
    const exec = vi.fn(async () => ({
      content: "should not be called",
      artifact: { value: 0 },
    }));
    const wrapped = withApprovalGuard<{ surveyId: string; approvalToken?: string }, { value: number }>(
      "destructiveTool",
      WRITE_DESTRUCTIVE_METADATA,
      exec as never,
    );
    const result = await wrapped({ surveyId: "abc" });
    expect(exec).not.toHaveBeenCalled();
    expect(isPendingApprovalArtifact(result.artifact)).toBe(true);
    const proposal = result.artifact as ApprovalEnvelope;
    expect(proposal.toolName).toBe("destructiveTool");
    expect(proposal.preview).toContain("Destructive write tool");
    expect(proposal.payload).toMatchObject({ surveyId: "abc" });
    expect(typeof proposal.proposalId).toBe("string");
    expect(proposal.proposalId.length).toBeGreaterThan(0);
  });

  it("payload is a copy, not a live reference to input", async () => {
    const exec = vi.fn(async () => ({ content: "x", artifact: {} }));
    const wrapped = withApprovalGuard<{ foo: string; approvalToken?: string }, Record<string, unknown>>(
      "destructiveTool",
      WRITE_DESTRUCTIVE_METADATA,
      exec as never,
    );
    const input: { foo: string; approvalToken?: string } = { foo: "bar" };
    const result = await wrapped(input);
    const proposal = result.artifact as ApprovalEnvelope;
    // 改 input 不应影响 envelope 里的 payload
    input.foo = "mutated";
    expect((proposal.payload as { foo?: string }).foo).toBe("bar");
  });
});

describe("withApprovalGuard — destructive=true with approvalToken (confirm path)", () => {
  it("calls the original execute when approvalToken is present", async () => {
    const exec = vi.fn(async (input: { surveyId: string; approvalToken?: string }) => ({
      content: "executed after approval",
      artifact: { surveyId: input.surveyId, approvedWith: input.approvalToken },
    }));
    const wrapped = withApprovalGuard("destructiveTool", WRITE_DESTRUCTIVE_METADATA, exec);
    const result = await wrapped({ surveyId: "abc", approvalToken: "valid-token-stub" });
    expect(exec).toHaveBeenCalledTimes(1);
    expect((result.artifact as { surveyId: string }).surveyId).toBe("abc");
    expect((result.artifact as { approvedWith?: string }).approvedWith).toBe("valid-token-stub");
    expect(isPendingApprovalArtifact(result.artifact)).toBe(false);
  });
});

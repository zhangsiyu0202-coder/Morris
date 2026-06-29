import { describe, it, expect, vi } from "vitest";

// Mock server-only deps that manage-memories.ts pulls in transitively.
// `actions` 拉 node-appwrite + queries/auth, 必须先 mock 才能让 buildManageMemoriesTool
// import 链跑通。tools-side test 仅校验 metadata 与 needsApproval, 不触发 execute,
// 因此 actions 内部不需要真实实现。
vi.mock("@/lib/memories/actions", () => ({
  createMemory: vi.fn(),
  queryMemories: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  listMemories: vi.fn(),
}));

import { buildManageMemoriesTool } from "../tools/manage-memories";

const ctx = { ownerUserId: "u1" } as const;

/**
 * AI SDK 6 needsApproval 真实签名: `(input, { toolCallId, messages, experimental_context }) => Promise<boolean>`。
 * 单测里只关心返回值; 给最小的 options 形参。
 */
const noopOptions = { toolCallId: "tc-1", messages: [] as never[] };

describe("manageMemories.needsApproval — per-action approval gate (ADR-0009)", () => {
  it("action=delete → needsApproval true (HITL pause)", async () => {
    const built = buildManageMemoriesTool(ctx);
    const need = await (built.spec as any).needsApproval(
      { action: "delete", memoryId: "m1" },
      noopOptions,
    );
    expect(need).toBe(true);
  });

  it("action=create → needsApproval false (auto-execute)", async () => {
    const built = buildManageMemoriesTool(ctx);
    const need = await (built.spec as any).needsApproval(
      { action: "create", content: "diet preference: vegetarian" },
      noopOptions,
    );
    expect(need).toBe(false);
  });

  it("action=query → needsApproval false", async () => {
    const built = buildManageMemoriesTool(ctx);
    const need = await (built.spec as any).needsApproval(
      { action: "query", queryText: "my preferences" },
      noopOptions,
    );
    expect(need).toBe(false);
  });

  it("action=update → needsApproval false (recoverable)", async () => {
    const built = buildManageMemoriesTool(ctx);
    const need = await (built.spec as any).needsApproval(
      { action: "update", memoryId: "m1", content: "updated" },
      noopOptions,
    );
    expect(need).toBe(false);
  });

  it("action=list → needsApproval false (read-only)", async () => {
    const built = buildManageMemoriesTool(ctx);
    const need = await (built.spec as any).needsApproval(
      { action: "list" },
      noopOptions,
    );
    expect(need).toBe(false);
  });
});

describe("manageMemories.metadata — destructive remains false at tool level", () => {
  it("annotations.destructive=false (整 tool 描述, 不让 read-only action 被过度 approve)", () => {
    const built = buildManageMemoriesTool(ctx);
    expect(built.metadata.annotations.destructive).toBe(false);
    expect(built.metadata.annotations.readOnly).toBe(false);
  });
});

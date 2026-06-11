import { describe, it, expect, vi } from "vitest";
import { deriveUsageRollup, aggregateWorkspaceUsage, type AggregateDeps } from "../src/handler";
import { hardCeilingFor } from "@merism/contracts";

describe("deriveUsageRollup (ADR 0006 M6)", () => {
  it("stays ok under the hard ceiling and flips over at/above it", () => {
    const included = 50;
    const ceiling = hardCeilingFor(included); // 100
    expect(deriveUsageRollup({ workspaceId: "w", periodStart: "s", periodEnd: "e", completedInterviews: ceiling - 1, includedInterviews: included }).quota.state).toBe("ok");
    expect(deriveUsageRollup({ workspaceId: "w", periodStart: "s", periodEnd: "e", completedInterviews: ceiling, includedInterviews: included }).quota.state).toBe("over");
  });

  it("mirrors used = completed and carries the ceiling", () => {
    const r = deriveUsageRollup({ workspaceId: "w", periodStart: "s", periodEnd: "e", completedInterviews: 7, includedInterviews: 50 });
    expect(r.counter.completedInterviews).toBe(7);
    expect(r.quota.usedInterviews).toBe(7);
    expect(r.quota.hardCeiling).toBe(hardCeilingFor(50));
  });
});

function makeDeps(over: Partial<AggregateDeps> = {}): AggregateDeps {
  return {
    now: () => 0,
    currentPeriod: () => ({ start: "2026-06-01T00:00:00.000Z", end: "2026-07-01T00:00:00.000Z" }),
    listWorkspaceIds: vi.fn(async () => ["w1", "w2", "w3"]),
    getIncludedInterviews: vi.fn(async (ws: string) => (ws === "w3" ? null : 50)),
    countCompletedInterviews: vi.fn(async (ws: string) => (ws === "w2" ? 200 : 10)),
    upsertCounter: vi.fn(async () => {}),
    upsertQuota: vi.fn(async () => {}),
    ...over,
  };
}

describe("aggregateWorkspaceUsage orchestrator", () => {
  it("processes subscribed workspaces, skips unsubscribed, counts over-quota", async () => {
    const deps = makeDeps();
    const s = await aggregateWorkspaceUsage(deps);
    expect(s).toEqual({ processed: 2, skipped: 1, over: 1 }); // w1 ok, w2 over(200>=100), w3 skipped
    expect(deps.upsertCounter).toHaveBeenCalledTimes(2);
    expect(deps.upsertQuota).toHaveBeenCalledTimes(2);
  });
});

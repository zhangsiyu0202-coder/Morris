import { describe, it, expect, vi } from "vitest";
import { createWorkspace, DEFAULT_PLAN, type CreateWorkspaceDeps } from "../src/handler";

function makeDeps(over: Partial<CreateWorkspaceDeps> = {}): CreateWorkspaceDeps {
  return {
    callerUserId: "u1",
    now: () => 1_000_000,
    generateWorkspaceId: () => "ws_fixed",
    createTeam: vi.fn(async () => {}),
    claimOwnerSeat: vi.fn(async () => {}),
    seedQuota: vi.fn(async () => {}),
    createTrialSubscription: vi.fn(async () => {}),
    deleteTeam: vi.fn(async () => {}),
    ...over,
  };
}

describe("createWorkspace (ADR 0006 M3)", () => {
  it("creates team + owner membership + trial subscription on the happy path", async () => {
    const deps = makeDeps();
    const r = await createWorkspace({ name: "Acme" }, deps);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ workspaceId: "ws_fixed", ownerUserId: "u1", planKey: DEFAULT_PLAN });
    expect(deps.createTeam).toHaveBeenCalledWith("ws_fixed", "Acme", "u1");
    expect(deps.createTrialSubscription).toHaveBeenCalledWith("ws_fixed", DEFAULT_PLAN, 1_000_000);
    expect(deps.claimOwnerSeat).toHaveBeenCalledWith("ws_fixed", "u1");
    expect(deps.seedQuota).toHaveBeenCalledWith("ws_fixed", DEFAULT_PLAN);
    expect(deps.deleteTeam).not.toHaveBeenCalled();
  });

  it("rejects invalid input (empty name) before any side effect", async () => {
    const deps = makeDeps();
    const r = await createWorkspace({ name: "" }, deps);
    expect(r.status).toBe(400);
    expect(deps.createTeam).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    const deps = makeDeps({ callerUserId: null });
    const r = await createWorkspace({ name: "Acme" }, deps);
    expect(r.status).toBe(401);
    expect(deps.createTeam).not.toHaveBeenCalled();
  });

  it("rolls back when team creation itself fails (partial team)", async () => {
    const deps = makeDeps({
      createTeam: vi.fn(async () => {
        throw new Error("membership add failed mid-bootstrap");
      }),
    });
    const r = await createWorkspace({ name: "Acme" }, deps);
    expect(r.status).toBe(500);
    expect(deps.deleteTeam).toHaveBeenCalledWith("ws_fixed");
  });

  it("rolls back the team when a later step fails", async () => {
    const deps = makeDeps({
      createTrialSubscription: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const r = await createWorkspace({ name: "Acme" }, deps);
    expect(r.status).toBe(500);
    expect(deps.createTeam).toHaveBeenCalledOnce();
    expect(deps.deleteTeam).toHaveBeenCalledWith("ws_fixed");
  });
});

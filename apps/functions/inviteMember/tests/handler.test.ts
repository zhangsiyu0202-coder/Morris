import { describe, it, expect, vi } from "vitest";
import { inviteMember, type InviteMemberDeps } from "../src/handler";

function makeDeps(over: Partial<InviteMemberDeps> = {}): InviteMemberDeps {
  return {
    callerUserId: "owner1",
    getCallerRole: vi.fn(async () => "owner" as const),
    getSeats: vi.fn(async () => 3),
    claimSeat: vi.fn(async () => true),
    releaseSeat: vi.fn(async () => {}),
    createInvite: vi.fn(async () => "seat_ws_0"),
    ...over,
  };
}
const REQ = { workspaceId: "ws_1", email: "a@b.com", role: "member" as const };

describe("inviteMember (ADR 0006 M3) — seat-cap CAS", () => {
  it("invites into the first free seat on the happy path", async () => {
    const deps = makeDeps();
    const r = await inviteMember(REQ, deps);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ membershipId: "seat_ws_0", status: "invited" });
    expect(deps.claimSeat).toHaveBeenCalledWith("ws_1", 0);
    expect(deps.createInvite).toHaveBeenCalledWith("ws_1", 0, "a@b.com", "member");
  });

  it("rejects invalid input and unauthenticated callers", async () => {
    expect((await inviteMember({ workspaceId: "ws_1", email: "x", role: "member" }, makeDeps())).status).toBe(400);
    expect((await inviteMember(REQ, makeDeps({ callerUserId: null }))).status).toBe(401);
  });

  it("forbids non-members and plain members", async () => {
    expect((await inviteMember(REQ, makeDeps({ getCallerRole: vi.fn(async () => null) }))).status).toBe(403);
    expect((await inviteMember(REQ, makeDeps({ getCallerRole: vi.fn(async () => "member") }))).status).toBe(403);
  });

  it("404 when the workspace/subscription is missing", async () => {
    expect((await inviteMember(REQ, makeDeps({ getSeats: vi.fn(async () => null) }))).status).toBe(404);
  });

  it("skips taken slots and lands on the first free one", async () => {
    const claimed: number[] = [];
    const deps = makeDeps({
      getSeats: vi.fn(async () => 3),
      claimSeat: vi.fn(async (_ws: string, k: number) => {
        claimed.push(k);
        return k === 2; // slots 0,1 taken
      }),
      createInvite: vi.fn(async (_ws, slot) => `seat_ws_${slot}`),
    });
    const r = await inviteMember(REQ, deps);
    expect(r.status).toBe(200);
    expect(claimed).toEqual([0, 1, 2]);
    expect(r.body).toMatchObject({ membershipId: "seat_ws_2" });
  });

  it("returns seat_limit_reached when every slot is taken", async () => {
    const r = await inviteMember(REQ, makeDeps({ claimSeat: vi.fn(async () => false) }));
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: "seat_limit_reached" });
  });

  it("releases the claimed seat when invite creation fails", async () => {
    const releaseSeat = vi.fn(async () => {});
    const r = await inviteMember(
      REQ,
      makeDeps({
        claimSeat: vi.fn(async (_ws: string, k: number) => k === 0),
        createInvite: vi.fn(async () => {
          throw new Error("invite failed");
        }),
        releaseSeat,
      }),
    );
    expect(r.status).toBe(500);
    expect(releaseSeat).toHaveBeenCalledWith("ws_1", 0);
  });
});

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { inviteMember, type InviteMemberDeps } from "../../../apps/functions/inviteMember/src/handler";

/**
 * P-WB-01 — Seat-cap concurrency (ADR 0006 FR-M2).
 * N concurrent invites to a workspace with S seats yield AT MOST S members,
 * and exactly min(N, S) when callers/roles are valid. The deterministic seat-
 * slot CAS (here a shared in-memory Set) is the gate — no counter race.
 */
describe("P-WB-01 seat-cap concurrency", () => {
  it("never admits more than `seats`; admits exactly min(N, seats)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 16 }), async (S, N) => {
        const taken = new Set<number>(); // shared seat-slot store = the CAS gate
        const deps: InviteMemberDeps = {
          callerUserId: "owner",
          getCallerRole: async () => "owner",
          getSeats: async () => S,
          claimSeat: async (_ws, k) => {
            if (taken.has(k)) return false;
            taken.add(k);
            return true;
          },
          releaseSeat: async (_ws, k) => {
            taken.delete(k);
          },
          createInvite: async (_ws, k) => `seat_ws_${k}`,
        };
        const results = await Promise.all(
          Array.from({ length: N }, (_, i) =>
            inviteMember({ workspaceId: "ws", email: `u${i}@x.com`, role: "member" }, deps),
          ),
        );
        const admitted = results.filter((r) => r.status === 200).length;
        const rejected = results.filter((r) => r.status === 409).length;
        expect(admitted).toBe(Math.min(N, S));
        expect(admitted + rejected).toBe(N);
        expect(taken.size).toBe(admitted);
        expect(taken.size).toBeLessThanOrEqual(S);
      }),
    );
  });
});

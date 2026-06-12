// Real deps: Appwrite Server SDK (Teams + Databases). Integration-tested only.
// Membership + roles are read from native Appwrite Teams (ADR-0006 D1: the
// Workspace IS a Team; no hand-rolled membership truth source). The
// workspace_memberships collection is kept ONLY as the seat-reservation CAS
// ledger (`seat_<ws>_<k>`); the create-with-id 409 is the seat-cap gate.
import { Client, Teams, Databases, Permission, Role } from "node-appwrite";
import type { InviteMemberDeps, WorkspaceRoleResolved } from "./handler.js";

const DB_ID = "merism";

export function createRealDeps(callerUserId: string | null): InviteMemberDeps {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT ?? "")
    .setProject(process.env.APPWRITE_PROJECT_ID ?? "")
    .setKey(process.env.APPWRITE_API_KEY ?? "");
  const teams = new Teams(client);
  const db = new Databases(client);
  const seatId = (ws: string, k: number) => `seat_${ws}_${k}`;

  return {
    callerUserId,

    async getCallerRole(workspaceId, userId): Promise<WorkspaceRoleResolved> {
      try {
        // Native Teams is the role truth source. Teams are seat-limited (small),
        // so listing memberships and matching the caller is cheap.
        const res = await teams.listMemberships(workspaceId);
        const roles = res.memberships.find((m) => m.userId === userId)?.roles ?? [];
        if (roles.includes("owner")) return "owner";
        if (roles.includes("admin")) return "admin";
        if (roles.includes("member")) return "member";
        return null;
      } catch {
        return null;
      }
    },

    async getSeats(workspaceId) {
      try {
        const sub = await db.getDocument(DB_ID, "subscriptions", `sub_${workspaceId}`);
        const seats = (sub as { seats?: number }).seats;
        return typeof seats === "number" ? seats : null;
      } catch {
        return null;
      }
    },

    async claimSeat(workspaceId, slotIndex) {
      try {
        await db.createDocument(
          DB_ID,
          "workspace_memberships",
          seatId(workspaceId, slotIndex),
          {
            workspaceId,
            // userId placeholder keeps the member_unique index non-colliding for
            // pending invites; the Team membership (created in createInvite) is
            // the authoritative membership record.
            userId: seatId(workspaceId, slotIndex),
            role: "member",
            status: "invited",
            createdAt: new Date().toISOString(),
          },
          [Permission.read(Role.team(workspaceId))],
        );
        return true;
      } catch {
        return false; // 409 = slot already claimed
      }
    },

    async releaseSeat(workspaceId, slotIndex) {
      await db.deleteDocument(DB_ID, "workspace_memberships", seatId(workspaceId, slotIndex));
    },

    async createInvite(workspaceId, _slotIndex, email, role) {
      // Appwrite Team invite by email with the requested role; the returned
      // Team membership id is the authoritative membership identifier.
      const membership = await teams.createMembership(
        workspaceId,
        [role],
        email,
        undefined,
        undefined,
        undefined,
      );
      return membership.$id;
    },
  };
}

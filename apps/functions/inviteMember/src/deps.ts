// Real deps: Appwrite Server SDK (Teams + Databases). Integration-tested only.
// Seat slots are claimed as deterministic-id rows in workspace_memberships
// (`seat_<ws>_<k>`); the create-with-id 409 is the CAS gate.
import { Client, Teams, Databases, Permission, Role, Query } from "node-appwrite";
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
        const res = await db.listDocuments(DB_ID, "workspace_memberships", [Query.equal("workspaceId", workspaceId), Query.equal("userId", userId), Query.limit(1)]);
        const role = (res.documents[0] as unknown as { role?: string } | undefined)?.role;
        if (role === "owner" || role === "admin" || role === "member") return role;
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
            // pending invites; replaced with the real id on accept.
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

    async createInvite(workspaceId, slotIndex, email, role) {
      const id = seatId(workspaceId, slotIndex);
      // Appwrite Team invite by email with the requested role.
      await teams.createMembership(workspaceId, [role], email, undefined, undefined, undefined);
      await db.updateDocument(DB_ID, "workspace_memberships", id, { role, status: "invited" });
      return id;
    },
  };
}

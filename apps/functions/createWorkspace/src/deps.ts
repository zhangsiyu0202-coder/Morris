// Real deps: Appwrite Server SDK (Teams + Databases). Integration-tested only
// (no branch coverage; testing.md). Secrets read here, never in the pure core.
import { Client, Teams, Databases, ID, Permission, Role } from "node-appwrite";
import type { PlanKeyValue } from "@merism/contracts";
import type { CreateWorkspaceDeps } from "./handler.js";

const DB_ID = "merism";
const TRIAL_MS = 14 * 24 * 60 * 60 * 1000; // 14-day Pro/Plus trial (prd-pricing.md)

export function createRealDeps(callerUserId: string | null): CreateWorkspaceDeps {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT ?? "")
    .setProject(process.env.APPWRITE_PROJECT_ID ?? "")
    .setKey(process.env.APPWRITE_API_KEY ?? "");
  const teams = new Teams(client);
  const db = new Databases(client);

  return {
    callerUserId,
    now: () => Date.now(),
    generateWorkspaceId: () => `ws_${ID.unique()}`,

    async createTeam(workspaceId, name, ownerUserId) {
      await teams.create(workspaceId, name, ["owner"]);
      // Add the authenticated researcher as the owner member (by user id).
      await teams.createMembership(workspaceId, ["owner"], undefined, ownerUserId);
    },

    async createOwnerMembershipView(workspaceId, ownerUserId, createdAtIso) {
      await db.createDocument(
        DB_ID,
        "workspace_memberships",
        `m_${workspaceId}_${ownerUserId}`,
        { workspaceId, userId: ownerUserId, role: "owner", status: "active", createdAt: createdAtIso },
        [Permission.read(Role.team(workspaceId))],
      );
    },

    async createTrialSubscription(workspaceId, planKey: PlanKeyValue, createdAtMs) {
      const start = new Date(createdAtMs).toISOString();
      const end = new Date(createdAtMs + TRIAL_MS).toISOString();
      await db.createDocument(
        DB_ID,
        "subscriptions",
        `sub_${workspaceId}`,
        {
          workspaceId,
          planKey,
          status: "trialing",
          seats: 1,
          currentPeriodStart: start,
          currentPeriodEnd: end,
        },
        [Permission.read(Role.team(workspaceId))],
      );
    },

    async deleteTeam(workspaceId) {
      await teams.delete(workspaceId);
    },
  };
}

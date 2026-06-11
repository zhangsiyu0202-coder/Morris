// Real deps: Appwrite Server SDK (Teams + Databases). Integration-tested only
// (no branch coverage; testing.md). Secrets read here, never in the pure core.
import { Client, Teams, Databases, ID, Permission, Role } from "node-appwrite";
import { hardCeilingFor, type PlanKeyValue } from "@merism/contracts";
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

    async claimOwnerSeat(workspaceId, ownerUserId) {
      // Owner occupies seat slot 0; inviteMember's CAS then claims [1, seats).
      await db.createDocument(
        DB_ID,
        "workspace_memberships",
        `seat_${workspaceId}_0`,
        { workspaceId, userId: ownerUserId, role: "owner", status: "active", createdAt: new Date().toISOString() },
        [Permission.read(Role.team(workspaceId))],
      );
    },

    async seedQuota(workspaceId, planKey: PlanKeyValue) {
      let included = 0;
      try {
        const plan = await db.getDocument(DB_ID, "plans", planKey);
        included = (plan as unknown as { includedInterviews?: number }).includedInterviews ?? 0;
      } catch {
        // plans catalog not seeded yet -> 0 allowance until aggregation refreshes it.
      }
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await db.createDocument(
        DB_ID,
        "workspace_quota",
        `wq_${workspaceId}`,
        { workspaceId, periodEnd, usedInterviews: 0, includedInterviews: included, hardCeiling: hardCeilingFor(included), state: "ok" },
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

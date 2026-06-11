// Real deps: Appwrite Databases (count usage_events, upsert counter/quota).
// Integration-tested only. Period boundaries are the calendar month (UTC).
import { Client, Databases, Query, Permission, Role } from "node-appwrite";
import type { AggregateDeps, UsageRollup } from "./handler.js";

const DB_ID = "merism";

function monthBounds(nowMs: number): { start: string; end: string } {
  const d = new Date(nowMs);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}


async function upsertDoc(
  db: Databases,
  collectionId: string,
  documentId: string,
  data: Record<string, unknown>,
  permissions: string[],
): Promise<void> {
  try {
    await db.updateDocument(DB_ID, collectionId, documentId, data);
  } catch {
    await db.createDocument(DB_ID, collectionId, documentId, data, permissions);
  }
}

export function createRealDeps(): AggregateDeps {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT ?? "")
    .setProject(process.env.APPWRITE_PROJECT_ID ?? "")
    .setKey(process.env.APPWRITE_API_KEY ?? "");
  const db = new Databases(client);

  return {
    now: () => Date.now(),
    currentPeriod: monthBounds,

    async listWorkspaceIds() {
      const res = await db.listDocuments(DB_ID, "subscriptions", [Query.limit(1000)]);
      return res.documents.map((d) => (d as unknown as { workspaceId: string }).workspaceId);
    },

    async getIncludedInterviews(workspaceId) {
      try {
        const sub = await db.getDocument(DB_ID, "subscriptions", `sub_${workspaceId}`);
        if ((sub as unknown as { status?: string }).status === "canceled") return null; // no active entitlement
        const plan = await db.getDocument(DB_ID, "plans", (sub as unknown as { planKey: string }).planKey);
        const inc = (plan as unknown as { includedInterviews?: number }).includedInterviews;
        return typeof inc === "number" ? inc : null;
      } catch {
        return null;
      }
    },

    async countCompletedInterviews(workspaceId, periodStart, periodEnd) {
      const res = await db.listDocuments(DB_ID, "usage_events", [
        Query.equal("workspaceId", workspaceId),
        Query.greaterThanEqual("occurredAt", periodStart),
        Query.lessThan("occurredAt", periodEnd),
        Query.limit(1),
      ]);
      return res.total;
    },

    async upsertCounter(counter: UsageRollup["counter"]) {
      const id = `uc_${counter.workspaceId}_${counter.periodStart}`;
      await upsertDoc(db, "usage_counters", id, counter, [Permission.read(Role.team(counter.workspaceId))]);
    },

    async upsertQuota(quota: UsageRollup["quota"]) {
      await upsertDoc(db, "workspace_quota", `wq_${quota.workspaceId}`, quota, [Permission.read(Role.team(quota.workspaceId))]);
    },
  };
}

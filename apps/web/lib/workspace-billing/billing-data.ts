// Server-side data seam for the billing settings view. Reads the workspace's
// subscription + quota (team-read docs) and the plan catalog via the caller's
// Appwrite session (ADR-0006: Workspace = Appwrite Team). Server contexts only;
// the page gates auth before calling.
import { Account, Teams, Databases } from "node-appwrite";
import { sessionClient, readSessionSecret } from "@/lib/auth/appwrite";
import type { BillingView } from "@/lib/mock/workspace-billing";

const DB_ID = "merism";
type BillingStatus = BillingView["status"];
const BILLING_STATUSES: readonly BillingStatus[] = ["trialing", "active", "past_due", "canceled"];

export interface UsageMeter {
  used: number;
  included: number;
  pct: number; // 0..100, clamped
  over: boolean;
}

/** Pure: usage-meter view for the period (clamped, over flag at allowance). */
export function usageMeter(used: number, included: number): UsageMeter {
  const pct = included <= 0 ? 0 : Math.min(100, Math.round((used / included) * 100));
  return { used, included, pct, over: included > 0 && used >= included };
}

/** Swallow only Appwrite 404 (doc not seeded yet); rethrow real faults. */
function ignore404(e: unknown): undefined {
  if ((e as { code?: number }).code !== 404) throw e;
  return undefined;
}

export async function loadBilling(): Promise<BillingView> {
  const secret = await readSessionSecret();
  if (!secret) throw new Error("not_authenticated");
  const client = sessionClient(secret);
  const teams = new Teams(client);
  const account = new Account(client);
  const db = new Databases(client);

  const team = (await teams.list()).teams[0];
  if (!team) {
    const me = await account.get();
    return {
      workspaceName: me.name || me.email || "My workspace",
      planKey: "plus",
      status: "trialing",
      seats: 1,
      periodEnd: "",
      usedInterviews: 0,
      includedInterviews: 0,
    };
  }

  let planKey: "plus" | "pro" = "plus";
  let status: BillingStatus = "trialing";
  let seats = 1;
  let periodEnd = "";
  try {
    const sub = (await db.getDocument(DB_ID, "subscriptions", `sub_${team.$id}`)) as {
      planKey?: string;
      status?: string;
      seats?: number;
      currentPeriodEnd?: string;
    };
    if (sub.planKey === "plus" || sub.planKey === "pro") planKey = sub.planKey;
    if (sub.status && (BILLING_STATUSES as readonly string[]).includes(sub.status)) {
      status = sub.status as BillingStatus;
    }
    if (typeof sub.seats === "number") seats = sub.seats;
    if (sub.currentPeriodEnd) periodEnd = sub.currentPeriodEnd;
  } catch (e) {
    ignore404(e);
  }

  let usedInterviews = 0;
  let includedInterviews = 0;
  try {
    const quota = (await db.getDocument(DB_ID, "workspace_quota", `wq_${team.$id}`)) as {
      usedInterviews?: number;
      includedInterviews?: number;
    };
    usedInterviews = quota.usedInterviews ?? 0;
    includedInterviews = quota.includedInterviews ?? 0;
  } catch (e) {
    ignore404(e);
  }

  if (includedInterviews <= 0) {
    // Fall back to the plan catalog's allowance when the quota row hasn't been
    // refreshed yet by the usage aggregator.
    try {
      const plan = (await db.getDocument(DB_ID, "plans", planKey)) as { includedInterviews?: number };
      includedInterviews = plan.includedInterviews ?? 0;
    } catch (e) {
      ignore404(e);
    }
  }

  return {
    workspaceName: team.name,
    planKey,
    status,
    seats,
    periodEnd,
    usedInterviews,
    includedInterviews,
  };
}

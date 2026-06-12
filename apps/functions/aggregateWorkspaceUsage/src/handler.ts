// Pure usage-aggregation core (ADR 0006 M6). Scheduled reconciler: rolls the
// period's billable UsageEvents into a per-workspace UsageCounter + QuotaState.
// Borrows PostHog's periodic usage_report shape, but as an Appwrite scheduled
// Function (ADR 0005 pattern) writing an Appwrite collection rather than Celery
// + Redis. Stripe metered reporting is layered on in M5; this milestone keeps
// the internal counter/quota only. Degrade-never-delete: over-quota only flips
// QuotaState; it never touches researcher data.
import { hardCeilingFor, type QuotaStatusValue } from "@merism/contracts";

export interface UsageRollupInput {
  workspaceId: string;
  periodStart: string;
  periodEnd: string;
  completedInterviews: number;
  includedInterviews: number;
}

export interface UsageRollup {
  counter: {
    workspaceId: string;
    periodStart: string;
    periodEnd: string;
    completedInterviews: number;
  };
  quota: {
    workspaceId: string;
    periodEnd: string;
    usedInterviews: number;
    includedInterviews: number;
    hardCeiling: number;
    state: QuotaStatusValue;
  };
}

/** Pure: given the period's completed-interview count + the plan allowance,
 *  compute the counter row and the derived quota snapshot. */
export function deriveUsageRollup(i: UsageRollupInput): UsageRollup {
  const hardCeiling = hardCeilingFor(i.includedInterviews);
  const state: QuotaStatusValue = i.completedInterviews >= hardCeiling ? "over" : "ok";
  return {
    counter: {
      workspaceId: i.workspaceId,
      periodStart: i.periodStart,
      periodEnd: i.periodEnd,
      completedInterviews: i.completedInterviews,
    },
    quota: {
      workspaceId: i.workspaceId,
      periodEnd: i.periodEnd,
      usedInterviews: i.completedInterviews,
      includedInterviews: i.includedInterviews,
      hardCeiling,
      state,
    },
  };
}

export interface AggregateDeps {
  now(): number;
  /** Current billing period [start, end) as ISO strings. */
  currentPeriod(nowMs: number): { start: string; end: string };
  listWorkspaceIds(): Promise<string[]>;
  /** Plan allowance for the workspace, or null if no active subscription. */
  getIncludedInterviews(workspaceId: string): Promise<number | null>;
  countCompletedInterviews(workspaceId: string, periodStart: string, periodEnd: string): Promise<number>;
  upsertCounter(counter: UsageRollup["counter"]): Promise<void>;
  upsertQuota(quota: UsageRollup["quota"]): Promise<void>;
}

export interface AggregateSummary {
  processed: number;
  skipped: number;
  over: number;
}

export async function aggregateWorkspaceUsage(deps: AggregateDeps): Promise<AggregateSummary> {
  const { start, end } = deps.currentPeriod(deps.now());
  const ids = await deps.listWorkspaceIds();
  let processed = 0;
  let skipped = 0;
  let over = 0;

  for (const workspaceId of ids) {
    const included = await deps.getIncludedInterviews(workspaceId);
    if (included === null) {
      skipped++; // no active subscription -> nothing to meter
      continue;
    }
    const completedInterviews = await deps.countCompletedInterviews(workspaceId, start, end);
    const rollup = deriveUsageRollup({ workspaceId, periodStart: start, periodEnd: end, completedInterviews, includedInterviews: included });
    await deps.upsertCounter(rollup.counter);
    await deps.upsertQuota(rollup.quota);
    processed++;
    if (rollup.quota.state === "over") over++;
  }

  return { processed, skipped, over };
}

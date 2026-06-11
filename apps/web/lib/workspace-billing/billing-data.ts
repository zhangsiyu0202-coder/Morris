// Server-side data seam for the billing settings view. Mock now; swaps to
// Appwrite (subscription + plans + workspace_quota, all team-read) later.
import { getOwnerUserIdOrNull } from "@/lib/auth/owner";
import { getMockBilling, type BillingView } from "@/lib/mock/workspace-billing";

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

export async function loadBilling(): Promise<BillingView> {
  try {
    const owner = await getOwnerUserIdOrNull();
    if (!owner) return getMockBilling();
    // TODO(stack): read subscription(sub_<ws>) + plans(planKey) + workspace_quota(wq_<ws>).
    return getMockBilling();
  } catch {
    return getMockBilling();
  }
}

// Pure changePlan core (ADR 0006 M5). Owner-only. Stripe is fully behind deps
// (no stripe import here) so the core is unit-testable. The handler never
// writes the plan locally — Stripe is the source of truth and stripeWebhook
// projects the resulting subscription state back (FR-P2/FR-B1).
import { ChangePlanRequestSchema, type ChangePlanResponse } from "@merism/contracts";

export interface ChangePlanDeps {
  callerUserId: string | null;
  getCallerRole(workspaceId: string, userId: string): Promise<"owner" | "admin" | "member" | null>;
  /** Create a Stripe Checkout/Customer-Portal session for the plan change;
   *  returns the hosted URL the client redirects to. */
  createPlanChangeSession(workspaceId: string, targetPlan: "plus" | "pro", ownerUserId: string): Promise<string>;
}

export type ChangePlanResult =
  | { status: 200; body: ChangePlanResponse }
  | { status: 400 | 401 | 403 | 500; body: { error: string } };

export async function changePlan(rawInput: unknown, deps: ChangePlanDeps): Promise<ChangePlanResult> {
  const parsed = ChangePlanRequestSchema.safeParse(rawInput);
  if (!parsed.success) return { status: 400, body: { error: "invalid_input" } };
  if (!deps.callerUserId) return { status: 401, body: { error: "unauthenticated" } };

  const role = await deps.getCallerRole(parsed.data.workspaceId, deps.callerUserId);
  if (role === null) return { status: 403, body: { error: "not_workspace_member" } };
  if (role !== "owner") return { status: 403, body: { error: "forbidden" } }; // only the owner manages billing

  try {
    const url = await deps.createPlanChangeSession(parsed.data.workspaceId, parsed.data.targetPlan, deps.callerUserId);
    return { status: 200, body: { url } };
  } catch {
    return { status: 500, body: { error: "internal_error" } };
  }
}

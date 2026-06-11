// Pure createWorkspace core (ADR 0006 M3). No SDK imports -> unit testable with
// in-memory deps. Mirrors PostHog's atomic org-bootstrap (Organization +
// owner OrganizationMembership in one transaction): here we create the Appwrite
// Team, the owner membership view, and a trial Subscription, rolling back the
// team if a later step fails (best-effort, never throws past the boundary).
import {
  CreateWorkspaceRequestSchema,
  type CreateWorkspaceResponse,
  type PlanKeyValue,
} from "@merism/contracts";

/** Launch default plan for a fresh workspace (14-day trial seeded by deps). */
export const DEFAULT_PLAN: PlanKeyValue = "plus";

export interface CreateWorkspaceDeps {
  /** Authenticated caller (Appwrite Account $id), resolved in main from context. */
  callerUserId: string | null;
  now(): number;
  generateWorkspaceId(): string;
  /** Create the Appwrite Team (= the workspace) and add the owner membership. */
  createTeam(workspaceId: string, name: string, ownerUserId: string): Promise<void>;
  /** Write the denormalized membership view row (owner, active). */
  createOwnerMembershipView(workspaceId: string, ownerUserId: string, createdAtIso: string): Promise<void>;
  /** Owner occupies seat slot 0 (decision: the owner consumes a seat). */
  claimOwnerSeat(workspaceId: string, ownerUserId: string): Promise<void>;
  /** Seed the trial subscription stub. */
  createTrialSubscription(workspaceId: string, planKey: PlanKeyValue, createdAtMs: number): Promise<void>;
  /** Seed an initial quota row so the gate isn't unbounded for new workspaces
   *  before the first aggregation tick (decision: fail-open accepted + seeded). */
  seedQuota(workspaceId: string, planKey: PlanKeyValue): Promise<void>;
  /** Rollback: remove the team if a later step failed. */
  deleteTeam(workspaceId: string): Promise<void>;
}

export type CreateWorkspaceResult =
  | { status: 200; body: CreateWorkspaceResponse }
  | { status: 400 | 401 | 500; body: { error: string } };

export async function createWorkspace(
  rawInput: unknown,
  deps: CreateWorkspaceDeps,
): Promise<CreateWorkspaceResult> {
  const parsed = CreateWorkspaceRequestSchema.safeParse(rawInput);
  if (!parsed.success) return { status: 400, body: { error: "invalid_input" } };
  if (!deps.callerUserId) return { status: 401, body: { error: "unauthenticated" } };

  const ownerUserId = deps.callerUserId;
  const workspaceId = deps.generateWorkspaceId();
  const createdAtMs = deps.now();
  const createdAtIso = new Date(createdAtMs).toISOString();

  try {
    // The whole bootstrap is one unit (PostHog wraps org+owner-membership in a
    // transaction; Appwrite has no cross-resource txn, so we roll back the team
    // on ANY failure — including a partial team where owner-membership failed).
    await deps.createTeam(workspaceId, parsed.data.name, ownerUserId);
    await deps.createOwnerMembershipView(workspaceId, ownerUserId, createdAtIso);
    await deps.claimOwnerSeat(workspaceId, ownerUserId);
    await deps.createTrialSubscription(workspaceId, DEFAULT_PLAN, createdAtMs);
    await deps.seedQuota(workspaceId, DEFAULT_PLAN);
  } catch {
    await deps.deleteTeam(workspaceId).catch(() => {});
    return { status: 500, body: { error: "internal_error" } };
  }

  return { status: 200, body: { workspaceId, ownerUserId, planKey: DEFAULT_PLAN } };
}

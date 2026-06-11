// Pure inviteMember core (ADR 0006 M3). Seat-cap enforcement uses the same
// deterministic-id CAS pattern as issueLivekitToken: claim a seat slot
// `seat_<ws>_<k>` for k in [0, seats); the Appwrite unique-id 409 is the gate,
// so N concurrent invites to a workspace with S seats yield at most S members
// (no read-modify-write counter, per architecture.md concurrency contract).
// PostHog gates member count in its external billing service; Merism uses an
// explicit Subscription.seats + this CAS — a deliberate simplification.
import { InviteMemberRequestSchema, type InviteMemberResponse } from "@merism/contracts";

export type WorkspaceRoleResolved = "owner" | "admin" | "member" | null;

export interface InviteMemberDeps {
  callerUserId: string | null;
  /** Caller's role in the workspace, or null if not a member. */
  getCallerRole(workspaceId: string, userId: string): Promise<WorkspaceRoleResolved>;
  /** Seat entitlement from the subscription, or null if workspace/sub missing. */
  getSeats(workspaceId: string): Promise<number | null>;
  /** Claim seat slot k via unique id; false on 409 (slot already taken). */
  claimSeat(workspaceId: string, slotIndex: number): Promise<boolean>;
  /** Rollback a claimed-but-unused slot (best-effort). */
  releaseSeat(workspaceId: string, slotIndex: number): Promise<void>;
  /** Create the team invite + membership view (status invited); returns id. */
  createInvite(
    workspaceId: string,
    slotIndex: number,
    email: string,
    role: "admin" | "member",
  ): Promise<string>;
}

export type InviteMemberResult =
  | { status: 200; body: InviteMemberResponse }
  | { status: 400 | 401 | 403 | 404 | 409 | 500; body: { error: string } };

export async function inviteMember(
  rawInput: unknown,
  deps: InviteMemberDeps,
): Promise<InviteMemberResult> {
  const parsed = InviteMemberRequestSchema.safeParse(rawInput);
  if (!parsed.success) return { status: 400, body: { error: "invalid_input" } };
  if (!deps.callerUserId) return { status: 401, body: { error: "unauthenticated" } };
  const { workspaceId, email, role } = parsed.data;

  const callerRole = await deps.getCallerRole(workspaceId, deps.callerUserId);
  if (callerRole === null) return { status: 403, body: { error: "not_workspace_member" } };
  if (callerRole !== "owner" && callerRole !== "admin")
    return { status: 403, body: { error: "forbidden" } };

  const seats = await deps.getSeats(workspaceId);
  if (seats === null) return { status: 404, body: { error: "workspace_not_found" } };

  // Claim the first free seat slot (CAS). Taken slots (existing members /
  // concurrent invites) collide and we try the next one; exhaustion = full.
  let slot = -1;
  for (let k = 0; k < seats; k++) {
    if (await deps.claimSeat(workspaceId, k)) {
      slot = k;
      break;
    }
  }
  if (slot < 0) return { status: 409, body: { error: "seat_limit_reached" } };

  try {
    const membershipId = await deps.createInvite(workspaceId, slot, email, role);
    return { status: 200, body: { membershipId, status: "invited" } };
  } catch {
    // Invite creation failed after the seat was claimed: release the slot so it
    // does not stay permanently reserved. Best-effort; never throw past boundary.
    await deps.releaseSeat(workspaceId, slot).catch(() => {});
    return { status: 500, body: { error: "internal_error" } };
  }
}

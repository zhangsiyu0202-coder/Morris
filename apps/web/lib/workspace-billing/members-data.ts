// Server-side data seam for the workspace members/seats settings view.
// Mirrors lib/workspace/data.ts: returns mock now (UI stage), swaps to Appwrite
// (team-read on workspace_memberships + subscription.seats) without touching the
// view. Anonymous/no-stack/empty -> mock fallback so local dev works stackless.
import { getOwnerUserIdOrNull } from "@/lib/auth/owner";
import { getMockMembers, type WorkspaceMembersView, type MemberRow } from "@/lib/mock/workspace-billing";

export interface SeatUsage {
  used: number; // active + invited occupy a seat (owner included)
  seats: number;
  remaining: number;
  full: boolean;
}

/** Pure: seats consumed by active + pending-invite members (owner included). */
export function seatUsage(members: MemberRow[], seats: number): SeatUsage {
  const used = members.filter((m) => m.status === "active" || m.status === "invited").length;
  const remaining = Math.max(0, seats - used);
  return { used, seats, remaining, full: used >= seats };
}

export async function loadWorkspaceMembers(): Promise<WorkspaceMembersView> {
  try {
    const owner = await getOwnerUserIdOrNull();
    if (!owner) return getMockMembers();
    // TODO(stack): resolve current workspace for `owner`, then list
    // workspace_memberships (team-read) + read subscription.seats. Until the
    // survey-editor/web Appwrite migration lands, the mock is the source.
    return getMockMembers();
  } catch {
    return getMockMembers();
  }
}

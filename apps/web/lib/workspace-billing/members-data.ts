// Server-side data seam for the workspace members/seats settings view.
// Reads NATIVE Appwrite Teams (ADR-0006 D1: the Workspace IS a Team; membership
// + roles live in Teams, not a bespoke collection) via the caller's session, so
// Appwrite enforces who may see the member list. Seats come from the
// subscription. Server contexts only; the page gates auth before calling.
import { Account, Teams, Databases } from "node-appwrite";
import { sessionClient, readSessionSecret } from "@/lib/auth/appwrite";
import type {
  WorkspaceMembersView,
  MemberRow,
  MemberRole,
} from "@/lib/mock/workspace-billing";

const DB_ID = "merism";

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

/** Highest-precedence role from an Appwrite Team membership's roles array. */
function roleOf(roles: string[]): MemberRole {
  if (roles.includes("owner")) return "owner";
  if (roles.includes("admin")) return "admin";
  return "member";
}

export async function loadWorkspaceMembers(): Promise<WorkspaceMembersView> {
  const secret = await readSessionSecret();
  if (!secret) throw new Error("not_authenticated");
  const client = sessionClient(secret);
  const teams = new Teams(client);
  const account = new Account(client);
  const db = new Databases(client);

  const team = (await teams.list()).teams[0];
  if (!team) {
    // Logged-in researcher with no workspace yet: a real one-person owner view
    // derived from their own account (NOT mock data).
    const me = await account.get();
    return {
      workspaceId: "",
      workspaceName: me.name || me.email || "My workspace",
      planKey: "plus",
      seats: 1,
      members: [
        { userId: me.$id, name: me.name || me.email, email: me.email, role: "owner", status: "active" },
      ],
    };
  }

  const memberships = await teams.listMemberships(team.$id);
  const members: MemberRow[] = memberships.memberships.map((m) => ({
    userId: m.userId,
    name: m.userName || m.userEmail,
    email: m.userEmail,
    role: roleOf(m.roles),
    status: m.confirm ? "active" : "invited",
  }));

  let planKey: "plus" | "pro" = "plus";
  let seats = members.length;
  try {
    const sub = await db.getDocument(DB_ID, "subscriptions", `sub_${team.$id}`);
    const pk = (sub as { planKey?: string }).planKey;
    if (pk === "plus" || pk === "pro") planKey = pk;
    const s = (sub as { seats?: number }).seats;
    if (typeof s === "number") seats = s;
  } catch (e) {
    // Subscription not seeded for this workspace yet (404) -> fall back to the
    // member count as the seat figure. Any other error is a real fault.
    if ((e as { code?: number }).code !== 404) throw e;
  }

  return { workspaceId: team.$id, workspaceName: team.name, planKey, seats, members };
}

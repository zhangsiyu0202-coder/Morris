// UI-local view shapes + mock data for the workspace-billing (tenant) settings
// surface. Distinct from lib/mock/workspace.ts (the per-study workbench mock).
// ADR 0006: the tenant "Workspace" lives under /settings; the study "工作台"
// stays under /studies/[id]. Same English word, different concept, different route.

export type MemberRole = "owner" | "admin" | "member";
export type MemberStatus = "active" | "invited";

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
}

export interface WorkspaceMembersView {
  workspaceId: string;
  workspaceName: string;
  planKey: "plus" | "pro";
  seats: number;
  members: MemberRow[];
}

export function getMockMembers(): WorkspaceMembersView {
  return {
    workspaceId: "ws_demo",
    workspaceName: "Acme Research",
    planKey: "pro",
    seats: 5,
    members: [
      { userId: "u_owner", name: "Jia", email: "jia@acme.test", role: "owner", status: "active" },
      { userId: "u_a", name: "Alex", email: "alex@acme.test", role: "admin", status: "active" },
      { userId: "u_b", name: "Bao", email: "bao@acme.test", role: "member", status: "active" },
      { userId: "u_c", name: "(pending)", email: "chen@acme.test", role: "member", status: "invited" },
    ],
  };
}

export interface BillingView {
  workspaceName: string;
  planKey: "plus" | "pro";
  status: "trialing" | "active" | "past_due" | "canceled";
  seats: number;
  periodEnd: string;
  usedInterviews: number;
  includedInterviews: number;
}

export function getMockBilling(): BillingView {
  return {
    workspaceName: "Acme Research",
    planKey: "pro",
    status: "active",
    seats: 5,
    periodEnd: "2026-07-01",
    usedInterviews: 137,
    includedInterviews: 200,
  };
}

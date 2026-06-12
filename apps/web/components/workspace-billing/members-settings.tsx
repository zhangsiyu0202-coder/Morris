import { Check, Clock } from "lucide-react";
import type { WorkspaceMembersView, MemberRow } from "@/lib/mock/workspace-billing";
import { seatUsage } from "@/lib/workspace-billing/members-data";

/**
 * Workspace (tenant) members + seats settings — ADR 0006.
 * NOT the per-study 工作台 (that is components/studies/*). This is the billing
 * tenant's member roster, surfaced under /settings. Mauve Quiet: monochrome
 * status via icon + copy + container, no status colors.
 */

const ROLE_LABEL: Record<MemberRow["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

function StatusCell({ status }: { status: MemberRow["status"] }) {
  const Icon = status === "active" ? Check : Clock;
  const label = status === "active" ? "Active" : "Invited";
  return (
    <span className="inline-flex items-center gap-1.5 font-data text-body-sm text-ink-600">
      <Icon size={14} strokeWidth={2} aria-hidden />
      {label}
    </span>
  );
}

export function MembersSettings({ view }: { view: WorkspaceMembersView }) {
  const usage = seatUsage(view.members, view.seats);

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-display-lg text-ink-900">{view.workspaceName}</h1>
          <p className="mt-1 font-reading text-body text-ink-600">Workspace members &amp; seats</p>
        </div>
        <span className="rounded-xs bg-mauve-200 px-2 py-0.5 font-decor text-caption uppercase text-ink-900">
          {view.planKey}
        </span>
      </header>

      {/* Seat usage */}
      <section className="mb-8 rounded-lg bg-ink-0 p-6 shadow">
        <div className="flex items-baseline justify-between">
          <span className="font-ui text-body-sm font-medium text-ink-900">Seats</span>
          <span className="font-data text-body-sm text-ink-600">
            {usage.used} / {usage.seats} used
          </span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink-100">
          <div
            className="h-full bg-mauve-200"
            style={{ width: `${Math.min(100, (usage.used / Math.max(1, usage.seats)) * 100)}%` }}
            aria-hidden
          />
        </div>
        <p className="mt-2 font-reading text-caption text-ink-400">
          {usage.full
            ? "All seats are in use — upgrade the plan or remove a member to invite more."
            : `${usage.remaining} seat${usage.remaining === 1 ? "" : "s"} available.`}
        </p>
      </section>

      {/* Member roster */}
      <section className="overflow-hidden rounded-lg bg-ink-0 shadow">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-ink-200">
              <th className="px-6 py-3 text-left font-ui text-caption font-medium uppercase tracking-wide text-ink-400">Member</th>
              <th className="px-6 py-3 text-left font-ui text-caption font-medium uppercase tracking-wide text-ink-400">Role</th>
              <th className="px-6 py-3 text-left font-ui text-caption font-medium uppercase tracking-wide text-ink-400">Status</th>
            </tr>
          </thead>
          <tbody>
            {view.members.map((m) => (
              <tr key={m.userId} className="border-b border-ink-100 last:border-0">
                <td className="px-6 py-3">
                  <div className="font-ui text-body-sm text-ink-900">{m.name}</div>
                  <div className="font-data text-caption text-ink-400">{m.email}</div>
                </td>
                <td className="px-6 py-3 font-data text-body-sm text-ink-600">{ROLE_LABEL[m.role]}</td>
                <td className="px-6 py-3"><StatusCell status={m.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

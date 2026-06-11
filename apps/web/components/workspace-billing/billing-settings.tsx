import { CreditCard } from "lucide-react";
import type { BillingView } from "@/lib/mock/workspace-billing";
import { usageMeter } from "@/lib/workspace-billing/billing-data";

/**
 * Workspace billing settings (ADR 0006) — current plan, period usage, and the
 * link out to the Stripe Customer Portal (self-serve plan/seat/payment changes).
 * Mauve Quiet; the "Manage billing" CTA is an outline button (external action).
 */

const STATUS_COPY: Record<BillingView["status"], string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Payment past due",
  canceled: "Canceled",
};

export function BillingSettings({ view }: { view: BillingView }) {
  const meter = usageMeter(view.usedInterviews, view.includedInterviews);
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="font-display text-display-lg text-ink-900">Billing</h1>
      <p className="mt-1 font-reading text-body text-ink-600">{view.workspaceName}</p>

      <section className="mt-6 rounded-lg bg-ink-0 p-6 shadow">
        <div className="flex items-center justify-between">
          <div>
            <span className="rounded-xs bg-mauve-200 px-2 py-0.5 font-decor text-caption uppercase text-ink-900">
              {view.planKey}
            </span>
            <span className="ml-3 font-data text-body-sm text-ink-600">{STATUS_COPY[view.status]}</span>
          </div>
          <span className="font-data text-body-sm text-ink-600">{view.seats} seats</span>
        </div>

        <div className="mt-6">
          <div className="flex items-baseline justify-between">
            <span className="font-ui text-body-sm font-medium text-ink-900">Interviews this period</span>
            <span className="font-data text-body-sm text-ink-600">
              {meter.used} / {meter.included}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-100">
            <div className="h-full bg-mauve-200" style={{ width: `${meter.pct}%` }} aria-hidden />
          </div>
          <p className="mt-2 font-reading text-caption text-ink-400">
            {meter.over
              ? "Over the included allowance — overage is billed per completed interview."
              : `Resets ${view.periodEnd}.`}
          </p>
        </div>

        <a
          href="/api/billing/portal"
          className="mt-6 inline-flex h-10 items-center gap-2 rounded border border-ink-900 bg-ink-0 px-4 font-ui text-body-sm font-medium text-ink-900 hover:bg-mauve-50"
        >
          <CreditCard size={16} strokeWidth={2} aria-hidden />
          Manage billing
        </a>
        <p className="mt-2 font-reading text-caption text-ink-400">
          Opens the Stripe Customer Portal to change plan, seats, or payment method.
        </p>
      </section>
    </div>
  );
}

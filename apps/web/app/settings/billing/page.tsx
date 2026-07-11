import { BillingSettings } from "@/components/workspace-billing/billing-settings";
import { loadBilling } from "@/lib/workspace-billing/billing-data";
import { requireResearcher } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workspace 账单 · MerismV2",
};

export default async function WorkspaceBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ portal?: string }>;
}) {
  await requireResearcher("/settings/billing");
  const { portal } = await searchParams;
  const view = await loadBilling();
  return (
    <div className="min-h-full bg-mauve-50">
      <BillingSettings view={view} portalState={portal} />
    </div>
  );
}

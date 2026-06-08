import { AccountSettings } from "@/components/auth/account-settings";
import { requireResearcher } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "账户设置 · MerismV2",
};

export default async function AccountSettingsPage() {
  const researcher = await requireResearcher("/settings/account");
  return (
    <div className="min-h-full bg-mauve-50">
      <AccountSettings researcher={researcher} />
    </div>
  );
}

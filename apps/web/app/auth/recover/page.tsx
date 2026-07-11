import { RecoverForm } from "@/components/auth/recover-form";
import { AuthShell } from "@/components/auth/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "重置密码 · MerismV2",
};

export default function RecoverPage() {
  return (
    <AuthShell>
      <RecoverForm />
    </AuthShell>
  );
}

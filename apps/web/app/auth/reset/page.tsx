import { ResetForm } from "@/components/auth/reset-form";
import { AuthShell } from "@/components/auth/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "设置新密码 · MerismV2",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string; secret?: string }>;
}) {
  const { userId, secret } = await searchParams;
  return (
    <AuthShell>
      <ResetForm userId={userId ?? ""} secret={secret ?? ""} />
    </AuthShell>
  );
}

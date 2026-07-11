import { VerifyEmailClient } from "@/components/auth/verify-email-client";
import { AuthShell } from "@/components/auth/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "验证邮箱 · MerismV2",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string; secret?: string }>;
}) {
  const { userId, secret } = await searchParams;
  return (
    <AuthShell>
      <VerifyEmailClient userId={userId ?? ""} secret={secret ?? ""} />
    </AuthShell>
  );
}

import { redirect } from "next/navigation";
import { OtpForm } from "@/components/auth/otp-form";
import { AuthShell } from "@/components/auth/ui";
import { getPendingOtpEmail } from "@/lib/auth/actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "输入验证码 · MerismV2",
};

function safeCallback(raw: string | undefined): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/home";
}

export default async function LoginVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const email = await getPendingOtpEmail();
  if (!email) redirect("/login");

  return (
    <AuthShell>
      <OtpForm email={email} callbackUrl={safeCallback(callbackUrl)} />
    </AuthShell>
  );
}

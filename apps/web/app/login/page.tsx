import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { AuthShell } from "@/components/auth/ui";
import { getCurrentResearcher } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "登录 · MerismV2",
};

function safeCallback(raw: string | undefined): string {
  // Only allow internal absolute paths to prevent open-redirect.
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/home";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const target = safeCallback(callbackUrl);

  const researcher = await getCurrentResearcher();
  if (researcher) redirect(target);

  return (
    <AuthShell>
      <LoginForm callbackUrl={target} />
    </AuthShell>
  );
}

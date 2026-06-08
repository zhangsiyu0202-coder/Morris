import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/signup-form";
import { AuthShell } from "@/components/auth/ui";
import { getCurrentResearcher } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "注册 · MerismV2",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const researcher = await getCurrentResearcher();
  if (researcher) redirect("/home");

  const { email } = await searchParams;

  return (
    <AuthShell>
      <SignupForm defaultEmail={email ?? ""} />
    </AuthShell>
  );
}

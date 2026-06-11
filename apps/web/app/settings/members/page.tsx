import { MembersSettings } from "@/components/workspace-billing/members-settings";
import { loadWorkspaceMembers } from "@/lib/workspace-billing/members-data";
import { requireResearcher } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workspace 成员 · MerismV2",
};

export default async function WorkspaceMembersPage() {
  await requireResearcher("/settings/members");
  const view = await loadWorkspaceMembers();
  return (
    <div className="min-h-full bg-mauve-50">
      <MembersSettings view={view} />
    </div>
  );
}

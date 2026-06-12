import { DATABASE_ID, getServerClient, Query } from "@/lib/queries/client";
import { getCurrentUserId } from "@/lib/queries/auth";

/**
 * Resolve the current researcher's workspace (an Appwrite Team `$id`).
 *
 * Source of truth is `workspace_memberships` (denormalized read view of Team
 * membership). We pick the user's active membership. A researcher who has not
 * been put into any workspace yet resolves to `null` — callers fall back to the
 * legacy single-researcher (ownerUserId) scoping so the product still works
 * before/without workspaces.
 *
 * v1 assumes one active workspace per user. Multi-workspace selection (an
 * "active workspace" preference) is intentionally out of scope here.
 */
const MEMBERSHIPS = "workspace_memberships";

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  return getWorkspaceIdForUser(userId);
}

/** Testable core: resolve an active workspace id for a specific user, or null. */
export async function getWorkspaceIdForUser(userId: string): Promise<string | null> {
  const result = await getServerClient().databases.listDocuments(DATABASE_ID, MEMBERSHIPS, [
    Query.equal("userId", userId),
    Query.equal("status", "active"),
    Query.limit(1),
  ]);
  const row = result.documents[0] as { workspaceId?: string } | undefined;
  return row?.workspaceId ?? null;
}

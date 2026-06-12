import type { Databases } from "node-appwrite";
import { BookmarkSchema } from "@merism/contracts";
import type { Bookmark } from "@merism/contracts";
import { DATABASE_ID, getServerClient, Query, tenantFilter, type TenantScope } from "./client";

const BOOKMARKS = "bookmarks";

function db(): Databases {
  return getServerClient().databases;
}

function parseBookmark(raw: unknown): Bookmark | null {
  const parsed = BookmarkSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** List bookmarks in the caller's tenant (workspace, else solo owner), newest first. */
export async function listBookmarksForTenant(
  scope: TenantScope,
  limit = 50,
  databases: Databases = db(),
): Promise<Bookmark[]> {
  const result = await databases.listDocuments(DATABASE_ID, BOOKMARKS, [
    tenantFilter(scope),
    Query.orderDesc("createdAt"),
    Query.limit(limit),
  ]);
  const out: Bookmark[] = [];
  for (const raw of result.documents) {
    const parsed = parseBookmark(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * List bookmarks for a session. In a workspace the whole team's annotations are
 * returned (scoped by the caller's own workspaceId — they can only ever query
 * their own workspace); solo researchers fall back to ownerUserId scoping.
 */
export async function listBookmarksBySession(
  scope: { ownerUserId: string; workspaceId?: string | null },
  sessionId: string,
  databases: Databases = db(),
): Promise<Bookmark[]> {
  const tenantFilter = scope.workspaceId
    ? Query.equal("workspaceId", scope.workspaceId)
    : Query.equal("ownerUserId", scope.ownerUserId);
  const result = await databases.listDocuments(DATABASE_ID, BOOKMARKS, [
    tenantFilter,
    Query.equal("sessionId", sessionId),
    Query.orderDesc("createdAt"),
    Query.limit(200),
  ]);
  const out: Bookmark[] = [];
  for (const raw of result.documents) {
    const parsed = parseBookmark(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

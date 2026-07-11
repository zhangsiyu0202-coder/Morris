import type { Databases } from "node-appwrite";
import { BookmarkSchema } from "@merism/contracts";
import type { Bookmark } from "@merism/contracts";
import { DATABASE_ID, getSessionDb, Query } from "./client";

const BOOKMARKS = "bookmarks";

function parseBookmark(raw: unknown): Bookmark | null {
  const parsed = BookmarkSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** List bookmarks the caller may read (owner + workspace team), newest first.
 * Reads via the session client — Appwrite enforces tenant isolation natively. */
export async function listBookmarksForTenant(
  limit = 50,
  databases?: Databases,
): Promise<Bookmark[]> {
  const dbx = databases ?? (await getSessionDb());
  const result = await dbx.listDocuments(DATABASE_ID, BOOKMARKS, [
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
 * List bookmarks for a session. Via the session client the whole team's
 * annotations are returned when the caller is a workspace member (Role.team),
 * else only the owner's (Role.user) — Appwrite enforces the tenant scope, so we
 * only filter by sessionId here.
 */
export async function listBookmarksBySession(
  sessionId: string,
  databases?: Databases,
): Promise<Bookmark[]> {
  const dbx = databases ?? (await getSessionDb());
  const result = await dbx.listDocuments(DATABASE_ID, BOOKMARKS, [
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

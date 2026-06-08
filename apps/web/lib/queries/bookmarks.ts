import type { Databases } from "node-appwrite";
import { BookmarkSchema } from "@merism/contracts";
import type { Bookmark } from "@merism/contracts";
import { DATABASE_ID, getServerClient, Query } from "./client";

const BOOKMARKS = "bookmarks";

function db(): Databases {
  return getServerClient().databases;
}

function parseBookmark(raw: unknown): Bookmark | null {
  const parsed = BookmarkSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** List bookmarks owned by `ownerUserId`, newest first. */
export async function listBookmarksForOwner(
  ownerUserId: string,
  limit = 50,
  databases: Databases = db(),
): Promise<Bookmark[]> {
  const result = await databases.listDocuments(DATABASE_ID, BOOKMARKS, [
    Query.equal("ownerUserId", ownerUserId),
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

/** List bookmarks for a session, scoped to owner. */
export async function listBookmarksBySession(
  ownerUserId: string,
  sessionId: string,
  databases: Databases = db(),
): Promise<Bookmark[]> {
  const result = await databases.listDocuments(DATABASE_ID, BOOKMARKS, [
    Query.equal("ownerUserId", ownerUserId),
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

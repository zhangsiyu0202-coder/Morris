/**
 * One-time, idempotent, non-destructive backfill of ADR-0006 tenancy fields
 * onto pre-workspace data, so existing studies and bookmarks become
 * workspace-shareable (read=team).
 *
 * For each owner that has an *active* workspace membership, it sets
 * `workspaceId` (and `authorId` when missing) on that owner's `surveys` and
 * `bookmarks` rows that don't yet have a `workspaceId`. Bookmarks additionally
 * get team-read document permissions to match `createBookmark`. Owners with no
 * workspace are left untouched (still solo). Rows already carrying a
 * `workspaceId` are skipped, so re-running is safe.
 *
 * Sessions/transcripts/recordings/reports are intentionally NOT backfilled:
 * the review surface authorizes at the study level and reads them by id, so
 * they don't need a workspaceId for team reads to work.
 *
 * Usage:
 *   set -a && . ./.env && set +a && pnpm exec tsx scripts/backfill-workspace-tenancy.ts
 */
import { Client, Databases, Permission, Query, Role } from "node-appwrite";

const DB = "merism";

const db = new Databases(
  new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT!)
    .setProject(process.env.APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!),
);

type Doc = Record<string, unknown> & { $id: string };

async function listAll(collection: string): Promise<Doc[]> {
  const out: Doc[] = [];
  let cursor: string | undefined;
  for (;;) {
    const queries = [Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const res = await db.listDocuments(DB, collection, queries);
    out.push(...(res.documents as Doc[]));
    if (res.documents.length < 100) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }
  return out;
}

async function main(): Promise<void> {
  // owner (Appwrite account $id) -> active workspaceId (first active membership)
  const ownerToWorkspace = new Map<string, string>();
  for (const m of await listAll("workspace_memberships")) {
    const userId = m.userId as string | undefined;
    const workspaceId = m.workspaceId as string | undefined;
    if (m.status === "active" && userId && workspaceId && !ownerToWorkspace.has(userId)) {
      ownerToWorkspace.set(userId, workspaceId);
    }
  }
  console.log(`[backfill] owners with an active workspace: ${ownerToWorkspace.size}`);
  if (ownerToWorkspace.size === 0) {
    console.log("[backfill] nothing to do — no workspaces exist yet (create one first).");
    return;
  }

  let surveys = 0;
  for (const s of await listAll("surveys")) {
    if (s.workspaceId) continue;
    const ws = ownerToWorkspace.get(s.ownerUserId as string);
    if (!ws) continue;
    const patch: Record<string, unknown> = { workspaceId: ws };
    if (!s.authorId) patch.authorId = s.ownerUserId;
    await db.updateDocument(DB, "surveys", s.$id, patch);
    surveys++;
  }

  let bookmarks = 0;
  for (const b of await listAll("bookmarks")) {
    if (b.workspaceId) continue;
    const ws = ownerToWorkspace.get(b.ownerUserId as string);
    if (!ws) continue;
    const author = (b.authorId as string | undefined) ?? (b.ownerUserId as string);
    const patch: Record<string, unknown> = { workspaceId: ws };
    if (!b.authorId) patch.authorId = author;
    await db.updateDocument(DB, "bookmarks", b.$id, patch, [
      Permission.read(Role.team(ws)),
      Permission.update(Role.user(author)),
      Permission.delete(Role.user(author)),
    ]);
    bookmarks++;
  }

  console.log(`[backfill] done: ${surveys} surveys, ${bookmarks} bookmarks updated.`);
}

main().catch((err) => {
  console.error("[backfill] failed:", err);
  process.exit(1);
});

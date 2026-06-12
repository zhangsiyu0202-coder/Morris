/**
 * One-time, idempotent, non-destructive backfill of ADR-0006 (B) tenancy +
 * document read permissions, so the web read layer can move to the user's
 * SESSION client (Appwrite enforces Role.team / Role.user natively) without any
 * existing row becoming unreadable.
 *
 * For every read collection it ensures each document carries:
 *   - read(user(author))            — author = authorId ?? ownerUserId
 *   - read(team(workspaceId))       — only when the row belongs to a workspace
 *   - update/delete(user(author))   — on owner-editable collections only
 * and sets `workspaceId`/`authorId` on the researcher-authored rows when the
 * owner has an active workspace and the field is missing.
 *
 * Tenancy for the interview artifacts (sessions/transcripts/recordings/reports)
 * is resolved from their parent survey (transcripts/recordings are keyed by
 * sessionId → session.surveyId → survey).
 *
 * Idempotent: re-running re-sets the same permissions (no-op effect) and skips
 * the field write when already present. Non-destructive: only adds/sets
 * permissions and the two tenancy fields, never deletes data.
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

/** read(user) + optional read(team); used by the read-only artifact collections. */
function readPerms(author: string | undefined, workspaceId: string | undefined): string[] {
  const perms: string[] = [];
  if (author) perms.push(Permission.read(Role.user(author)));
  if (workspaceId) perms.push(Permission.read(Role.team(workspaceId)));
  return perms;
}

/** read(user|team) + write(user(author)); used by the owner-editable collections. */
function ownerEditablePerms(author: string, workspaceId: string | undefined): string[] {
  return [
    ...readPerms(author, workspaceId),
    Permission.update(Role.user(author)),
    Permission.delete(Role.user(author)),
  ];
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

  // survey $id -> { author, workspaceId } so artifact rows can resolve tenancy.
  const surveyTenancy = new Map<string, { author: string; workspaceId?: string }>();

  // --- researcher-authored, owner-editable collections -----------------------
  let surveys = 0;
  for (const s of await listAll("surveys")) {
    const owner = s.ownerUserId as string;
    const author = (s.authorId as string | undefined) ?? owner;
    const ws = (s.workspaceId as string | undefined) ?? ownerToWorkspace.get(owner);
    surveyTenancy.set(s.$id, { author, workspaceId: ws });
    const fields: Record<string, unknown> = {};
    if (!s.workspaceId && ws) fields.workspaceId = ws;
    if (!s.authorId) fields.authorId = author;
    await db.updateDocument(DB, "surveys", s.$id, fields, ownerEditablePerms(author, ws));
    surveys++;
  }

  let notebooks = 0;
  for (const n of await listAll("notebooks")) {
    const owner = n.ownerUserId as string;
    const author = (n.authorId as string | undefined) ?? owner;
    const ws = (n.workspaceId as string | undefined) ?? ownerToWorkspace.get(owner);
    const fields: Record<string, unknown> = {};
    if (!n.workspaceId && ws) fields.workspaceId = ws;
    if (!n.authorId) fields.authorId = author;
    await db.updateDocument(DB, "notebooks", n.$id, fields, ownerEditablePerms(author, ws));
    notebooks++;
  }

  let bookmarks = 0;
  for (const b of await listAll("bookmarks")) {
    const owner = b.ownerUserId as string;
    const author = (b.authorId as string | undefined) ?? owner;
    // a bookmark belongs to its STUDY's workspace, not the author's current one
    const ws = (b.workspaceId as string | undefined) ?? surveyTenancy.get(b.surveyId as string)?.workspaceId;
    const fields: Record<string, unknown> = {};
    if (!b.workspaceId && ws) fields.workspaceId = ws;
    if (!b.authorId) fields.authorId = author;
    await db.updateDocument(DB, "bookmarks", b.$id, fields, ownerEditablePerms(author, ws));
    bookmarks++;
  }

  // --- read-only interview artifacts (tenancy resolved from parent survey) ---
  let reports = 0;
  for (const r of await listAll("analysis_reports")) {
    const t = surveyTenancy.get(r.surveyId as string);
    const author = (r.ownerUserId as string | undefined) ?? t?.author;
    await db.updateDocument(DB, "analysis_reports", r.$id, {}, readPerms(author, t?.workspaceId));
    reports++;
  }

  // session $id -> survey tenancy, so transcripts/recordings (keyed by sessionId) resolve.
  const sessionTenancy = new Map<string, { author?: string; workspaceId?: string }>();
  let sessions = 0;
  for (const sess of await listAll("interview_sessions")) {
    const t = surveyTenancy.get(sess.surveyId as string);
    sessionTenancy.set(sess.$id, t ?? {});
    await db.updateDocument(DB, "interview_sessions", sess.$id, {}, readPerms(t?.author, t?.workspaceId));
    sessions++;
  }

  let transcripts = 0;
  for (const tr of await listAll("transcripts")) {
    const t = sessionTenancy.get(tr.$id); // transcripts use sessionId as $id
    await db.updateDocument(DB, "transcripts", tr.$id, {}, readPerms(t?.author, t?.workspaceId));
    transcripts++;
  }

  let recordings = 0;
  for (const rec of await listAll("recordings")) {
    const t = sessionTenancy.get(rec.$id) ?? surveyTenancy.get(rec.surveyId as string);
    const author = (rec.ownerUserId as string | undefined) ?? t?.author;
    await db.updateDocument(DB, "recordings", rec.$id, {}, readPerms(author, t?.workspaceId));
    recordings++;
  }

  console.log(
    `[backfill] done: surveys=${surveys} notebooks=${notebooks} bookmarks=${bookmarks} ` +
      `reports=${reports} sessions=${sessions} transcripts=${transcripts} recordings=${recordings}`,
  );
}

main().catch((err) => {
  console.error("[backfill] failed:", err);
  process.exit(1);
});

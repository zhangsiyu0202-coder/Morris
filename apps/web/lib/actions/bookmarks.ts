"use server";

import { ID, Permission, Role } from "node-appwrite";
import { revalidatePath } from "next/cache";
import { DATABASE_ID, getServerClient } from "@/lib/queries/client";
import { requireOwnerUserId } from "@/lib/auth/owner";
import { getCurrentWorkspaceId } from "@/lib/auth/workspace";
import { normalizeBookmarkNote, normalizeBookmarkTags } from "@/lib/bookmarks/annotation";

const BOOKMARKS = "bookmarks";
const SURVEYS = "surveys";

/**
 * Resolve a caller's access to a survey for bookmark creation. Returns the
 * survey's `workspaceId` (the tenant the bookmark belongs to) when the caller
 * is the author or a member of the survey's workspace; "denied" otherwise.
 * Authorization is in code because server reads use the API key.
 */
async function resolveSurveyAccess(
  surveyId: string,
  userId: string,
  userWorkspaceId: string | null,
): Promise<{ workspaceId: string | null } | "denied"> {
  let doc: { ownerUserId?: string; authorId?: string; workspaceId?: string };
  try {
    doc = (await getServerClient().databases.getDocument(DATABASE_ID, SURVEYS, surveyId)) as {
      ownerUserId?: string;
      authorId?: string;
      workspaceId?: string;
    };
  } catch {
    return "denied";
  }
  const isAuthor = doc.ownerUserId === userId || doc.authorId === userId;
  const sameWorkspace = Boolean(
    doc.workspaceId && userWorkspaceId && doc.workspaceId === userWorkspaceId,
  );
  if (!isAuthor && !sameWorkspace) return "denied";
  return { workspaceId: doc.workspaceId ?? null };
}

export type CreateBookmarkInput = {
  surveyId: string;
  sessionId: string;
  quote: string;
  source: string;
  respondent: string;
  segmentIndex?: number;
  startMs?: number;
};

export async function createBookmark(
  input: CreateBookmarkInput,
): Promise<{ id: string } | { error: string }> {
  const surveyId = input.surveyId?.trim();
  const sessionId = input.sessionId?.trim();
  const quote = input.quote?.trim();
  const source = input.source?.trim();
  const respondent = input.respondent?.trim();

  if (!surveyId || !sessionId) return { error: "缺少调研或会话。" };
  if (!quote || quote.length < 2) return { error: "引用内容过短。" };
  if (!source || !respondent) return { error: "缺少来源或受访者标签。" };

  const ownerUserId = await requireOwnerUserId().catch(() => null);
  if (!ownerUserId) return { error: "请先登录。" };
  const callerWorkspaceId = await getCurrentWorkspaceId();
  const access = await resolveSurveyAccess(surveyId, ownerUserId, callerWorkspaceId);
  if (access === "denied") {
    return { error: "指定的调研不存在或不属于当前账户。" };
  }

  const id = ID.unique();
  const now = new Date().toISOString();
  // The bookmark belongs to the STUDY's workspace (so every member of that
  // study sees it), not the caller's current workspace. authorId is whoever
  // created it — may be a teammate, not the study owner.
  const workspaceId = access.workspaceId;
  const payload: Record<string, unknown> = {
    ownerUserId,
    authorId: ownerUserId,
    surveyId,
    sessionId,
    quote,
    source,
    respondent,
    createdAt: now,
  };
  if (workspaceId) payload.workspaceId = workspaceId;
  if (typeof input.segmentIndex === "number" && input.segmentIndex >= 0) {
    payload.segmentIndex = input.segmentIndex;
  }
  if (typeof input.startMs === "number" && input.startMs >= 0) {
    payload.startMs = input.startMs;
  }

  // In a workspace: the whole team can read the annotation, only the author can
  // edit/delete it (ADR-0006 read=team, write=author — same pattern as
  // createWorkspace's seat/quota docs). Solo (no workspace): owner-only.
  const permissions = workspaceId
    ? [
        Permission.read(Role.team(workspaceId)),
        Permission.update(Role.user(ownerUserId)),
        Permission.delete(Role.user(ownerUserId)),
      ]
    : [
        Permission.read(Role.user(ownerUserId)),
        Permission.update(Role.user(ownerUserId)),
        Permission.delete(Role.user(ownerUserId)),
      ];

  await getServerClient().databases.createDocument(DATABASE_ID, BOOKMARKS, id, payload, permissions);

  revalidatePath("/home");
  revalidatePath(`/studies/${surveyId}/results/${sessionId}`);
  return { id };
}

export async function deleteBookmark(id: string): Promise<{ ok: boolean } | { error: string }> {
  const bookmarkId = id?.trim();
  if (!bookmarkId) return { error: "无效的书签。" };

  const ownerUserId = await requireOwnerUserId().catch(() => null);
  if (!ownerUserId) return { error: "请先登录。" };

  // Read first to verify ownership; only the read may legitimately 404 (the
  // bookmark was already gone, e.g. a duplicate click). Other errors must
  // bubble — swallowing them hid network/permission failures behind the same
  // "not found" message and made the action impossible to debug from the UI.
  let doc: { ownerUserId?: string };
  try {
    doc = (await getServerClient().databases.getDocument(
      DATABASE_ID,
      BOOKMARKS,
      bookmarkId,
    )) as { ownerUserId?: string };
  } catch (error) {
    if (isAppwriteNotFound(error)) return { error: "书签不存在。" };
    throw error;
  }
  if (doc.ownerUserId !== ownerUserId) {
    return { error: "无权删除此书签。" };
  }

  try {
    await getServerClient().databases.deleteDocument(DATABASE_ID, BOOKMARKS, bookmarkId);
  } catch (error) {
    // Idempotent delete: if the doc was removed between our read and the delete,
    // treat as success. Anything else is a real failure and must surface.
    if (!isAppwriteNotFound(error)) throw error;
  }
  revalidatePath("/home");
  return { ok: true };
}

export type UpdateBookmarkInput = { note?: string; tags?: string[] };

/**
 * Update a bookmark's researcher annotation (free-text note and/or tags).
 * Owner-scoped: reads the doc first to verify ownership, then patches only the
 * provided fields. Note/tags are normalized (trim/dedupe/clamp) before write;
 * an empty patch is a no-op success. Only the read may legitimately 404 (the
 * bookmark was deleted concurrently) — other errors bubble per the try/catch
 * matrix rather than being masked as "not found".
 */
export async function updateBookmark(
  id: string,
  input: UpdateBookmarkInput,
): Promise<{ ok: true; note?: string; tags?: string[] } | { error: string }> {
  const bookmarkId = id?.trim();
  if (!bookmarkId) return { error: "无效的书签。" };

  const ownerUserId = await requireOwnerUserId().catch(() => null);
  if (!ownerUserId) return { error: "请先登录。" };

  let doc: { ownerUserId?: string; surveyId?: string; sessionId?: string };
  try {
    doc = (await getServerClient().databases.getDocument(
      DATABASE_ID,
      BOOKMARKS,
      bookmarkId,
    )) as { ownerUserId?: string; surveyId?: string; sessionId?: string };
  } catch (error) {
    if (isAppwriteNotFound(error)) return { error: "书签不存在。" };
    throw error;
  }
  if (doc.ownerUserId !== ownerUserId) {
    return { error: "无权修改此书签。" };
  }

  const normalizedNote = input.note !== undefined ? normalizeBookmarkNote(input.note) : undefined;
  const normalizedTags = input.tags !== undefined ? normalizeBookmarkTags(input.tags) : undefined;
  const payload: Record<string, unknown> = {};
  if (normalizedNote !== undefined) payload.note = normalizedNote;
  if (normalizedTags !== undefined) payload.tags = normalizedTags;
  if (Object.keys(payload).length === 0) return { ok: true };

  await getServerClient().databases.updateDocument(DATABASE_ID, BOOKMARKS, bookmarkId, payload);

  if (doc.surveyId && doc.sessionId) {
    revalidatePath(`/studies/${doc.surveyId}/results/${doc.sessionId}`);
  }
  // Echo the normalized values so the editor can reconcile its local state and
  // stop showing an unsaved-changes affordance after a successful save.
  return { ok: true, note: normalizedNote, tags: normalizedTags };
}

/**
 * Narrow check for Appwrite's "document_not_found" error shape (HTTP 404,
 * `code === 404` on the SDK exception). Avoid `instanceof AppwriteException`
 * to keep this file SDK-light.
 */
function isAppwriteNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const type = (error as { type?: unknown }).type;
  return code === 404 || type === "document_not_found";
}

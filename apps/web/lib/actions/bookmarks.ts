"use server";

import { ID, Permission, Role } from "node-appwrite";
import { revalidatePath } from "next/cache";
import { DATABASE_ID, getServerClient } from "@/lib/queries/client";
import { requireOwnerUserId } from "@/lib/owner";

const BOOKMARKS = "bookmarks";
const SURVEYS = "surveys";

async function assertSurveyOwned(surveyId: string, ownerUserId: string): Promise<boolean> {
  try {
    const doc = await getServerClient().databases.getDocument(DATABASE_ID, SURVEYS, surveyId);
    return (doc as { ownerUserId?: string }).ownerUserId === ownerUserId;
  } catch {
    return false;
  }
}

export type CreateBookmarkInput = {
  surveyId: string;
  sessionId: string;
  quote: string;
  source: string;
  respondent: string;
  segmentIndex?: number;
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
  if (!(await assertSurveyOwned(surveyId, ownerUserId))) {
    return { error: "指定的调研不存在或不属于当前账户。" };
  }

  const id = ID.unique();
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    ownerUserId,
    surveyId,
    sessionId,
    quote,
    source,
    respondent,
    createdAt: now,
  };
  if (typeof input.segmentIndex === "number" && input.segmentIndex >= 0) {
    payload.segmentIndex = input.segmentIndex;
  }

  await getServerClient().databases.createDocument(
    DATABASE_ID,
    BOOKMARKS,
    id,
    payload,
    [
      Permission.read(Role.user(ownerUserId)),
      Permission.update(Role.user(ownerUserId)),
      Permission.delete(Role.user(ownerUserId)),
    ],
  );

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

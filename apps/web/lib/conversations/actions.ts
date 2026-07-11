/**
 * Morris Conversation persistence — Server Actions
 * (per `.kiro/specs/morris-conversation-persistence/design.md` §5).
 *
 * 5 个 Server Actions:
 *  - createConversation()           — 起空 doc, 用户发第 1 条消息前调
 *  - saveMessages(id, messages[])   — useChat onFinish 调; 第 1 次触发 title 生成
 *  - listConversations()            — 历史抽屉 / HistoryPreview
 *  - loadConversation(id)           — 复刷 / 切换历史 conversation
 *  - deleteConversation(id)         — 历史抽屉删除按钮
 *
 * 错误码 (per errors-and-observability.md::error codes):
 *  - `not_signed_in`  → UI 跳登录
 *  - `not_authorized` → cross-owner / load 别人 conversation
 *  - `loadConversation` not found 返 null (不 throw, UI 重定向回起始页)
 */

"use server";

import { revalidatePath } from "next/cache";
import { createLogger } from "@merism/observability";
import type { ConversationListItem } from "@merism/contracts";
import { getCurrentUserId } from "@/lib/queries/auth";
import {
  createConversationDoc,
  deleteConversationDoc,
  listConversationsForOwner,
  loadConversationDoc,
  saveMessagesToDoc,
} from "./server";
import { generateConversationTitle } from "./title";

const log = createLogger("action.conversations");

export async function createConversation(): Promise<{ conversationId: string }> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const conversationId = await createConversationDoc({ ownerUserId });
  log.info("conversation.created", { conversationId, ownerUserId });
  return { conversationId };
}

export async function saveMessages(
  conversationId: string,
  messages: unknown[],
): Promise<{ ok: true }> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");

  const doc = await loadConversationDoc(conversationId);
  if (!doc || doc.ownerUserId !== ownerUserId) throw new Error("not_authorized");

  await saveMessagesToDoc(conversationId, messages);

  // R8 Title 自动生成 — fire-and-forget 不阻塞 onFinish.
  // 触发条件: 之前没 title 且本次写入是第 1 条 message (user 第一条).
  if (!doc.title && messages.length === 1) {
    void generateConversationTitle(conversationId, messages[0]).catch((err) =>
      log.warn("conversation.title.failed", {
        conversationId,
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return { ok: true };
}

export async function listConversations(): Promise<ConversationListItem[]> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  // design.md §11.4: limit=50 是经验值 (PostHog 同款); 超出靠下一个分页 sub-spec.
  return await listConversationsForOwner(ownerUserId, { limit: 50 });
}

export async function loadConversation(
  conversationId: string,
): Promise<{
  messages: unknown[];
  title: string;
  createdAt: string;
} | null> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");

  const doc = await loadConversationDoc(conversationId);
  if (!doc) return null;
  if (doc.ownerUserId !== ownerUserId) throw new Error("not_authorized");

  // design.md §5: messagesJson 是 JSON.stringify(UIMessage[]); 这里 parse 一次
  // 给 useChat({initialMessages}) 直接消费. parse 失败让它 throw — schema-level
  // K-CONV-01 已经保证写入的总是合法 JSON, 出错说明数据被外部破坏, 不能吞.
  const messages = JSON.parse(doc.messagesJson) as unknown[];
  return {
    messages,
    title: doc.title ?? "",
    createdAt: doc.createdAt,
  };
}

export async function deleteConversation(
  conversationId: string,
): Promise<{ ok: true }> {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");

  const doc = await loadConversationDoc(conversationId);
  if (!doc || doc.ownerUserId !== ownerUserId) throw new Error("not_authorized");

  await deleteConversationDoc(conversationId);
  log.info("conversation.deleted", { conversationId, ownerUserId });
  revalidatePath("/assistant");
  return { ok: true };
}

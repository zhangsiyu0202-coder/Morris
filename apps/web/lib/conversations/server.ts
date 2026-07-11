/**
 * Server-only Appwrite Databases helpers for the Morris Conversation
 * persistence (per `.kiro/specs/morris-conversation-persistence/design.md` §5).
 *
 * 这层是"node-appwrite SDK 与 Appwrite collection 的薄包装", 不含业务规则
 * (业务规则在 `./actions.ts` 那层做 `getCurrentUserId` 校验 + cross-owner
 * 拒绝). 仅这里能 import `node-appwrite`; 测试用 `vi.mock("./server", ...)`
 * 整体替换。
 *
 * 6 个导出 (与 design.md §5 例句对齐):
 *  - createConversationDoc({ ownerUserId })  → conversationId (空 doc)
 *  - loadConversationDoc(conversationId)     → Conversation | null
 *  - saveMessagesToDoc(conversationId, msgs) → 整批覆盖 messagesJson + 冗余字段
 *  - listConversationsForOwner(ownerUserId, { limit }) → ConversationListItem[]
 *  - deleteConversationDoc(conversationId)   → hard delete
 *  - saveTitle(conversationId, title)        → 单字段 update (title generator 用)
 */

import { Client, Databases, ID, Permission, Query, Role } from "node-appwrite";
import type { Conversation, ConversationListItem } from "@merism/contracts";
import {
  MAX_PREVIEW_LENGTH,
  MAX_TITLE_LENGTH,
} from "@merism/contracts";

const COLLECTION_ID = "conversations";

function databaseId(): string {
  return process.env.APPWRITE_DATABASE_ID ?? "merism";
}

function getServerKeyClient(): Databases {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  if (!endpoint || !projectId || !apiKey) {
    throw new Error("appwrite_not_configured");
  }
  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  return new Databases(client);
}

function ownerPermissions(ownerUserId: string): string[] {
  return [
    Permission.read(Role.user(ownerUserId)),
    Permission.update(Role.user(ownerUserId)),
    Permission.delete(Role.user(ownerUserId)),
  ];
}

/**
 * 从最后一条 UIMessage 抽 plain-text 摘要 (用作 `lastMessagePreview`).
 *
 * UIMessage 形态来自 Vercel AI SDK 6: `{ role, parts: [{ type, text? } | ...] }`.
 * 这里只关心 `type === "text"` 的 part — tool / reasoning / file 的非文本
 * payload 不渲染到列表卡片上. 失败 (msg 不是 object / 没 parts) 返 "".
 */
function extractPreview(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const m = msg as { parts?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(m.parts)) return "";
  const text = m.parts
    .filter((p) => p?.type === "text")
    .map((p) => p?.text ?? "")
    .join("")
    .trim();
  return text.slice(0, MAX_PREVIEW_LENGTH);
}

/**
 * 创建一条空 conversation. 返 Appwrite `$id`. 调用方负责: setCurrentId,
 * router.replace `?conversationId=$id`, 然后 useChat sendMessage → onFinish
 * 调 saveMessagesToDoc 写真实 messages.
 *
 * 初始 messagesJson="[]" + messageCount=0 — 与 ConversationSchema 的
 * K-CONV-02 (count === parse(json).length) 一致.
 */
export async function createConversationDoc({
  ownerUserId,
}: {
  ownerUserId: string;
}): Promise<string> {
  const db = getServerKeyClient();
  const $id = ID.unique();
  const now = new Date().toISOString();
  await db.createDocument(
    databaseId(),
    COLLECTION_ID,
    $id,
    {
      ownerUserId,
      title: "",
      messagesJson: "[]",
      messageCount: 0,
      lastMessageAt: now,
      lastMessagePreview: "",
      createdAt: now,
      updatedAt: now,
    },
    ownerPermissions(ownerUserId),
  );
  return $id;
}

/**
 * 拉一条 conversation. 返 null 表示不存在 (不 throw). 调用方在 actions.ts
 * 层判 `doc.ownerUserId !== currentUser` 做跨 owner 隔离 (Appwrite
 * documentSecurity 已经先一层拦截; 这里再校验一次防御).
 *
 * 不在这里 `ConversationSchema.parse` — schema 含 superRefine (parse 整份
 * messagesJson 检查 K-CONV-02), 256KB 文本每次 load 都全 parse 浪费; 让
 * 调用方按需 JSON.parse messagesJson 即可.
 */
export async function loadConversationDoc(
  conversationId: string,
): Promise<Conversation | null> {
  const db = getServerKeyClient();
  try {
    const doc = await db.getDocument(databaseId(), COLLECTION_ID, conversationId);
    return doc as unknown as Conversation;
  } catch (err) {
    // Appwrite 抛 AppwriteException with code=404 时表示 not found.
    // 其他错误 (网络 / 权限失败) 让它 propagate — 不能用 catch-all 吞错.
    const code = (err as { code?: number })?.code;
    if (code === 404) return null;
    throw err;
  }
}

/**
 * 整批覆盖 conversation.messagesJson + 同步 messageCount / lastMessageAt /
 * lastMessagePreview / updatedAt. design.md §11.6: saveMessages 不做
 * incremental — 每次 onFinish 写全量, 简单 + 与 useChat 状态机一致.
 */
export async function saveMessagesToDoc(
  conversationId: string,
  messages: unknown[],
): Promise<void> {
  const db = getServerKeyClient();
  const now = new Date().toISOString();
  const messagesJson = JSON.stringify(messages);
  const last = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastMessagePreview = last ? extractPreview(last) : "";
  await db.updateDocument(databaseId(), COLLECTION_ID, conversationId, {
    messagesJson,
    messageCount: messages.length,
    lastMessageAt: now,
    lastMessagePreview,
    updatedAt: now,
  });
}

/**
 * 列出某 ownerUserId 的 conversation, 按 lastMessageAt 倒序.
 *
 * 不返 messagesJson (列表查询 N+1 friendly — 卡片用 lastMessagePreview).
 * 用 `Query.select` 显式只取列表项字段, 节省网络 + parse 成本.
 */
export async function listConversationsForOwner(
  ownerUserId: string,
  opts: { limit: number },
): Promise<ConversationListItem[]> {
  const db = getServerKeyClient();
  const limit = Math.max(1, Math.min(opts.limit, 100));
  const result = await db.listDocuments(databaseId(), COLLECTION_ID, [
    Query.equal("ownerUserId", ownerUserId),
    Query.orderDesc("lastMessageAt"),
    Query.limit(limit),
    Query.select([
      "$id",
      "ownerUserId",
      "title",
      "messageCount",
      "lastMessageAt",
      "lastMessagePreview",
      "createdAt",
      "updatedAt",
    ]),
  ]);
  return result.documents.map((doc) => doc as unknown as ConversationListItem);
}

/**
 * Hard delete (design.md §11.5 — 与 Notebook 同模式; 没有 undo).
 */
export async function deleteConversationDoc(conversationId: string): Promise<void> {
  const db = getServerKeyClient();
  await db.deleteDocument(databaseId(), COLLECTION_ID, conversationId);
}

/**
 * 单字段 update — title generator (`./title.ts`) 异步生成完后回写. 截到
 * `MAX_TITLE_LENGTH` 防 LLM 输出超长 (zod superRefine 也会拒, 但这里早截
 * 一次少一次往返).
 */
export async function saveTitle(conversationId: string, title: string): Promise<void> {
  const db = getServerKeyClient();
  const safe = title.slice(0, MAX_TITLE_LENGTH);
  await db.updateDocument(databaseId(), COLLECTION_ID, conversationId, {
    title: safe,
    updatedAt: new Date().toISOString(),
  });
}

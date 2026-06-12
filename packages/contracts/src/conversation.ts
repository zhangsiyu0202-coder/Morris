import { z } from "zod";

/**
 * Morris Conversation persistence contract (per
 * `.kiro/specs/morris-conversation-persistence/`).
 *
 * 借鉴 PostHog Max AI `Conversation` Django model 的形态 (id / user / title /
 * messages_json / created_at / updated_at), 拒绝 22+ 字段 (team / agent_mode /
 * is_impersonated / share_token / sandbox / ...) 并新增 4 个我们 stack 特有
 * 的冗余字段 (messageCount / lastMessageAt / lastMessagePreview / updatedAt).
 * 详见 design.md §2.
 *
 * 单 owner, 单 thread. messagesJson 是 `JSON.stringify(UIMessage[])` (Vercel AI
 * SDK 6 UIMessage 数组) — 我们不强 typed 内部 UIMessage 结构 (text/tool/reasoning
 * 等 union 太宽 + 主版本变更会 breaking), 只校验"是数组" + "byte size 上限"
 * (K-CONV-01..03), round-trip 用 JSON.parse + JSON.stringify (PBT P-CONV-01).
 *
 * 不做 Python mirror — apps/agent (Python LiveKit Agent Worker, 受访者实时
 * 访谈链路) 不消费 Morris conversation 数据。Morris 自身是 Vercel AI SDK 6
 * ToolLoopAgent (Next.js Server runtime, TS), 是这个 schema 的唯一消费者。
 * 按 contracts.md::TS → Python mirror discipline 第二条 "agent 不需要时跳过
 * Python mirror, 留 comment 在 contracts.py 旁".
 */

/**
 * messagesJson 字符长度上限 (≈ 256KB).
 *
 * 64K tokens × 4 字符/token; conversation 真到这量级前端 compaction.ts (token
 * budget 12K) 会先做摘要, 256KB 是兜底。Appwrite string 存储靠 schema 那侧的
 * JSON_SIZE = 1_000_000 给上限, 这个 256KB 是契约层的早拦截。
 */
export const MAX_MESSAGES_JSON_BYTES = 256_000;

/** title 字符长度上限 (Title generator 5-7 字简体中文 + 安全余量). */
export const MAX_TITLE_LENGTH = 80;

/** lastMessagePreview 字符长度上限 (HistoryPreview 卡片显示用, 截首). */
export const MAX_PREVIEW_LENGTH = 240;

/**
 * Conversation entity (持久化在 Appwrite 的 `conversations` collection).
 *
 * 字段不变量 (binding):
 *  - K-CONV-01: messagesJson 必须是合法 JSON 字符串 + parse 后是 array
 *  - K-CONV-02: messageCount === JSON.parse(messagesJson).length
 *  - K-CONV-03: messagesJson.length <= MAX_MESSAGES_JSON_BYTES
 *
 * 字段含义见 design.md §2 / §4。
 */
export const ConversationSchema = z
  .object({
    $id: z.string(),
    ownerUserId: z.string(),
    /** Title generator 异步生成的 5-7 字摘要; 未生成时 ""; UI fallback "新对话". */
    title: z.string().max(MAX_TITLE_LENGTH).default(""),
    /** JSON.stringify(UIMessage[]) — Vercel AI SDK 6 UIMessage 数组. */
    messagesJson: z.string(),
    /** 消息数 (含 user + assistant), 列表查询无需展开 messagesJson. */
    messageCount: z.number().int().nonnegative(),
    /** 最后一条消息时间, 用于排序. */
    lastMessageAt: z.string().datetime(),
    /** 最后一条消息的 plain-text 摘要, 截首 MAX_PREVIEW_LENGTH 字符. */
    lastMessagePreview: z.string().max(MAX_PREVIEW_LENGTH).default(""),
    createdAt: z.string().datetime(),
    /** 自动随每次 saveMessages 更新 (Appwrite 没有原生 updatedAt, 显式存). */
    updatedAt: z.string().datetime(),
  })
  .superRefine((c, ctx) => {
    // K-CONV-03: byte size 上限早拦截 (parse 前抢做 — parse 256KB 会慢).
    if (c.messagesJson.length > MAX_MESSAGES_JSON_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messagesJson"],
        message: `messagesJson exceeds ${MAX_MESSAGES_JSON_BYTES} bytes (got ${c.messagesJson.length})`,
      });
      return;
    }
    // K-CONV-01: 必须是合法 JSON 字符串 + parse 后是 array
    let parsed: unknown;
    try {
      parsed = JSON.parse(c.messagesJson);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messagesJson"],
        message: "messagesJson is not valid JSON",
      });
      return;
    }
    if (!Array.isArray(parsed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messagesJson"],
        message: "messagesJson must be a JSON array",
      });
      return;
    }
    // K-CONV-02: messageCount 与 messagesJson 长度一致
    if (parsed.length !== c.messageCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messageCount"],
        message: `messageCount=${c.messageCount} mismatch with messagesJson length ${parsed.length}`,
      });
    }
  });

export type Conversation = z.infer<typeof ConversationSchema>;

/**
 * Conversation 列表项 schema (无 messagesJson — 列表查询用, N+1 friendly).
 *
 * `.omit` 之前要 unwrap superRefine, 否则 zod 在 effect 包裹后不能继续 omit。
 * 这里直接列出字段, 避免对 ZodEffects 做 omit。
 */
export const ConversationListItemSchema = z.object({
  $id: z.string(),
  ownerUserId: z.string(),
  title: z.string().max(MAX_TITLE_LENGTH).default(""),
  messageCount: z.number().int().nonnegative(),
  lastMessageAt: z.string().datetime(),
  lastMessagePreview: z.string().max(MAX_PREVIEW_LENGTH).default(""),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;

/**
 * API 请求 schema — Server Actions 入口校验用.
 *
 * UIMessage 内部 union 不强 typed (见上方文档说明); 只限制是数组 + 数量上限.
 * 数量上限 500 是经验值 — 单 conversation 真到 500 条之前 compaction 会先收敛.
 */
export const ConversationCreateRequestSchema = z.object({}).strict();
export type ConversationCreateRequest = z.infer<typeof ConversationCreateRequestSchema>;

export const ConversationSaveMessagesRequestSchema = z.object({
  conversationId: z.string().min(1),
  messages: z.array(z.unknown()).max(500),
});
export type ConversationSaveMessagesRequest = z.infer<
  typeof ConversationSaveMessagesRequestSchema
>;

export const ConversationDeleteRequestSchema = z.object({
  conversationId: z.string().min(1),
});
export type ConversationDeleteRequest = z.infer<typeof ConversationDeleteRequestSchema>;

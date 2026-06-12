# Morris Conversation Persistence — Design

## §1. Overview

```
┌─────────────────────────┐         ┌────────────────────────────┐
│ <Conversation>          │   POST  │ /api/assistant (route.ts)  │
│ useChat({initialMsgs})  │ ──────► │  ToolLoopAgent + stream    │
│ onFinish: saveMessages  │ ◄────── │  返回 UIMessageStream       │
└────────────┬────────────┘         └────────────────────────────┘
             │ saveMessages(id, msgs[])
             ▼
┌─────────────────────────┐         ┌────────────────────────────┐
│ Server Action           │ ──────► │ Appwrite databases         │
│ apps/web/lib/           │         │ collection: conversations  │
│ conversations/actions.ts│         │ {id, ownerUserId,          │
│  + getCurrentUserId 校验 │         │  messagesJson, title,      │
│  + ownerUserId 校验      │         │  messageCount, lastMsg*}   │
└─────────────────────────┘         └────────────────────────────┘
             │
             │ async fire-and-forget
             ▼
┌─────────────────────────┐
│ generateConversationTitle│
│  withLLMCall(scope=     │
│  morris.title.generate) │
└─────────────────────────┘
```

数据流:
1. 用户首次进 /assistant → 起始页 (无 conversationId). HistoryPreview 显示最近 5 条 (Server Action listConversations 拉)
2. 用户发第 1 条消息 → 前端调 createConversation() 拿 id → URL `?conversationId=X` 浅路由 → useChat sendMessage 走原本流程 → onFinish 调 saveMessages(id, allMessages)
3. saveMessages 第一次执行时 → 检测 messageCount=1 → 异步 fire-and-forget 起 generateConversationTitle (不 block) → 完成后写回 title 字段
4. 用户刷新 / 复制 URL 给自己 / 点历史 → loadConversation(id) → useChat({initialMessages}) 渲染

## §2. PostHog 字段对照表 (32 字段中采纳 8 / 拒绝 22 + 4 新增)

PostHog `Conversation` Django model (`products/posthog_ai/backend/models/assistant.py`) 字段全集 (从 ee/api/conversation.py 读 + 推断):

| PostHog 字段 | 决定 | 我们对应 / 理由 |
|---|---|---|
| `id` (UUID) | 采纳 | `$id` (Appwrite 自动) |
| `user` FK | 采纳 | `ownerUserId: string` (Account $id) |
| `team` FK | **拒绝** | scope.md 永久禁 teams |
| `title` (varchar) | 采纳 | `title: string default ""` |
| `messages_json` (jsonb) | 采纳 | `messagesJson: string` (JSON.stringify UIMessage[]); 我们用 string + 64KB Appwrite default |
| `created_at` | 采纳 | `createdAt: datetime` |
| `updated_at` | 采纳 | `updatedAt: datetime` |
| `deleted` (bool soft delete) | **拒绝** | Appwrite 直接 hard delete; 与 Notebook 同模式 |
| `is_internal` (bool) | **拒绝** | 没有"内部对话"概念 (PostHog 是给客服 impersonation 用的) |
| `type` (enum: ASSISTANT/DEEP_RESEARCH/SLACK/TOOL_CALL) | **拒绝** | 我们只有 1 种; 未来 sub-agent 子 spec 再加 |
| `agent_mode` (7 modes) | **拒绝** | 单 mode |
| `slack_workspace_domain` | **拒绝** | 不接 Slack |
| `slack_thread_context` | **拒绝** | 不接 Slack |
| `is_impersonated` | **拒绝** | scope.md 禁 impersonation |
| `parent_conversation_id` | **拒绝** | sub-thread 不在本 spec |
| `sandbox_task_id` / `sandbox_run_id` | **拒绝** | 不接 sandbox |
| `approval_decisions` (jsonb) | **拒绝** | 当前 confirm 端点 501, 走 morris-tool-metadata::approval; 持久化等真接通了再加 |
| `pending_approvals_data` (jsonb) | **拒绝** | 同上 |
| `has_unsupported_content` (bool) | **拒绝** | 我们 schema 演进时直接 invalidate 旧 conversation, 不留兼容 flag |
| `share_token` | **拒绝** | scope.md 禁跨 owner 分享 |
| `share_views_count` | **拒绝** | 同上 |
| `metadata` (jsonb 散字段) | **拒绝** | 不留 jsonb bucket; 字段固化 |
| `messages` 全局 attribute (跨 deploy 兼容) | **拒绝** | 只用 messagesJson; 兼容性靠 contracts 版本 |
| LangGraph checkpoint 4 张表 | **拒绝** | 我们用 useChat 序列化 UIMessage[], 不引入 LangGraph |
| Conversation queue (Django cache) | **拒绝** | 单消息单回合, 不需要 queue |
| spend_history / billing_context | **拒绝** | scope.md 禁 |
| sessions backref | **拒绝** | 我们 Morris 不绑 InterviewSession |
| `tool_call_id` artifacts | **拒绝** | UIMessage parts 自带, 不另存 |

**新增 4 字段** (我们 stack 特有):
- `messageCount: int` — PostHog 用 SQL count(*); 我们直接冗余存, 列表查询无需展开 messagesJson
- `lastMessageAt: datetime` — 排序键
- `lastMessagePreview: string ≤ 240` — HistoryPreview 卡片用; PostHog 在 frontend 用 messagesJson[-1] 截 (我们也可以但要先反序列化, 列表查询 N 条会成 O(N) JSON.parse)
- `updatedAt: datetime` — Appwrite 没自动 updatedAt 字段, 显式存 (与 Notebook 一致)

## §3. 模块边界 (新增 12 文件)

```
packages/contracts/src/conversation.ts                    NEW (zod + types)
packages/contracts/test/conversation.test.ts              NEW (round-trip + invariants)

packages/appwrite-schema/src/schema.ts                    EDIT (+ conversations collection)

apps/web/lib/conversations/actions.ts                     NEW (5 Server Actions)
apps/web/lib/conversations/server.ts                      NEW (Appwrite databases helpers)
apps/web/lib/conversations/title.ts                       NEW (generateConversationTitle)
apps/web/lib/conversations/__tests__/actions.test.ts      NEW (≥ 15 用例)
apps/web/lib/conversations/__tests__/title.test.ts        NEW (3+ 用例)

apps/web/components/assistant/conversation.tsx            EDIT (接 conversationId prop + initialMessages + onFinish)
apps/web/components/assistant/conversation-history.tsx    NEW (历史抽屉)
apps/web/components/assistant/history-preview.tsx         NEW (起始页底部卡片)
apps/web/components/assistant/assistant-dock.tsx          EDIT (header 加 历史 + 新对话 按钮 + 同步 conversationId 状态)
apps/web/app/assistant/page.tsx                           EDIT (读 ?conversationId= query param + initialMessages)

tests/properties/morris-conversation-persistence/         NEW
  ├ messages-roundtrip.test.ts                            (P-CONV-01)
  ├ owner-isolation.test.ts                               (P-CONV-02)
  └ message-count-invariant.test.ts                       (P-CONV-03)

.kiro/steering/architecture.md                            EDIT (加 "Morris 对话持久化" 行)
apps/web/AGENTS.md                                        EDIT (加 Conversation persistence 段)
README.md                                                 EDIT (加 sub-spec roadmap 行)
```

## §4. ConversationSchema (zod)

```typescript
// packages/contracts/src/conversation.ts

import { z } from "zod";

export const MAX_MESSAGES_JSON_BYTES = 256_000;
export const MAX_TITLE_LENGTH = 80;
export const MAX_PREVIEW_LENGTH = 240;

export const ConversationSchema = z
  .object({
    $id: z.string(),
    ownerUserId: z.string(),
    title: z.string().max(MAX_TITLE_LENGTH).default(""),
    messagesJson: z.string(), // JSON.stringify(UIMessage[])
    messageCount: z.number().int().nonnegative(),
    lastMessageAt: z.string().datetime(),
    lastMessagePreview: z.string().max(MAX_PREVIEW_LENGTH).default(""),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((c, ctx) => {
    // K-CONV-01: messagesJson 必须是合法 JSON 数组
    try {
      const parsed = JSON.parse(c.messagesJson);
      if (!Array.isArray(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["messagesJson"],
          message: "messagesJson must be a JSON array",
        });
      }
      // K-CONV-02: messageCount 与 messagesJson 长度一致
      if (Array.isArray(parsed) && parsed.length !== c.messageCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["messageCount"],
          message: `messageCount=${c.messageCount} mismatch with messagesJson length ${parsed.length}`,
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messagesJson"],
        message: "messagesJson is not valid JSON",
      });
    }
    // K-CONV-03: byte size 上限
    if (c.messagesJson.length > MAX_MESSAGES_JSON_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messagesJson"],
        message: `messagesJson exceeds ${MAX_MESSAGES_JSON_BYTES} bytes (got ${c.messagesJson.length})`,
      });
    }
  });

export type Conversation = z.infer<typeof ConversationSchema>;

// 列表项 (无 messagesJson)
export const ConversationListItemSchema = ConversationSchema.omit({
  messagesJson: true,
});
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;

// API 请求 schema
export const ConversationCreateRequestSchema = z.object({}).strict();

export const ConversationSaveMessagesRequestSchema = z.object({
  conversationId: z.string(),
  messages: z.array(z.unknown()).max(500), // UIMessage[] — 内层 Vercel AI SDK 6 自管
});

export const ConversationDeleteRequestSchema = z.object({
  conversationId: z.string(),
});
```

**为什么不强 typed UIMessage[]**: Vercel AI SDK 6 的 `UIMessage` 类型本身有 union (text/tool/reasoning/file/...), zod schema 化太重 + 主版本变更会 breaking; 我们只校验"是数组" + "byte size 上限". Round-trip 用 JSON.parse + JSON.stringify (PBT P-CONV-01 验证).

## §5. Server Actions 实现

```typescript
// apps/web/lib/conversations/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/queries/auth";
import {
  createConversationDoc,
  loadConversationDoc,
  saveMessagesToDoc,
  listConversationsForOwner,
  deleteConversationDoc,
} from "./server";
import { generateConversationTitle } from "./title";
import { createLogger } from "@merism/observability";

const log = createLogger("action.conversations");

export async function createConversation() {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const conversationId = await createConversationDoc({ ownerUserId });
  log.info("conversation.created", { conversationId, ownerUserId });
  return { conversationId };
}

export async function saveMessages(conversationId: string, messages: unknown[]) {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const doc = await loadConversationDoc(conversationId);
  if (!doc || doc.ownerUserId !== ownerUserId) throw new Error("not_authorized");
  await saveMessagesToDoc(conversationId, messages);

  // R8: Title 自动生成 — fire-and-forget 不阻塞
  if (!doc.title && messages.length === 1) {
    void generateConversationTitle(conversationId, messages[0]).catch((err) =>
      log.warn("conversation.title.failed", { conversationId, err: String(err) }),
    );
  }
  return { ok: true as const };
}

export async function listConversations() {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  return await listConversationsForOwner(ownerUserId, { limit: 50 });
}

export async function loadConversation(conversationId: string) {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const doc = await loadConversationDoc(conversationId);
  if (!doc) return null;
  if (doc.ownerUserId !== ownerUserId) throw new Error("not_authorized");
  return {
    messages: JSON.parse(doc.messagesJson) as unknown[],
    title: doc.title,
    createdAt: doc.createdAt,
  };
}

export async function deleteConversation(conversationId: string) {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const doc = await loadConversationDoc(conversationId);
  if (!doc || doc.ownerUserId !== ownerUserId) throw new Error("not_authorized");
  await deleteConversationDoc(conversationId);
  revalidatePath("/assistant");
  return { ok: true as const };
}
```

错误处理 — 与 errors-and-observability.md::error codes 对齐:
- `not_signed_in`: 401 (UI 跳登录)
- `not_authorized`: 403 (UI 显 "Conversation 不存在或你无权访问")
- `not_found`: loadConversation 返 null (不是 throw, UI 重定向回起始页)
- `internal_error`: 默认 by withErrorBoundary

## §6. useChat hook 接持久化

```typescript
// apps/web/components/assistant/conversation.tsx (改造关键段)

"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createConversation, loadConversation, saveMessages } from "@/lib/conversations/actions";

export function Conversation({
  suggestions,
  compact = false,
  initialConversationId,
}: {
  suggestions?: string[];
  compact?: boolean;
  initialConversationId?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const conversationId = initialConversationId ?? params.get("conversationId") ?? null;

  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [loading, setLoading] = useState(!!conversationId);

  // mount 时若 URL 含 conversationId, 加载历史 messages
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    loadConversation(conversationId).then((data) => {
      if (cancelled) return;
      if (data) setInitialMessages(data.messages as UIMessage[]);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // 当前 conversation id (state, sendMessage 时若 null 先 createConversation)
  const [currentId, setCurrentId] = useState<string | null>(conversationId);

  const { messages, sendMessage, status, error, regenerate, clearError } = useChat({
    transport: new DefaultChatTransport({ api: "/api/assistant", prepareSendMessagesRequest }),
    initialMessages,
    onFinish: async () => {
      // 保存全量 messages (含最新 assistant 回复)
      if (currentId) {
        await saveMessages(currentId, messages).catch((e) =>
          console.warn("[assistant] saveMessages failed", e),
        );
      }
    },
  });

  async function submit(text: string) {
    let id = currentId;
    if (!id) {
      const { conversationId: newId } = await createConversation();
      id = newId;
      setCurrentId(newId);
      // 浅路由更新 URL, 不重渲染
      router.replace(`/assistant?conversationId=${newId}`, { scroll: false });
    }
    sendMessage({ text });
  }

  // ... 其余渲染逻辑
}
```

**关键决策**:
1. `currentId` 用 React state 保持 — 避免每次 send 都看 URL
2. 浅路由 `router.replace(..., { scroll: false })` — 不触发 layout 重渲染
3. `onFinish` 异步 saveMessages, 失败仅 console.warn 不抛 — 保 UX 流畅
4. 第一次 send 时同步等 createConversation (UI 显 spinner) — 避免 race

## §7. ConversationHistory + HistoryPreview UI

```typescript
// apps/web/components/assistant/conversation-history.tsx (新)

"use client";
import { useEffect, useState, useTransition } from "react";
import { listConversations, deleteConversation } from "@/lib/conversations/actions";
import type { ConversationListItem } from "@merism/contracts";
import { Trash2, MessageSquare } from "lucide-react";

export function ConversationHistory({
  currentId,
  onSelect,
}: {
  currentId: string | null;
  onSelect: (id: string) => void;
}) {
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    listConversations().then(setItems);
  }, []);

  return (
    <div className="flex flex-col gap-1 p-2">
      {items.length === 0 && (
        <p className="px-3 py-6 text-center font-ui text-body-sm text-ink-400">
          还没有对话历史. 试试给 Morris 发第一条消息.
        </p>
      )}
      {items.map((item) => (
        <button
          key={item.$id}
          className={`group flex items-center gap-2 rounded-sm px-3 py-2 text-left transition-colors hover:bg-mauve-50 ${
            currentId === item.$id ? "bg-mauve-100" : ""
          }`}
          onClick={() => onSelect(item.$id)}
        >
          <MessageSquare size={14} className="shrink-0 text-ink-400" />
          <div className="flex-1 min-w-0">
            <div className="truncate font-ui text-body-sm text-ink-900">
              {item.title || "新对话"}
            </div>
            <div className="font-ui text-caption text-ink-400">
              {item.messageCount} msgs · {relativeTime(item.lastMessageAt)}
            </div>
          </div>
          <button
            type="button"
            className="hidden size-7 items-center justify-center rounded-sm text-ink-400 opacity-0 transition-opacity hover:text-ink-900 group-hover:flex group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              startTransition(async () => {
                await deleteConversation(item.$id);
                setItems((prev) => prev.filter((i) => i.$id !== item.$id));
              });
            }}
            aria-label="删除"
          >
            <Trash2 size={14} />
          </button>
        </button>
      ))}
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}
```

`HistoryPreview` 类似但渲染卡片 (起始页用), 显示 title + lastMessagePreview 截 80 字.

## §8. Title 自动生成实现

```typescript
// apps/web/lib/conversations/title.ts
"use server";

import { generateText } from "ai";
import { CHAT_MODEL } from "@/lib/assistant/model";
import { withLLMCall, createLogger } from "@merism/observability";
import { saveTitle } from "./server";

const log = createLogger("action.conversations.title");

export async function generateConversationTitle(
  conversationId: string,
  firstUserMessage: unknown,
): Promise<void> {
  // firstUserMessage 是 UIMessage; 取 parts[].text 的 join
  const userText = extractText(firstUserMessage);
  if (!userText.trim()) return;

  const { text } = await withLLMCall(
    {
      scope: "morris.title.generate",
      traceId: log.traceId,
      defaultModel: "deepseek-chat",
    },
    () =>
      generateText({
        model: CHAT_MODEL,
        prompt:
          `用 5-7 字简体中文概括这个对话主题, 例如: "调研报告分析" / "用户访谈检索". 仅返回标题, 不加引号或解释.\n\n用户消息:\n${userText.slice(0, 500)}`,
        maxOutputTokens: 16,
      }),
  );

  const title = text.trim().slice(0, 80);
  if (title) {
    await saveTitle(conversationId, title);
    log.info("conversation.title.generated", { conversationId, title });
  }
}

function extractText(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const m = msg as { parts?: { type?: string; text?: string }[] };
  if (!Array.isArray(m.parts)) return "";
  return m.parts.filter((p) => p?.type === "text").map((p) => p.text ?? "").join("");
}
```

## §9. 测试设计 (4 layer)

### Layer 1 — 单元测试 (≥ 18 用例)

`packages/contracts/test/conversation.test.ts` (≥ 8 用例):
- K-CONV-01: messagesJson 必须是合法 JSON 数组
- K-CONV-02: messageCount === messagesJson.length
- K-CONV-03: messagesJson byte size ≤ 256KB
- K-CONV-04: title 长度 ≤ 80
- K-CONV-05: lastMessagePreview 长度 ≤ 240
- K-CONV-06: ConversationListItemSchema 是 ConversationSchema omit messagesJson
- K-CONV-07: ConversationSaveMessagesRequestSchema messages 数组 max 500
- K-CONV-08: round-trip parse(stringify) 等价

`apps/web/lib/conversations/__tests__/actions.test.ts` (≥ 12 用例, fake Appwrite):
- createConversation: not signed in → throw / signed in → returns id
- saveMessages: not signed in / not authorized / happy path / 第 1 条消息触发 title 生成
- listConversations: not signed in / 空列表 / 多条按 lastMessageAt desc
- loadConversation: not found returns null / cross-owner returns null (or throws? 由 design 决定 - 设为 not_authorized throw 与 saveMessages 一致)
- deleteConversation: not signed in / not authorized / happy path

`apps/web/lib/conversations/__tests__/title.test.ts` (3 用例):
- generateConversationTitle: 正常生成 5-7 字标题 / LLM 失败时不抛 (fire-and-forget) / 空 user message 跳过

### Layer 2 — Property tests (3 properties × 100 runs)

`tests/properties/morris-conversation-persistence/`:

**P-CONV-01: messages-roundtrip.test.ts** —
任意合法 UIMessage[] (用 fast-check 生成 mock parts: text/tool 各组合) → JSON.stringify → JSON.parse → deep equal 原数组. ConversationSchema.parse 不报错.

**P-CONV-02: owner-isolation.test.ts** —
fake Appwrite 模拟两个 ownerUserId; 任意 N 条 conversation 分配; user A 的 listConversations 永远不返回 user B 的; loadConversation(B 的 id) 永远 throws not_authorized 给 user A.

**P-CONV-03: message-count-invariant.test.ts** —
任意 messages: UIMessage[] 长度 0-50; saveMessages(id, messages) 后 doc.messageCount === messages.length 且 messagesJson parse 后长度也一致.

### Layer 3 — 集成测试 (mock Appwrite)

可选 (本 sub-spec 不强制): conversation.tsx 接 useChat 整流 — Vercel AI SDK 6 mockLanguageModelV3 + fake Appwrite, 验证 onFinish 调 saveMessages.

### Layer 4 — Live integration (留待将来)

需要 MERISM_LIVE_TESTS=1 + Docker stack; 跳过本 sprint.

## §10. 拒绝的备选方案

### A. LangGraph + Django checkpoint (PostHog 原生模式)
**拒绝理由**: ADR-0002 已锁 Vercel AI SDK 6 ToolLoopAgent. 引入 LangGraph 会:
- 需要 Python runtime (我们 Next.js Server 不能直接跑 LangGraph)
- 需要 Postgres (我们 Appwrite-only)
- 与 useChat hook 的状态机不兼容 (双状态机会冲突)

我们的等价方案: useChat 自己管 message state (内存) + onFinish 序列化 UIMessage[] 到 Appwrite. 不需要 graph state machine.

### B. 用 Appwrite Realtime 做 conversation 状态同步
**拒绝理由**:
- Appwrite Realtime 是 push-based, 适合受访者端 (interview-engine sub-spec); Morris 是 pull-based + on-demand
- 浪费 — conversation 是单 owner 单 thread, 不需要跨 client 实时同步
- 增加复杂度 (subscribe/unsubscribe 生命周期管理) 不带来用户价值

### C. 把 messages 拆成单独 messages collection (一对多)
**拒绝理由**:
- 列表查询 N+1 问题: 列 50 conversation 要 50+ 次 SDK 调用
- Appwrite 没原生 join, 必须前端做 N+1 fetch
- 我们 conversation 不长 (≤ 256KB ≈ 64 条复杂消息), 直接 JSON bucket 性价比最高
- 类似 Notebook 的 ProseMirror content 字段同模式 (单 doc 大字符串)

### D. 用 Vercel AI SDK 6 的 `useChatPersistence` (假设有)
**调研发现**: Vercel AI SDK 6 没有内置 persistence hook. 只有 `useChat({ initialMessages })` + 用户自己 onFinish 写存储. 我们走这条.

### E. URL 路由用 `/assistant/<id>` (segment) vs `?conversationId=<id>` (query)
**采纳 query**: 避免重新 layout, 用 router.replace shallow 即可同步. segment 路由对 layout reflow 更显式但代价大.

### F. 加 conversation soft delete (deleted: bool)
**拒绝理由**:
- Notebook 也是 hard delete (现有约定)
- 用户主动删意图明确 (与"我误点了"概率极低 — 有二次确认 dialog)
- 软删需要清理 cron, 复杂度不偿失

## §11. 边界 / 不变量

1. **Conversation 严格单 owner**: ownerUserId 永久绑创建者; 不支持 transfer / share. (与 scope.md 一致)
2. **messagesJson byte cap = 256KB**: 超过 → saveMessages throw; 前端 compaction.ts 的 token budget 12K 是上游, 256KB 是兜底. PBT P-CONV-01 不会生成超过 256KB 的样本.
3. **title 是 best-effort**: 失败留 ""; UI 永远 fallback "新对话". 不重试.
4. **listConversations 限 50 条**: 历史抽屉不分页; 第 51+ 条用户看不到 (将来加 cursor 分页 sub-spec). 50 是经验值 (PostHog 也是按 50 一页).
5. **deleteConversation 是 hard delete**: 删了就没了, 没有 undo.
6. **saveMessages 是整批覆盖**: 不做 incremental — 每次 onFinish 后写全量 messages. 简单 + 与 useChat 状态机一致.
7. **第一条消息流**: createConversation → setCurrentId → router.replace → sendMessage. 三步串行. 同步 await.
8. **跨 conversation 切换**: ConversationHistory.onSelect → router.replace + setInitialMessages 重新 mount Conversation 组件 (key={conversationId} 强制 remount, 否则 useChat 内部状态保留).
9. **无 conversationId 时**: useChat 内存运行, onFinish 不存; 用户必须发一条 + 自动 createConversation 才进入持久化.


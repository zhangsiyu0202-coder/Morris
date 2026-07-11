# Morris Conversation Persistence — Requirements

## 背景

借鉴 PostHog Max AI 的 `Conversation` 持久化模型 (Django `Conversation` table + 4 张 LangGraph checkpoint 表 + `/ai/<conversationId>` URL 分享 + `ConversationHistory` 抽屉 + `HistoryPreview` 起始页) — 但只借**形态**, 不借实现 (我们 stack 是 Vercel AI SDK 6 + Appwrite, 不是 LangGraph + Django + Postgres). 当前 Morris 用 `useChat` 内存态, 关 dock / 刷新即丢, 用户无法回看历史 / 分享对话 / 多 thread — 这是用户感"残缺"最强一处.

参考: `.kiro/specs/morris-conversation-persistence/design.md::§2 PostHog 字段对照表`.

## 范围

**包含**: Appwrite Conversation collection + contracts + Server Actions + useChat onFinish 回写 + initialMessages 加载 + URL `?conversationId=<id>` 路由 + ConversationHistory 抽屉 + HistoryPreview 起始页 + Conversation Title 自动生成 (异步 generateText).

**排除** (scope.md / ADR-0002 锁):
- LangGraph + Django checkpoint (4 张 checkpoint 表) — 我们用 useChat 直接序列化 UIMessage[] 到 messagesJson JSON bucket
- Conversation queue (Django cache 短期排队多消息) — 当前不需要, 用户单消息单回合
- 跨 thread / sub-thread / sub-agent — P2, 不在本 spec 范围
- 分享给其他研究员 (跨 owner 看) — scope.md 永久禁
- Memory / 长期记忆 — 拆出独立 sub-spec `morris-memory`
- Slash commands / Stop+Abort — 拆出 sub-spec `morris-sidebar-controls` (本 sprint 同期但独立)

## Requirements

### R1: Conversation 实体 schema (binding)

每个 Conversation 是一个 owner-scoped 的 doc, 含完整 UIMessage[] 序列与元数据.

字段集 (借 PostHog Conversation + 我们 stack 形态):
- `$id`: Appwrite document id (12-32 字符, alphanumeric)
- `ownerUserId`: 研究员 Account `$id`
- `title`: 5-7 字摘要 (Title generator 异步生成); 未生成时 `""` (UI 显示 fallback "新对话")
- `messagesJson`: `JSON.stringify(UIMessage[])` — Vercel AI SDK 6 UIMessage 数组 (parts[] 含 text/tool/reasoning 等)
- `messageCount`: int — 消息数 (含 user + assistant), 列表查询无需展开 messagesJson
- `lastMessageAt`: datetime — 最后一条消息时间, 用于排序
- `lastMessagePreview`: string ≤ 240 字符 — 最后一条消息的 plain text 摘要 (前缀 240 字符), 用于 HistoryPreview 卡片
- `createdAt`: datetime
- `updatedAt`: datetime — 自动随每次 saveMessage 更新

**不允许字段** (违反 scope 或 ADR):
- `permissions` 数组手动管 — 用 OWNER_SCOPED + documentSecurity, 与 Notebook 同模式
- `agentMode` — 当前单 mode, 不需要
- `billingContext` / `tokenSpend` — scope.md 禁
- `parentConversationId` — sub-thread 不在本 spec
- `sharedWith` / `visibility=published` — 跨 owner 不在 scope

### R2: contracts 与 Python mirror

`packages/contracts/src/conversation.ts` 新文件:
- `ConversationSchema` zod (含 superRefine 校验 messagesJson 是合法 JSON 且 length ≤ MAX_BYTES)
- `MAX_MESSAGES_JSON_BYTES = 256_000` (≈ 64K tokens × 4 字符/token; conversation 太长前端会先做 compaction)
- `ConversationListItemSchema` (无 messagesJson, 仅元数据 — 列表查询用)
- `ConversationCreateRequestSchema` / `ConversationSaveMessagesRequestSchema` / `ConversationDeleteRequestSchema`
- TS type `Conversation` / `ConversationListItem`

Python mirror **不做** — `apps/agent/` (Python LiveKit Agent Worker, 受访者实时访谈那条链路) 不消费 Morris conversation 数据. Morris 自身是 Vercel AI SDK 6 ToolLoopAgent (跑在 Next.js Server runtime, TS), 是这个 schema 的唯一消费者. 按 `contracts.md::TS → Python mirror discipline` 第二条 "agent 不需要时跳过 Python mirror, 留 comment 在 contracts.py 旁".

### R3: Appwrite schema 与权限

`packages/appwrite-schema/src/schema.ts` 加 `conversations` collection:
- `OWNER_SCOPED` 权限 (与 Notebook 同模式)
- `documentSecurity: true` (per-doc permissions pinned at creation)
- 5 个 indexes:
  - `by_owner` (key, ownerUserId)
  - `by_owner_lastmsg` (key, [ownerUserId, lastMessageAt]) — 历史抽屉按时间排序
  - `by_owner_created` (key, [ownerUserId, createdAt])
  - `by_owner_updated` (key, [ownerUserId, updatedAt])
  - `messageCount` 不建 index (低基数, 不查)

attribute 定义:
- `messagesJson`: string size = `JSON_SIZE` (Appwrite 64KB 默认)
- `title`: string size 256, default `""`
- `lastMessagePreview`: string size 256, default `""`
- `messageCount`: integer, default 0
- 其他 datetime / string 按 Notebook 标准

### R4: Server Actions

`apps/web/lib/conversations/actions.ts` 提供 5 个 Server Action (Next.js "use server"):

| Action | 输入 | 输出 | 用途 |
|---|---|---|---|
| `createConversation()` | 无 | `{ conversationId: string }` | 用户点 "新对话" 按钮时调; 创建空 doc + 返回 id (用于路由 `?conversationId=<id>`) |
| `saveMessages(conversationId, messages: UIMessage[])` | 全量 messages | `{ ok: true }` | useChat 的 `onFinish` callback 调; 整批覆盖 messagesJson + 更新 messageCount + lastMessage* |
| `listConversations()` | 无 | `ConversationListItem[]` | 历史抽屉拉列表; 按 lastMessageAt desc; 限 50 条 |
| `loadConversation(conversationId)` | id | `{ messages: UIMessage[], title, createdAt }` 或 `null` | URL `?conversationId=X` 时拉一份; 验证 ownerUserId 匹配 |
| `deleteConversation(conversationId)` | id | `{ ok: true }` | 历史抽屉中"删除"按钮 |

**校验**: 每个 action 入口处 `getCurrentUserId()` → null 则 throw `not_signed_in`. doc 拉到后比对 `ownerUserId === currentUserId`, 不匹配 → throw `not_authorized`. 所有 action 失败均通过 `withErrorBoundary` 形态 (与 errors-and-observability.md 一致).

### R5: useChat hook 接持久化

`apps/web/components/assistant/conversation.tsx` 改造:
- 接 prop `conversationId?: string`. 提供时 mount 时调 `loadConversation(id)` 拿到 messages, 喂 `useChat({ initialMessages })`.
- `useChat({ onFinish: (message) => saveMessages(conversationId, allMessages) })` 把每轮回合最终 messages 写回 Appwrite.
- 第一条 user 消息发送前若 conversationId 不存在, 调 `createConversation()` 拿到新 id, 再用 `router.replace("?conversationId=" + id)` 同步 URL (浅路由, 不重渲染).
- 失败保护: saveMessages 失败时本地保留 messages (不报错给用户), 后台 retry 一次 (3s 后), 仍失败则在 UI 顶部显示 "对话未保存" banner. 用户主动刷新会丢, 但流程不中断.

### R6: URL 路由 + 标准入口

- `/assistant?conversationId=<id>` 或 `/assistant/<id>` (route segment) — 任选一种, design.md 决定. 推荐 `?conversationId=` query param 因 Next.js shallow routing 简单, 不需要重新 layout.
- 当 query param `?conversationId=<id>` 不存在: 起始页 (Intro + Suggestions + HistoryPreview + 输入框).
- 当 query param 存在: 加载该 conversation, 渲染 thread.
- AssistantDock (右下浮窗) 和 /assistant 共享 conversation: dock 内 sendMessage 后, 用户点 "在独立页打开" link 跳过去看到同一 conversation.

### R7: ConversationHistory + HistoryPreview UI

借鉴 PostHog `ConversationHistory.tsx` (8KB) + `HistoryPreview.tsx` (4KB). UI 形态:

- **ConversationHistory** (sidebar 内顶部抽屉, 通过 header "历史" icon 切换):
  - 列表项: `[icon] {title or "新对话"} · {messageCount} msgs · {relativeTime}` + hover 显示删除按钮
  - 点击 → 切换当前 thread 到该 conversation (URL 同步更新)
  - 空态: "还没有对话历史. 试试给 Morris 发第一条消息."

- **HistoryPreview** (起始页底部, 仅当无 messages 时显示):
  - 最多 5 张卡片, 取最近 5 条 conversation
  - 每卡片: `{title} · {lastMessagePreview 截 80 字}` + 点击进入

**视觉规则** (.kiro/steering/design-system.md::Mauve Quiet):
- 列表项 hover 用 `bg-mauve-50`, active 用 `bg-mauve-100`
- 卡片用 `bg-ink-0` + `border-ink-200` + `rounded-md` + `shadow-sm`
- 删除按钮在 hover 时浮现, 用 outline 二次确认 dialog

### R8: Title 自动生成

借鉴 PostHog `TitleGeneratorNode` (LangGraph 单独节点). 在 Vercel AI SDK 6 stack 没有 graph 概念, 改成"async background task":

- `saveMessages` Server Action 在第一次写入时检测 `messageCount === 1 (只 1 条 user msg) || (messageCount === 2 && title === "")` 时, 触发 `generateConversationTitle(conversationId, firstUserMsg)` 异步 task (不 block 主流).
- `generateConversationTitle` 用 `withLLMCall({scope: "morris.title.generate"})` 包 generateText, prompt: "用 5-7 字简体中文概括这个对话主题, 例: '调研报告分析'. 仅返回标题, 不加引号." + user msg.
- 返回后 update `conversation.title` 字段. 失败 → 留 `""`, UI 用 "新对话" fallback.
- 不阻塞 saveMessages — 第一次保存返 ok 后用 `void generateConversationTitle(...)` fire-and-forget; errors 进 logger 不重试.

### R9: 文档同步

- `apps/web/AGENTS.md::Morris page assistant` 加新段 "Conversation persistence" — 描述 5 Server Action + URL 路由 + 起始页/历史 UI 形态.
- 根 `README.md::Sub-spec roadmap` 表加一行 `morris-conversation-persistence`.
- `.kiro/steering/architecture.md::Where new things go` 表加 "Morris 对话持久化" 行 (path `apps/web/lib/conversations/*`).

## 验收 checklist (10 项)

1. `pnpm -F @merism/contracts test` 绿: ConversationSchema round-trip + superRefine 校验 messagesJson size ≤ 256KB
2. `pnpm schema:apply --dry-run` 显示 +1 collection conversations + 5 indexes, 无 destructive change
3. 单元测试 ≥ 18 用例: 5 Server Actions 各 ≥ 3 用例 (happy + not signed in + not authorized) + saveMessages 失败 retry + Title 生成
4. PBT ≥ 3 properties:
   - P-CONV-01: messagesJson round-trip — 任意合法 UIMessage[] 序列化反序列化等价
   - P-CONV-02: ownerUserId 隔离 — 用户 A 永远 list 不到用户 B 的 conversation
   - P-CONV-03: messageCount = messages.length — saveMessages 后 doc 字段一致
5. `pnpm test` 全绿 (现有 615 + 新 18 = 633+)
6. `pnpm test:properties` 全绿 (现有 119 + 新 3 = 122+)
7. `pnpm scope-guard` OK
8. `pnpm -F web build` ✓
9. 手动验收: 浏览器打开 /assistant, 发 3 条消息, 刷新页面, 同 URL 看到 3 条消息保留. 点"新对话" → URL 切换到新 id, 起始页. 点历史抽屉中第一条 → 切回原 conversation.
10. URL `/assistant?conversationId=X` 复制粘贴到新 incognito 窗口 (登同一研究员账户): 看到该 conversation. 不同研究员 → 拒绝 (404 或 403, 由 design 决定具体语义).

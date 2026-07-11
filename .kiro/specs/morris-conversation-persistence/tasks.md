# Morris Conversation Persistence — Tasks

跨 4 个 Wave: A schema + Server Actions / B useChat 接 + 路由 / C 历史 UI / D 文档 + 回归.

## Wave A — Schema + contracts + Server Actions (基础设施层)

- [ ] **T1**: `packages/contracts/src/conversation.ts` — ConversationSchema (zod superRefine K-CONV-01..03) + ConversationListItemSchema + 3 个 API 请求 schema + types
- [ ] **T2**: `packages/contracts/src/index.ts` — re-export Conversation
- [ ] **T3**: `packages/contracts/test/conversation.test.ts` — 8 K-CONV-* 用例
- [ ] **T4**: `packages/appwrite-schema/src/schema.ts` — 加 `conversations` collection (OWNER_SCOPED + documentSecurity + 5 indexes)
- [ ] **T5**: `apps/web/lib/conversations/server.ts` — Appwrite SDK helpers (createConversationDoc / loadConversationDoc / saveMessagesToDoc / listConversationsForOwner / deleteConversationDoc / saveTitle)
- [ ] **T6**: `apps/web/lib/conversations/actions.ts` — 5 个 Server Actions ("use server", 含 getCurrentUserId 校验 + ownerUserId 比对)
- [ ] **T7**: `apps/web/lib/conversations/title.ts` — generateConversationTitle (用 withLLMCall + scope morris.title.generate)
- [ ] **T8**: `apps/web/lib/conversations/__tests__/actions.test.ts` — 12+ 用例 (5 actions × happy/not_signed_in/not_authorized)
- [ ] **T9**: `apps/web/lib/conversations/__tests__/title.test.ts` — 3 用例

## Wave B — useChat 接持久化 + URL 路由

- [ ] **T10**: `apps/web/components/assistant/conversation.tsx` — 接 conversationId prop + useChat({initialMessages, onFinish: saveMessages}) + 第一条消息时调 createConversation + router.replace
- [ ] **T11**: `apps/web/app/assistant/page.tsx` — 读 ?conversationId= query param, 服务端调 loadConversation, 把 initialMessages 传给 Conversation
- [ ] **T12**: `apps/web/components/assistant/assistant-dock.tsx` — header 加 "新对话" + 按钮; 点 → createConversation → router.push 到 /assistant?conversationId=newId

## Wave C — ConversationHistory + HistoryPreview UI

- [ ] **T13**: `apps/web/components/assistant/conversation-history.tsx` — 抽屉, 支持 onSelect + delete (二次确认 dialog)
- [ ] **T14**: `apps/web/components/assistant/history-preview.tsx` — 起始页底部 5 卡片
- [ ] **T15**: `apps/web/components/assistant/conversation.tsx` — 起始页加 HistoryPreview 渲染
- [ ] **T16**: `apps/web/components/assistant/assistant-dock.tsx` — header 加 "历史" 图标按钮, 切换抽屉显示

## Wave D — PBT + 文档 + 回归

- [ ] **T17**: `tests/properties/morris-conversation-persistence/messages-roundtrip.test.ts` — P-CONV-01
- [ ] **T18**: `tests/properties/morris-conversation-persistence/owner-isolation.test.ts` — P-CONV-02
- [ ] **T19**: `tests/properties/morris-conversation-persistence/message-count-invariant.test.ts` — P-CONV-03
- [ ] **T20**: `apps/web/AGENTS.md::Morris page assistant` — 加 "Conversation persistence" 段
- [ ] **T21**: `README.md::Sub-spec roadmap` — 加 morris-conversation-persistence 行
- [ ] **T22**: `.kiro/steering/architecture.md::Where new things go` — 加 "Morris 对话持久化" 行
- [ ] **T23**: `pnpm typecheck` 全绿
- [ ] **T24**: `pnpm test` 全绿 (615 + 18+ 新)
- [ ] **T25**: `pnpm test:properties` 全绿 (119 + 3 新)
- [ ] **T26**: `pnpm scope-guard` OK
- [ ] **T27**: `pnpm -F web build` ✓
- [ ] **T28**: `pnpm schema:apply --dry-run` 显示 +1 collection 无 destructive

## 验收 checklist (10 项, 同 requirements.md)

见 `requirements.md::验收 checklist (10 项)`.

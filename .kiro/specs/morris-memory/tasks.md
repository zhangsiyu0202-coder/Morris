# Morris Memory — Tasks

跨 4 个 Wave: A schema+contracts / B Server Actions+embed / C Tool+system prompt 接入 / D 文档+回归.

## Wave A — Contracts + Appwrite schema

- [ ] **T1**: `packages/contracts/src/memory.ts` — MorrisMemorySchema (zod superRefine K-MEM-01..03) + MorrisMemoryListItemSchema + ManageMemoriesActionSchema (5-action discriminated union) + types
- [ ] **T2**: `packages/contracts/src/index.ts` — re-export Memory
- [ ] **T3**: `packages/contracts/test/memory.test.ts` — 8 K-MEM-* 用例
- [ ] **T4**: `packages/appwrite-schema/src/schema.ts` — 加 morris_memories collection (OWNER_SCOPED + documentSecurity + 4 indexes)
- [ ] **T5**: `packages/appwrite-schema/test/schema.test.ts` — 24 → 25 collections

## Wave B — Server Actions + embed

- [ ] **T6**: `apps/web/lib/memories/server.ts` — Appwrite SDK helpers (createMemoryDoc / loadMemoryDoc / updateMemoryDoc / deleteMemoryDoc / listMemoriesForOwner / queryMemoriesByText / queryMemoriesByEmbedding / saveMemoryEmbedding) — 复用 getServerKeyClient pattern
- [ ] **T7**: `apps/web/lib/memories/embed.ts` — embedAndSaveMemory (Qwen DashScope) + cosineSearch helper. 复用 apps/web/lib/server/embedder-qwen.ts
- [ ] **T8**: `apps/web/lib/memories/actions.ts` — 5 Server Actions ("use server"). getCurrentUserId 校验 + cross-owner check
- [ ] **T9**: `apps/web/lib/memories/__tests__/actions.test.ts` — 12+ 用例 (vi.mock + dynamic factory)

## Wave C — Tool + system prompt 接入

- [ ] **T10**: `apps/web/lib/assistant/tools/manage-memories.ts` — Vercel AI SDK 6 tool + ToolMetadata
- [ ] **T11**: `apps/web/lib/assistant/tools.ts` — 注册 manageMemories 到 buildAssistantTools + buildAssistantToolMetadata
- [ ] **T12**: `apps/web/lib/assistant/tool-enrich-urls.ts` — 加 manageMemories 行 (无 enrichUrl, 占位)
- [ ] **T13**: `apps/web/lib/assistant/system-prompt.ts` — 加 LONG_TERM_MEMORY_HEADING + MEMORY_INSTRUCTION_LINE + renderMemories + buildSystemPrompt 接 memories arg
- [ ] **T14**: `apps/web/lib/assistant/agent.ts` — MorrisRequestContext 接 memories prop 传给 buildSystemPrompt
- [ ] **T15**: `apps/web/app/api/assistant/route.ts` — 调 listMemories({limit:20}) 并行 + buildAgentContext, 失败时 fallback 空数组 (向后兼容)

## Wave D — PBT + 文档 + 回归

- [ ] **T16**: `tests/properties/morris-memory/manage-memories-roundtrip.test.ts` — P-MEM-01
- [ ] **T17**: `tests/properties/morris-memory/owner-isolation.test.ts` — P-MEM-02
- [ ] **T18**: `tests/properties/morris-memory/metadata-keys-invariant.test.ts` — P-MEM-03
- [ ] **T19**: `apps/web/AGENTS.md::Morris page assistant` — 加 Memory binding 段
- [ ] **T20**: `README.md::Sub-spec roadmap` — 加 morris-memory 行
- [ ] **T21**: `.kiro/steering/architecture.md::Where new things go` — 加 "Morris 长期记忆" 行
- [ ] **T22**: `.kiro/steering/errors-and-observability.md::Wave B 接入清单` — 加 manageMemories tool LLM observability scope (`morris.tool.manageMemories`)
- [ ] **T23**: `pnpm typecheck` 全绿
- [ ] **T24**: `pnpm test` 全绿 (745 → 765+ 新单测)
- [ ] **T25**: `pnpm test:properties` 全绿 (129 → 132+)
- [ ] **T26**: `pnpm scope-guard` OK (memory.ts 注释含 "team" 加 ALLOW)
- [ ] **T27**: `pnpm -F web build` ✓
- [ ] **T28**: `pnpm schema:apply --dry-run` 显示 +1 collection morris_memories + 4 indexes 无 destructive

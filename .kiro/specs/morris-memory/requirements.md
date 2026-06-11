# Morris Memory — Requirements

## 背景

借鉴 PostHog Max AI 的 Memory 系统 (`ee/hogai/tools/manage_memories.py` + `ee/hogai/chat_agent/memory/nodes.py` + `MemoryCollectorNode`) — 让 Morris 跨对话记得用户偏好 / 调研习惯 / 业务背景. 当前 Morris 每次对话 fresh start, 用户每次都得重新解释 "我做 fintech 调研" / "我喜欢简短报告" / "我们公司主要做 onboarding".

**只借形态, 拒绝实现**:
- ✅ 借: Memory entity (content + metadata 标签 + embedding) + manageMemories tool 的 5 action union (create / query / update / delete / list)
- ❌ 拒: LangGraph 6 节点 onboarding flow (我们 Vercel AI SDK 6 ToolLoopAgent 没 graph), ClickHouse (我们 Appwrite-only), `MemoryCollectorNode` 子图 (Morris 没 sub-graph), team-shared memory (scope.md 永久禁 teams)

## 范围

**包含**:
- Appwrite `morris_memories` collection + contracts + 5 Server Actions
- `manageMemories` Morris tool (Vercel AI SDK 6) — 5 action discriminated union
- Qwen text-embedding-v3 复用 (与 Notebook 同) → 1024-dim cosine similarity 检索
- system prompt `<long_term_memory>` 段渲染当前 user 已存的 memories (启动时拉)
- `<workstyle>` 段加 binding "主动识别 + create 关键事实"
- 测试: 单元 + PBT + 集成

**排除**:
- Onboarding flow (PostHog 的 6 节点 LangGraph) — 我们靠 LLM 自主 create
- MemoryCollectorNode 子图 — 同上
- Team-shared memory / cross-owner — scope.md 禁
- Memory 编辑 UI (用户面板) — Wave 2 拓展; 本 sub-spec Wave A 只让 Morris 用 tool 操作
- Memory expire / archival / version history — P2

## Requirements

### R1: Memory 实体 schema (binding)

每个 Memory 是一个 owner-scoped 文档, 包含可被语义检索的内容 + 类型化 metadata.

字段:
- `$id`: Appwrite document id
- `ownerUserId`: 研究员 Account `$id` (永久绑创建者)
- `content`: 1-4000 字符的事实文本 (例: "用户主要做 fintech onboarding 研究, 偏好简短分析报告")
- `metadata`: JSON 标签 (例: `{ type: "preference", domain: "fintech" }`) — 借 PostHog `metadata` JSON 字段, 不强 typed
- `metadataKeys`: 冗余存 `Object.keys(metadata)` 数组 (Appwrite Query.contains 索引用; 列查询不需要展开 metadata)
- `embedding`: 1024-dim Qwen text-embedding-v3 向量 JSON-serialized
- `embeddingModel`: 模型 id (例 "text-embedding-v3") — 与 Notebook 同模式, 模型升级时 invalidate
- `createdAt`: ISO datetime
- `updatedAt`: ISO datetime

**不允许字段** (违反 scope / ADR):
- `teamId` / `sharedWith` — scope.md 永久禁
- `permissions` 数组手动管 — 用 OWNER_SCOPED + documentSecurity, 与 Notebook + Conversation 同模式
- `expiresAt` / `archivedAt` — 不在 P0
- `versionHistory` — 不做版本控制
- `conversationId` 关联 — memory 是 user-级, 不是 conversation-级

### R2: contracts (zod) + 不做 Python mirror

`packages/contracts/src/memory.ts`:
- `MorrisMemorySchema` zod (含 superRefine: content 非空, metadataKeys === Object.keys(metadata), embedding 是合法 JSON.stringify(number[]))
- `MEMORY_CONTENT_MAX = 4000`
- `MEMORY_METADATA_KEYS_MAX = 16` (单 memory 最多 16 个 metadata key)
- `MorrisMemoryListItemSchema` (omit embedding — 列查询不拉重字段)
- `ManageMemoriesActionSchema` discriminated union (create / query / update / delete / list)

**不做 Python mirror** — `apps/agent/` (Python LiveKit Agent Worker, 受访者实时访谈链路) 不消费 Morris memory. 同 `morris-conversation-persistence` 处理.

### R3: Appwrite schema + 权限

`packages/appwrite-schema/src/schema.ts` 加 `morris_memories` collection:
- `OWNER_SCOPED` + `documentSecurity: true`
- attributes: 与 Notebook + Conversation 同字段类型 + size 标准
  - `content`: string size 4000
  - `metadata`: string (JSON) size = JSON_SIZE
  - `metadataKeys`: string array, max 16 elements
  - `embedding`: string size 16_384 (与 Notebook 一致)
  - `embeddingModel`: string size 64
  - 标准 datetime / ownerUserId
- 4 indexes:
  - `by_owner` (key, ownerUserId)
  - `by_owner_updated` (key, [ownerUserId, updatedAt])
  - `by_metadata_keys` (key, metadataKeys) — Appwrite array index, 用于 Query.contains
  - `by_text_search` (fulltext, content) — fallback 给 embedding 不可用时

### R4: manageMemories Tool (Vercel AI SDK 6)

`apps/web/lib/assistant/tools/manage-memories.ts`. discriminated union 5 actions, 借鉴 PostHog `ManageMemoriesToolArgs`:

| Action | Input | Output | 说明 |
|---|---|---|---|
| `create` | `{ content: string; metadata?: object }` | `{ memoryId, snippet }` | 写新 memory + 异步生成 embedding |
| `query` | `{ queryText: string; metadataFilter?: object; limit?: number (default 5) }` | `{ matches: Array<{$id, content, metadata, score}> }` | embedding cosine top-N; embedding 不可用 → fulltext fallback |
| `update` | `{ memoryId: string; content?: string; metadata?: object }` | `{ ok: true }` | 改 content 触发 embedding 重算; updatedAt 自动更新 |
| `delete` | `{ memoryId: string }` | `{ ok: true }` | hard delete (无 undo, 与 Notebook/Conversation 同) |
| `list` | `{ metadataFilter?: object; limit?: number (default 20) }` | `{ items: MorrisMemoryListItem[] }` | 不拉 embedding; 用于 system prompt 启动时渲染 |

**Tool annotations** (per morris-tool-metadata):
- `create` / `update`: `destructive: false` (Wave A); 实际持久化但 LLM 可能误判时让用户对话中调整, 不阻断
- `delete`: `destructive: true` — 走 approval flow (现 confirm 端点 501, 等接通)
- `query` / `list`: `readOnly: true`

**Tool 描述给 LLM** (system prompt 部分, 借 PostHog `MANAGE_MEMORIES_TOOL_PROMPT`):
> "管理用户级长期记忆 — 跨对话保留的关键事实 (调研偏好 / 业务背景 / 技术约束). 主动调用: 当用户透露重要事实 (例 '我们做 fintech onboarding') 先 query 看是否已存, 不存则 create. 用户问起过往讨论时也 query."

### R5: Embedding 复用 + 检索 fallback

- 复用 `apps/web/lib/server/embedder-qwen.ts` (Notebook tool 已经用过 Qwen DashScope text-embedding-v3)
- create / update 触发 `void embedAndSaveMemory(memoryId, content)` fire-and-forget — 不阻塞工具响应
- query 时:
  1. 先 embed 查询文本拿 1024-dim 向量
  2. 拉用户全部 memories (含 embedding) — 当前规模 < 200 条 / user 用 in-memory cosine 足够
  3. 排序 top N + score 阈值 0.3
  4. 任何步骤 throw → fulltext fallback (`Query.search("content", queryText)`); response 加 `fallback: "scale-fulltext-only" | "embedding-error"` 字段
- 与 `searchAcrossNotebooks` 同模式 (该工具已经在 morris-tool-metadata sub-spec 落了 fallback)

### R6: System prompt 接入

`apps/web/lib/assistant/system-prompt.ts` 加新动态段:

```
<long_term_memory>
- {content of memory 1}
  metadata: {type=preference, domain=fintech}
- {content of memory 2}
  ...
(共 N 条; 完整管理用 manageMemories 工具)
</long_term_memory>
```

加载: `route.ts` 在 buildMorrisAgent 之前调 `listMemoriesForOwner(ownerUserId, { limit: 20 })`, 传给 buildSystemPrompt. 失败 (Appwrite 短暂故障) → 段省略 (向后兼容: prompt 不含该段时 LLM 也能正常工作).

`<workstyle>` 段加 1 条 binding:
> "重要事实主动 create memory: 用户透露调研偏好 / 业务背景 / 技术约束时, 先 query 看是否已存; 没存则 create. 不要在每次对话末显式问 '要保存吗', 静默 create + 让用户在 /memories 页 (Wave 2) 按需删除."

### R7: 测试

**Layer 1 单元** (≥ 16 用例):
- contracts: 8 K-MEM-* superRefine 用例 (content 非空 / metadataKeys 一致 / embedding 合法 / size 上限 / etc.)
- Server Actions: 5 actions × happy + not_signed_in + cross-owner = 12+ 用例
- manageMemories tool builder: 5 actions 各 1 用例

**Layer 2 PBT** (3 properties × 100 runs):
- P-MEM-01: ManageMemoriesActionSchema discriminated union round-trip
- P-MEM-02: Owner isolation — query 永不返他人 memory; update/delete cross-owner throw not_authorized
- P-MEM-03: list 返回的 metadataKeys 与 metadata 字段一致 (冗余字段不变 invariant)

**Layer 3 集成** (可选, Wave C 跳过): mock embedder + 验证 query / create round-trip

## 验收 checklist (10 项)

1. `pnpm -F @merism/contracts test` 含 8 K-MEM-* 全过
2. `pnpm schema:apply --dry-run` 显示 +1 collection morris_memories + 4 indexes 无 destructive
3. `pnpm test` 含 16+ 新单测全过 (现 745 → 760+)
4. `pnpm test:properties` 含 3 PBT × 100 runs 全过 (现 129 → 132+)
5. `pnpm scope-guard` OK (新 memory.ts 注释有 PostHog 借鉴 'team' 字段时挂 ALLOW)
6. `pnpm -F web build` ✓
7. 手动验收: 起 dev, 给 Morris 说 "我做 fintech onboarding 调研, 偏好简短报告"; Morris 调 manageMemories.create; 关 dock 重开新对话 → system prompt 含该 memory; 再问 "我之前提过什么?" → Morris 调 query 返回该 memory
8. Memory 存的 embedding 在 update content 时被重算
9. delete memory 走 approval (confirm 端点接通后) — 当前 confirm 501, Wave A 接受
10. `apps/web/AGENTS.md::Morris page assistant` 加 Memory binding 段; README sub-spec roadmap 加行; architecture.md::Where new things go 加行

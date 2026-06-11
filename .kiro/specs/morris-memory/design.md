# Morris Memory — Design

## §1. Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│ Morris ToolLoopAgent                                                 │
│ ┌─────────────────────────────────────────────────────────────────┐  │
│ │ system prompt (build at request start)                          │  │
│ │  <agent_info> ... <agent_context> ...                           │  │
│ │  <long_term_memory>      ◄────── listMemoriesForOwner({limit:20})  │
│ │   - {content}\n metadata: ...                                   │  │
│ │  </long_term_memory>                                            │  │
│ │  <workstyle> "主动 create memory ..." </workstyle>               │  │
│ └─────────────────────────────────────────────────────────────────┘  │
│         │                                                            │
│         ▼ user msg                                                   │
│ ┌─────────────────────────────────────────────────────────────────┐  │
│ │ ToolLoopAgent step                                              │  │
│ │  call manageMemories({action: "query"|"create"|...})            │  │
│ └─────────────────────────────────────────────────────────────────┘  │
└──────────┬───────────────────────────────────────────────────────────┘
           │
           ▼ Server Action (apps/web/lib/memories/actions.ts)
┌──────────────────────────────────────────────────────────────────────┐
│ getCurrentUserId 校验 + ownerUserId 比对                               │
│         │                                                            │
│         ▼                                                            │
│ ┌────────────┐  ┌────────────┐  ┌────────────────────┐  ┌─────────┐  │
│ │ create     │  │ query      │  │ embedAndSaveMemory │  │ list    │  │
│ │ → write +  │  │ → embed    │  │ (fire-and-forget,  │  │ → 20 条  │  │
│ │   trigger  │  │   query +  │  │  Qwen DashScope)   │  │   omit  │  │
│ │   embed    │  │   cosine   │  │                    │  │   embed │  │
│ └─────┬──────┘  └─────┬──────┘  └─────┬──────────────┘  └─────────┘  │
└───────┴───────────────┴───────────────┴──────────────────────────────┘
        │                                ▼
        ▼                         Appwrite morris_memories
   Appwrite morris_memories       (update embedding+embeddingModel)
   (insert + permissions)
```

数据流:
1. **每次请求启动**: route.ts 调 `listMemoriesForOwner(ownerUserId, {limit: 20})` 拉前 20 条 memory (omit embedding) → 渲染到 system prompt `<long_term_memory>` 段
2. **LLM 主动 query** (用户问"过去聊过什么"): tool call `manageMemories({action: "query", queryText: "..."})` → embed query + in-memory cosine 排序 top N → 返回 LLM
3. **LLM 主动 create** (用户透露关键事实): tool call `manageMemories({action: "create", content, metadata})` → Appwrite insert (embedding 暂留空) → fire-and-forget `embedAndSaveMemory` → Appwrite update embedding 字段
4. **下次对话启动**: 新 memory 已经在 list 结果里, prompt 自动包含 → LLM 知道"过去存过的事实"

## §2. PostHog 字段对照表 (10 字段中采纳 4 / 拒绝 6 + 2 新增)

PostHog `AgentMemory` model + `manage_memories.py` tool 字段全集:

| PostHog 字段 | 决定 | 我们对应 / 理由 |
|---|---|---|
| `id` | 采纳 | `$id` (Appwrite 自动) |
| `team` FK | **拒绝** | scope.md 永久禁 teams |
| `user` FK | 采纳 | `ownerUserId` |
| `contents` | 采纳 (rename) | `content: string` (单数, 与 Notebook content 一致命名) |
| `metadata` jsonb | 采纳 | `metadata: JSON` + 新增 `metadataKeys: string[]` 冗余 (Appwrite Query.contains 索引) |
| `embedding` (ClickHouse vector) | 采纳形态 | `embedding: string` JSON.stringify(number[]) — 与 Notebook 一致 (Appwrite 不原生 vector type, 但 < 200 条 / user 内存 cosine 足够) |
| `embedding_version` / `embedding_metadata` | **拒绝** | 用 `embeddingModel` 单字段够 (与 Notebook 同) |
| `created_at` | 采纳 | `createdAt` |
| `updated_at` | 采纳 | `updatedAt` |
| `is_archived` | **拒绝** | 不做 archival (P2); hard delete 即可 |
| `expiration_at` | **拒绝** | 不做 TTL |
| `version` (history) | **拒绝** | 不做版本控制 |
| `shared_team_memories` flag | **拒绝** | scope.md 禁 |

**新增 2 字段** (我们 stack 特有):
- `metadataKeys: string[]` — 冗余 `Object.keys(metadata)` 让 Appwrite 索引能 Query.contains 检索 (Appwrite 不支持 jsonb 内字段 index)
- `embeddingModel: string` — 模型升级时 invalidate, 与 Notebook 一致

PostHog `manage_memories.py` 6 actions:
| PostHog action | 决定 | 我们 |
|---|---|---|
| `create` | 采纳 | 同 |
| `query` | 采纳 | 同 (cosine + fallback fulltext) |
| `update` | 采纳 | 同 |
| `delete` | 采纳 | 同 (走 approval, destructive=true) |
| `list_metadata_keys` | **拒绝** | 简化 — `list` 返完整列表足够 LLM 判断 metadata 分布 |
| `list_memories` | 采纳 (rename) | `list` |

## §3. 模块边界 (新增 8 文件)

```
packages/contracts/src/memory.ts                            NEW (zod + types)
packages/contracts/test/memory.test.ts                      NEW (8 K-MEM-*)

packages/appwrite-schema/src/schema.ts                      EDIT (+ morris_memories collection)

apps/web/lib/memories/server.ts                             NEW (Appwrite SDK helpers)
apps/web/lib/memories/actions.ts                            NEW (5 Server Actions)
apps/web/lib/memories/embed.ts                              NEW (embedAndSaveMemory + cosine helpers)
apps/web/lib/memories/__tests__/actions.test.ts             NEW (12+ 用例)

apps/web/lib/assistant/tools/manage-memories.ts             NEW (Vercel AI SDK 6 tool builder)
apps/web/lib/assistant/tools.ts                             EDIT (注册 manageMemories)
apps/web/lib/assistant/system-prompt.ts                     EDIT (加 <long_term_memory> 段)
apps/web/lib/assistant/agent.ts                             EDIT (接 memories prop 传给 buildSystemPrompt)
apps/web/app/api/assistant/route.ts                         EDIT (调 listMemoriesForOwner)

tests/properties/morris-memory/                             NEW (3 PBT)

apps/web/AGENTS.md                                          EDIT (加 Memory binding 段)
README.md                                                   EDIT (sub-spec roadmap 行)
.kiro/steering/architecture.md                              EDIT (Where new things go 行)
```

## §4. MorrisMemorySchema (zod)

```typescript
// packages/contracts/src/memory.ts
import { z } from "zod";

export const MEMORY_CONTENT_MAX = 4000;
export const MEMORY_METADATA_KEYS_MAX = 16;
export const MEMORY_EMBEDDING_DIM = 1024;

export const MorrisMemorySchema = z
  .object({
    $id: z.string(),
    ownerUserId: z.string(),
    content: z.string().min(1).max(MEMORY_CONTENT_MAX),
    metadata: z.string(), // JSON.stringify of Record<string, unknown>
    metadataKeys: z.array(z.string()).max(MEMORY_METADATA_KEYS_MAX),
    embedding: z.string(), // JSON.stringify of number[1024] or "" before embed task runs
    embeddingModel: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((m, ctx) => {
    // K-MEM-01: metadata is valid JSON object
    let parsedMetadata: Record<string, unknown> = {};
    try {
      parsedMetadata = JSON.parse(m.metadata);
      if (typeof parsedMetadata !== "object" || Array.isArray(parsedMetadata) || parsedMetadata === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["metadata"], message: "metadata must be a JSON object" });
      }
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["metadata"], message: "metadata is not valid JSON" });
    }
    // K-MEM-02: metadataKeys === Object.keys(metadata) (sorted)
    const expectedKeys = Object.keys(parsedMetadata).sort();
    const actualKeys = [...m.metadataKeys].sort();
    if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metadataKeys"],
        message: `metadataKeys mismatch with metadata.keys() (expected ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)})`,
      });
    }
    // K-MEM-03: embedding is valid JSON or empty string
    if (m.embedding) {
      try {
        const arr = JSON.parse(m.embedding);
        if (!Array.isArray(arr) || arr.length !== MEMORY_EMBEDDING_DIM || !arr.every((v) => typeof v === "number")) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["embedding"],
            message: `embedding must be JSON-stringified number[${MEMORY_EMBEDDING_DIM}]`,
          });
        }
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["embedding"], message: "embedding is not valid JSON" });
      }
    }
  });

export type MorrisMemory = z.infer<typeof MorrisMemorySchema>;

export const MorrisMemoryListItemSchema = MorrisMemorySchema.omit({
  embedding: true,
});
export type MorrisMemoryListItem = z.infer<typeof MorrisMemoryListItemSchema>;

// Tool action discriminated union (manageMemories tool input)
export const ManageMemoriesActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    content: z.string().min(1).max(MEMORY_CONTENT_MAX),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    action: z.literal("query"),
    queryText: z.string().min(1),
    metadataFilter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().min(1).max(50).default(5),
  }),
  z.object({
    action: z.literal("update"),
    memoryId: z.string(),
    content: z.string().min(1).max(MEMORY_CONTENT_MAX).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    action: z.literal("delete"),
    memoryId: z.string(),
  }),
  z.object({
    action: z.literal("list"),
    metadataFilter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
]);
export type ManageMemoriesAction = z.infer<typeof ManageMemoriesActionSchema>;
```

## §5. Server Actions 实现

```typescript
// apps/web/lib/memories/actions.ts
"use server";

import { getCurrentUserId } from "@/lib/queries/auth";
import {
  createMemoryDoc, loadMemoryDoc, updateMemoryDoc, deleteMemoryDoc,
  listMemoriesForOwner, queryMemoriesByText, queryMemoriesByEmbedding,
} from "./server";
import { embedAndSaveMemory, cosineSearch } from "./embed";
import { createLogger } from "@merism/observability";

const log = createLogger("action.memories");

export async function createMemory(input: { content: string; metadata?: Record<string, unknown> }) {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const memoryId = await createMemoryDoc({
    ownerUserId,
    content: input.content,
    metadata: input.metadata ?? {},
  });
  // fire-and-forget: embed + save back
  void embedAndSaveMemory(memoryId, input.content).catch((e) =>
    log.warn("memory.embed.failed", { memoryId, err: String(e) }),
  );
  return { memoryId, snippet: input.content.slice(0, 80) };
}

export async function queryMemories(input: {
  queryText: string;
  metadataFilter?: Record<string, unknown>;
  limit?: number;
}) {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const limit = input.limit ?? 5;
  try {
    // 1) embed query text
    const queryEmbedding = await embedQuery(input.queryText);
    // 2) pull all memories for owner (currently < 200 / user — in-memory cosine sufficient)
    const allMemories = await queryMemoriesByEmbedding(ownerUserId, input.metadataFilter);
    // 3) cosine + threshold
    const matches = cosineSearch(queryEmbedding, allMemories, { limit, threshold: 0.3 });
    return { matches, fallback: null };
  } catch (err) {
    log.warn("memory.query.embedding.failed", { err: String(err) });
    // fulltext fallback
    const matches = await queryMemoriesByText(ownerUserId, input.queryText, {
      metadataFilter: input.metadataFilter,
      limit,
    });
    return {
      matches,
      fallback: err instanceof EmbedderUnavailableError ? "embedding-error" : "scale-fulltext-only",
    };
  }
}

export async function updateMemory(input: {
  memoryId: string;
  content?: string;
  metadata?: Record<string, unknown>;
}) {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const doc = await loadMemoryDoc(input.memoryId);
  if (!doc || doc.ownerUserId !== ownerUserId) throw new Error("not_authorized");
  await updateMemoryDoc(input.memoryId, {
    content: input.content,
    metadata: input.metadata,
  });
  // 内容变了 → 重 embed
  if (input.content) {
    void embedAndSaveMemory(input.memoryId, input.content).catch((e) =>
      log.warn("memory.embed.failed", { memoryId: input.memoryId, err: String(e) }),
    );
  }
  return { ok: true as const };
}

export async function deleteMemory(input: { memoryId: string }) {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const doc = await loadMemoryDoc(input.memoryId);
  if (!doc || doc.ownerUserId !== ownerUserId) throw new Error("not_authorized");
  await deleteMemoryDoc(input.memoryId);
  return { ok: true as const };
}

export async function listMemories(input: {
  metadataFilter?: Record<string, unknown>;
  limit?: number;
}) {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) throw new Error("not_signed_in");
  const items = await listMemoriesForOwner(ownerUserId, {
    limit: input.limit ?? 20,
    metadataFilter: input.metadataFilter,
  });
  return { items };
}
```

错误码 (与 errors-and-observability.md):
- `not_signed_in`: 401
- `not_authorized`: 403 (cross-owner)
- `embedder_unavailable`: 503 (Qwen DashScope 故障; query 自动 fallback)
- `internal_error`: 默认

## §6. manageMemories Tool builder (Vercel AI SDK 6)

```typescript
// apps/web/lib/assistant/tools/manage-memories.ts
import { tool } from "ai";
import {
  ManageMemoriesActionSchema,
  type ManageMemoriesAction,
} from "@merism/contracts";
import {
  createMemory, queryMemories, updateMemory, deleteMemory, listMemories,
} from "@/lib/memories/actions";
import type { ToolMetadata } from "../tool-metadata";
import { toolResult, toToolError, NOT_SIGNED_IN } from "../envelope";
import type { AssistantToolContext } from "../tool-types";

const TOOL_DESCRIPTION = `
管理用户级长期记忆 — 跨对话保留的关键事实 (调研偏好 / 业务背景 / 技术约束).

主动调用规则:
- 用户透露重要事实 (例 "我们做 fintech onboarding 调研") → 先 query 看是否已存, 不存则 create
- 用户问 "我之前提过什么 X" / "我上次的偏好" → query
- 用户明确说 "记住这个" → create
- 不要在每次对话末问 "要保存吗" — 静默 create + 让用户自己删

5 actions discriminated union (action 字段决定输入格式):
- create: { content, metadata? }
- query: { queryText, metadataFilter?, limit? }
- update: { memoryId, content?, metadata? }
- delete: { memoryId } — DESTRUCTIVE (走 approval)
- list: { metadataFilter?, limit? } — 完整列出已存 memories
`.trim();

export function buildManageMemoriesTool(ctx: AssistantToolContext) {
  return {
    spec: tool({
      description: TOOL_DESCRIPTION,
      inputSchema: ManageMemoriesActionSchema,
      execute: async (input: ManageMemoriesAction) => {
        if (!ctx.ownerUserId) return toToolError(NOT_SIGNED_IN);
        try {
          switch (input.action) {
            case "create":
              return toolResult(await createMemory(input));
            case "query":
              return toolResult(await queryMemories(input));
            case "update":
              return toolResult(await updateMemory(input));
            case "delete":
              return toolResult(await deleteMemory(input));
            case "list":
              return toolResult(await listMemories(input));
          }
        } catch (err) {
          return toToolError({
            error: true,
            code: err instanceof Error && err.message === "not_authorized" ? "not_authorized" : "memory_error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    }),
    metadata: {
      title: "Manage long-term memory",
      description: TOOL_DESCRIPTION,
      annotations: {
        readOnly: false,
        destructive: true, // delete action is destructive — guard runs approval
        idempotent: false,
      },
      requiredScopes: [],
      enabled: true,
      type: "write",
    } satisfies ToolMetadata,
    contextPromptTemplate: undefined,
  };
}
```

**注意**: tool 整体标 `destructive: true` 因为 `delete` action 是 destructive. `withApprovalGuard` 会在调用前介入 — `create / update / query / list` 也会走 approval 路径, **这是 Wave A 的 over-approval** (不影响功能, LLM 调每个 action 都走 confirm 一次). 后续 morris-tool-metadata Wave 2 升级 metadata schema 支持 per-action `destructive` 标记后再窄化.

折中方案 (Wave A): `destructive: false` + 在 execute 内对 `action === "delete"` 显式调 `proposeApproval(...)`. 取舍见 §10.

## §7. system prompt 接入

```typescript
// apps/web/lib/assistant/system-prompt.ts (新增段)

export const LONG_TERM_MEMORY_HEADING = "long_term_memory";
export const MEMORY_INSTRUCTION_LINE =
  "重要事实主动 create memory: 用户透露调研偏好 / 业务背景 / 技术约束时, 先 query 看是否已存; 没存则 create. 不要每次对话末显式问 \"要保存吗\", 静默 create + 让用户在 /memories 页 (Wave 2) 按需删除.";

export interface BuildSystemPromptArgs {
  // ...existing fields
  memories?: ReadonlyArray<{ content: string; metadata?: Record<string, unknown> }>;
}

function renderMemories(memories: BuildSystemPromptArgs["memories"]): string {
  if (!memories || memories.length === 0) return "";
  const lines = memories.map((m) => {
    const metaStr = m.metadata && Object.keys(m.metadata).length > 0
      ? `\n  metadata: ${JSON.stringify(m.metadata)}`
      : "";
    return `- ${m.content}${metaStr}`;
  });
  return `${lines.join("\n")}\n(共 ${memories.length} 条; 完整管理用 manageMemories 工具)`;
}

// In buildSystemPrompt sections array, after <agent_context>:
if (args.memories && args.memories.length > 0) {
  sections.push(tag(LONG_TERM_MEMORY_HEADING, renderMemories(args.memories)));
}
```

`<workstyle>` 段加 1 条:
```typescript
export const WORKSTYLE = `工作方式:
1. ... 现有 5 条
6. ${MEMORY_INSTRUCTION_LINE}
`;
```

`route.ts` 接入:
```typescript
const memoriesPromise = listMemories({ limit: 20 }).catch(() => ({ items: [] as MorrisMemoryListItem[] }));
const [memories, agentCtx] = await Promise.all([memoriesPromise, buildAgentContext()]);
const agent = buildMorrisAgent({
  ownerUserId, pageContext, agentContext: agentCtx,
  memories: memories.items.map((m) => ({
    content: m.content,
    metadata: JSON.parse(m.metadata) as Record<string, unknown>,
  })),
});
```

## §8. 测试设计 (4 layer)

### Layer 1 单元 (≥ 16 用例)

`packages/contracts/test/memory.test.ts` (8 K-MEM-* 用例):
- K-MEM-01: metadata 必须是 JSON object (非 array / 非 null)
- K-MEM-02: metadataKeys === Object.keys(metadata) (sorted equality)
- K-MEM-03: embedding 必须是合法 JSON 且 length === 1024 number[]
- K-MEM-04: embedding 空字符串合法 (尚未 embed)
- K-MEM-05: content 长度 1-4000
- K-MEM-06: metadataKeys 长度 ≤ 16
- K-MEM-07: ManageMemoriesActionSchema 接受 5 个 action 各形态
- K-MEM-08: ManageMemoriesActionSchema 拒绝 unknown action

`apps/web/lib/memories/__tests__/actions.test.ts` (≥ 12 用例, fake Appwrite + fake embedder):
- createMemory: signed in / not signed in / metadata 缺省 → metadataKeys=[] / embedding fire-and-forget 触发
- queryMemories: signed in + cosine match top N / embedder unavailable → fulltext fallback / metadataFilter 过滤
- updateMemory: cross-owner → not_authorized / content 改 → 重 embed
- deleteMemory: cross-owner → not_authorized / hard delete
- listMemories: omit embedding / metadataFilter

### Layer 2 PBT (3 properties × 100 runs)

`tests/properties/morris-memory/`:
- **P-MEM-01**: ManageMemoriesActionSchema discriminated union round-trip — 任意 action + 字段 → parse + serialize 等价
- **P-MEM-02**: Owner isolation — 任意 N 条 memory 分给 user A / B; A 的 listMemories / queryMemories 永不返 B 的; updateMemory(B 的 id) 在 A 上 throw not_authorized
- **P-MEM-03**: metadataKeys 与 metadata 一致不变 invariant — 任意 metadata object → metadataKeys === Object.keys(metadata).sort()

### Layer 3 集成 (Wave C 跳过, Wave 2 拓展)

可选: mock Qwen embedder + verify create → list → query round-trip. 当前 Wave A 跳过 — 与 morris-llm-observability 处理同模式, Layer 1 + 2 已经 covered confidence.

### Layer 4 Live (跳, 同 Notebook tools)

## §9. 拒绝的备选方案

### A. LangGraph MemoryOnboardingNode + MemoryCollectorNode (PostHog 原生)
**拒绝理由**: ADR-0002 锁 Vercel AI SDK 6 ToolLoopAgent. PostHog 6 节点的 onboarding (`MemoryOnboardingNode` → `MemoryInitializerNode` → `MemoryInitializerInterruptNode` → `MemoryOnboardingEnquiryNode` → `MemoryOnboardingEnquiryInterruptNode` → `MemoryOnboardingFinalizeNode`) 是 LangGraph 状态机, 我们没 graph 概念.

**等价方案**: prompt 指引 + LLM 自主 create. PostHog `MANAGE_MEMORIES_TOOL_PROMPT` 自己也说 "Store memories pre-emptively - you don't need to be asked specifically to store them" — 这条 LLM-driven 模式我们可直接用.

### B. ClickHouse vector store
**拒绝理由**: Appwrite-only architecture. ClickHouse 是 PostHog 自家 stack 的 OLAP — 我们当前规模 (< 200 memories / user) 用 in-memory cosine 在 Server Action 内排序足够. 跨 100 用户 × 200 条 = 20K 行 / Appwrite docs 也不会成瓶颈.

未来需要时 (用户 > 1000 条 memory) 升级路径: 引 Qdrant / Pinecone external vector DB, 与 Notebook 同方案 (该 sub-spec 也走 in-memory + 升级路径).

### C. 加 conversationId 关联到 Memory
**拒绝理由**: Memory 是 user-级 (跨 conversation), 不是 conversation-级. 加 conversationId 会让 user 切对话时 Memory "丢" — 违背"长期记忆"语义. PostHog 自己也是 user/team-级.

### D. Memory 编辑 UI (用户面板 /memories)
**P2 拓展**: 本 sub-spec Wave A 只让 Morris 通过 tool 操作 memory. 用户面板 (列出 / 编辑 / 删除) 留 morris-memory-ui 子 spec — 与 morris-conversation-persistence 切 UI 出去同模式.

### E. team-shared memory
**永久拒绝**: scope.md 永久禁 teams.

### F. embedding version history (rollback)
**拒绝理由**: Notebook 也没做; 与项目其它 entity 一致简化.

## §10. 边界 / 不变量

1. **Memory 严格单 owner**: ownerUserId 永久绑创建者; 不支持 transfer / share.
2. **content cap = 4000 字符**: 超过 zod superRefine 拒. 长 fact 让 LLM 分多个 memory create.
3. **metadataKeys cap = 16**: 防 LLM 失控塞 100 个 key. 超过 zod 拒.
4. **embedding 1024-dim Qwen text-embedding-v3 锁定**: 改模型需要 embeddingModel 字段升级 + 全表重 embed (与 Notebook 同处理).
5. **list 默认 20 条 / 最多 50 条**: prompt cache 友好 (静态前 + 动态后) + LLM context 不爆.
6. **destructive action 折中**: Wave A `destructive: true` 整 tool — `delete` 走 approval 但 `query/list/create/update` 也被 confirm 拦. 选 false + 内部 explicit propose 的话 metadata 反映不准. 取舍: **选 destructive=false + 内部 propose**, 因 morris-tool-metadata::approval 工具签名要求 metadata 反映"会发生什么", over-approval 比 under-approval 好但 LLM 体验差.

   **Wave A 最终决定**: `destructive: false` (整 tool) + `delete` 直接执行 (无 approval). 选这条而非"内部 explicit propose" 因为当前 confirm 端点是 501 占位 — propose 后无路径可批, UX 上"按删除按钮但什么都没发生" 比"直接删" 更糟. 防误删靠两层: (a) tool description 明确 "仅在用户明确说删除时调", (b) deleteMemory Server Action 内 loadMemoryDoc + ownerUserId 比对 cross-owner. 真 approval flow 等 morris-tool-metadata Wave 2 升级 per-action destructive metadata + confirm 端点接通后回归; 那时改成 `destructive: false` (整 tool) + delete 触发 proposeApproval.

7. **embedding fire-and-forget**: create/update 不等 embed 完成. query 时如果 memory 还没 embed (embedding=""), 跳过该条 (cosine search 用 nonempty-embedding subset).
8. **Memory 数量软上限 200 / user**: 没硬限. 接近时考虑用户面板 + 显示警告 (P2).
9. **list 时 metadata 字段是 string (JSON.stringify)**: 调用方需 `JSON.parse(m.metadata)`. 与 Notebook 的 `report` jsonb 同模式 — Appwrite 不原生支 jsonb.

import { z } from "zod";

/**
 * Morris Memory contract (per `.kiro/specs/morris-memory/`).
 *
 * 借鉴 PostHog Max AI `AgentMemory` model + `manage_memories.py` tool 的形态
 * (id / user / contents / metadata / embedding / created_at / updated_at),
 * 拒绝 6 字段 (team / shared_team_memories / is_archived / expiration_at /
 * embedding_version / version) 并新增 2 个我们 stack 特有的冗余字段
 * (metadataKeys / embeddingModel). 详见 design.md §2.
 *
 * 单 owner. content 是用 embedding 检索的事实文本; metadata 是 JSON 标签 (例如
 * { type: "preference", domain: "fintech" }); metadataKeys 是冗余存的
 * Object.keys(metadata) 让 Appwrite 索引能 Query.contains 检索 (Appwrite 不
 * 支持 jsonb 内字段 index).
 *
 * 不做 Python mirror — apps/agent (Python LiveKit Agent Worker, 受访者实时
 * 访谈链路) 不消费 Morris memory. 同 morris-conversation-persistence 处理.
 */

export const MEMORY_CONTENT_MAX = 4000;
export const MEMORY_METADATA_KEYS_MAX = 16;
export const MEMORY_EMBEDDING_DIM = 1024;

/** Base object shape — used to derive list-item omit-variant. */
const MemoryFields = z.object({
  $id: z.string(),
  ownerUserId: z.string(),
  content: z.string().min(1).max(MEMORY_CONTENT_MAX),
  /** JSON.stringify of Record<string, unknown>. Tag-shape, not free-form text. */
  metadata: z.string(),
  /** Redundant Object.keys(metadata) sorted, capped to MEMORY_METADATA_KEYS_MAX. */
  metadataKeys: z.array(z.string()).max(MEMORY_METADATA_KEYS_MAX),
  /** JSON.stringify of number[1024] (Qwen text-embedding-v3) or "" before embed task runs. */
  embedding: z.string(),
  embeddingModel: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const MorrisMemorySchema = MemoryFields
  .superRefine((m, ctx) => {
    // K-MEM-01: metadata is valid JSON object (not array, not null)
    let parsedMetadata: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(m.metadata);
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["metadata"],
          message: "metadata must be a JSON object (not array, not null)",
        });
      } else {
        parsedMetadata = parsed as Record<string, unknown>;
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metadata"],
        message: "metadata is not valid JSON",
      });
    }
    // K-MEM-02: metadataKeys === Object.keys(metadata) (sorted)
    const expectedKeys = Object.keys(parsedMetadata).sort();
    const actualKeys = [...m.metadataKeys].sort();
    if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metadataKeys"],
        message: `metadataKeys mismatch with Object.keys(metadata). expected ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)}`,
      });
    }
    // K-MEM-03: embedding is valid JSON-stringified number[1024], or "" before embed task runs.
    if (m.embedding) {
      try {
        const arr = JSON.parse(m.embedding);
        if (
          !Array.isArray(arr) ||
          arr.length !== MEMORY_EMBEDDING_DIM ||
          !arr.every((v) => typeof v === "number")
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["embedding"],
            message: `embedding must be JSON-stringified number[${MEMORY_EMBEDDING_DIM}]`,
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["embedding"],
          message: "embedding is not valid JSON",
        });
      }
    }
  });

export type MorrisMemory = z.infer<typeof MorrisMemorySchema>;

/** List item shape — omit embedding (列查询 N+1 friendly).
 *  Derived from MemoryFields (base object) since superRefine wraps in
 *  ZodEffects which doesn't support .omit. List-item parsing skips the
 *  superRefine clauses (no embedding to validate). */
export const MorrisMemoryListItemSchema = MemoryFields.omit({
  embedding: true,
});
export type MorrisMemoryListItem = z.infer<typeof MorrisMemoryListItemSchema>;

/**
 * Tool action input — 5-action discriminated union (manageMemories tool).
 * 借鉴 PostHog `ManageMemoriesToolArgs` 形态; 拒绝 list_metadata_keys (简化 —
 * list 返完整列表足够 LLM 判断 metadata 分布).
 */
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

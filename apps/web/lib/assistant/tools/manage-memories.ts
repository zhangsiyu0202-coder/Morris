import { tool } from "ai";
import { z } from "zod";

import {
  ManageMemoriesActionSchema,
  type ManageMemoriesAction,
  type MorrisMemoryListItem,
} from "@merism/contracts";

import {
  createMemory,
  queryMemories,
  updateMemory,
  deleteMemory,
  listMemories,
} from "@/lib/memories/actions";

import {
  NOT_SIGNED_IN,
  toToolError,
  toolResult,
  type ToolResultEnvelope,
  type ToolErrorArtifact,
} from "../envelope";
import type { AssistantToolContext } from "../tool-types";
import type { ToolMetadata } from "../tool-metadata";

const TOOL_DESCRIPTION = `管理用户级长期记忆 — 跨对话保留的关键事实 (调研偏好 / 业务背景 / 技术约束).

主动调用规则:
- 用户透露重要事实 (例 "我们做 fintech onboarding 调研") → 先 query 看是否已存, 不存则 create
- 用户问 "我之前提过什么 X" / "我上次的偏好" → query
- 用户明确说 "记住这个" → create
- 不要在每次对话末问 "要保存吗" — 静默 create + 让用户在 /memories 页 (Wave 2) 按需删除

5 actions discriminated union (action 字段决定输入格式):
- create: { content, metadata? } — 写新 memory + 异步生成 embedding
- query: { queryText, metadataFilter?, limit? (default 5) } — embedding cosine 检索 (top N) + 失败时 fulltext fallback
- update: { memoryId, content?, metadata? } — content 改了会触发 embedding 重算
- delete: { memoryId } — DESTRUCTIVE, 直接执行 (无 undo). 仅在用户明确说"删除 X" / "我不要这条记忆了" 时调.
- list: { metadataFilter?, limit? (default 20) } — 完整列出已存 memories (不返 embedding)`.trim();

interface ManageMemoriesArtifact {
  action: ManageMemoriesAction["action"];
  // create
  memoryId?: string;
  snippet?: string;
  // query
  matches?: Array<{
    item: Omit<MorrisMemoryListItem, "embedding">;
    score: number | null;
  }>;
  fallback?: null | "embedding-error" | "scale-fulltext-only";
  // list
  items?: MorrisMemoryListItem[];
  // update / delete
  ok?: true;
}

/**
 * Morris manageMemories tool — 借鉴 PostHog `manage_memories.py`. 5 actions
 * discriminated union, full type-safe via @merism/contracts schema.
 *
 * Per-action approval (ADR-0009): `delete` action 通过 AI SDK 6 原生
 * `needsApproval: async ({input}) => input.action === "delete"` 触发研究员
 * 二次确认; `create` / `update` / `query` / `list` 直接执行。整 tool 的
 * `metadata.annotations.destructive` 仍是 `false`, 因为它描述的是"任意调用
 * 是否一定 destructive", 答案是否定 (4 个 action 是 read 或 append-only)。
 * destructive 语义由 needsApproval 在运行时按 input 分流, 不再依赖 metadata
 * 推导 — 早期 `.kiro/specs/morris-memory/design.md §10.6` 的"折中"(整 tool
 * destructive=false, delete 直接执行) 由本 ADR 取代。
 *
 * Ownership check + cross-owner 防护仍在 `deleteMemory` 内部 (loadMemoryDoc +
 * ownerUserId 比对, throw "not_authorized"), 与 approval 互为冗余 — 任一拒绝
 * 即可阻断。
 */
export function buildManageMemoriesTool(ctx: AssistantToolContext) {
  const { ownerUserId } = ctx;

  const metadata: ToolMetadata = {
    title: "管理长期记忆",
    description: TOOL_DESCRIPTION,
    annotations: {
      // 整 tool 不标 destructive — query/list/create/update 都非破坏性, delete
      // 是唯一破坏性 action 但已被 needsApproval per-action 拦下。把整 tool
      // 标 destructive 会让 readOnly query/list 也被过度 approve。
      readOnly: false,
      destructive: false,
      idempotent: false,
    },
    requiredScopes: ["memory:read", "memory:write"],
    type: "write",
    enabled: true,
  };

  // DeepSeek (and OpenAI-compatible APIs) reject JSON Schemas whose
  // top-level `type` is not "object" — and zod 3's z.discriminatedUnion
  // serialises to a plain `oneOf` with `type: null`. We therefore expose
  // a flat union-shaped object to the LLM, then re-parse the input
  // through the strict discriminated union at the start of execute().
  // This keeps the over-the-wire contract identical (per-action fields
  // remain validated) while giving the API a schema it accepts.
  const InputSchema = z.object({
    action: z.enum(["create", "query", "update", "delete", "list"]),
    content: z.string().optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    queryText: z.string().optional(),
    metadataFilter: z.record(z.string(), z.string()).optional(),
    limit: z.number().int().positive().optional(),
    memoryId: z.string().optional(),
  });
  type InputShape = z.infer<typeof InputSchema>;

  return {
    contextPromptTemplate: undefined as string | undefined,
    metadata,
    spec: tool({
      description: TOOL_DESCRIPTION,
      inputSchema: InputSchema,
      // AI SDK 6 原生 per-action approval (per ADR-0009): 仅 `delete` 触发
      // 研究员二次确认。create/update/query/list 直接执行。`input.action` 在
      // 这里是 flat union shape (与下面 execute 入参一致), AI SDK 把工具入参
      // 原样转给 needsApproval 与 execute, 因此判定是 "input.action === 'delete'"。
      needsApproval: async ({ action }: InputShape) => action === "delete",
      execute: async (
        rawInput: InputShape,
      ): Promise<ToolResultEnvelope<ManageMemoriesArtifact | ToolErrorArtifact>> => {
        if (!ownerUserId) return NOT_SIGNED_IN;
        const parsed = ManageMemoriesActionSchema.safeParse(rawInput);
        if (!parsed.success) {
          const detail = parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ");
          return toToolError("manageMemories 输入校验", new Error(detail));
        }
        const input = parsed.data;
        try {
          switch (input.action) {
            case "create": {
              const r = await createMemory({
                content: input.content,
                metadata: input.metadata,
              });
              return toolResult(
                `已记住: ${r.snippet}${r.truncated ? "..." : ""}`,
                {
                  action: "create" as const,
                  memoryId: r.memoryId,
                  snippet: r.snippet,
                },
              );
            }
            case "query": {
              const r = await queryMemories({
                queryText: input.queryText,
                metadataFilter: input.metadataFilter,
                limit: input.limit,
              });
              const summary =
                r.matches.length === 0
                  ? "未找到匹配的 memory"
                  : `${r.matches.length} 条匹配${r.fallback ? ` (fallback=${r.fallback})` : ""}`;
              return toolResult(summary, {
                action: "query" as const,
                matches: r.matches,
                fallback: r.fallback,
              });
            }
            case "update": {
              await updateMemory({
                memoryId: input.memoryId,
                content: input.content,
                metadata: input.metadata,
              });
              return toolResult(`已更新 memory ${input.memoryId}`, {
                action: "update" as const,
                ok: true as const,
              });
            }
            case "delete": {
              // 抵达这里时 AI SDK 的 needsApproval gate 已经放行 (用户点了"批准"),
              // 或工具被以 needsApproval=false 的姿势调用 (不应该发生 — 我们的
              // tool() 上 needsApproval 写死 `({action}) => action === "delete"`)。
              // ownership check 仍走 deleteMemory 内部 loadMemoryDoc + ownerUserId
              // 比对, 作为 approval 的冗余防护 (cross-owner 即使被"批准"也会被
              // 这层 throw "not_authorized" 拦下)。参 docs/adr/0009-aisdk-native-hitl-and-prune-messages.md。
              await deleteMemory({ memoryId: input.memoryId });
              return toolResult(`已删除 memory ${input.memoryId}`, {
                action: "delete" as const,
                ok: true as const,
              });
            }
            case "list": {
              const r = await listMemories({
                metadataFilter: input.metadataFilter,
                limit: input.limit,
              });
              return toolResult(`共 ${r.items.length} 条 memory`, {
                action: "list" as const,
                items: r.items,
              });
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === "not_authorized") {
            return toToolError("memory 操作", new Error("无权访问此 memory (cross-owner)"));
          }
          return toToolError("memory 操作", err);
        }
      },
    }),
  };
}

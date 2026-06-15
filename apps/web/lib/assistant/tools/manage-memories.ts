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
 * destructive metadata 折中 (design.md §10.6): 整 tool 标 `destructive: false`
 * 让 readOnly query/list 不被 over-approved. `delete` action 当前**直接执行**
 * (与实际 confirm 端点 501 占位保持代码-行为一致); 防误删通过 LLM prompt
 * 指引 (description 强调 "仅在用户明确说删除时调") + cross-owner ownership
 * check (loadMemoryDoc + ownerUserId 比对). 真 approval flow 留 morris-
 * tool-metadata Wave 2 引 per-action destructive metadata + confirm 端点接通
 * 后回归.
 */
export function buildManageMemoriesTool(ctx: AssistantToolContext) {
  const { ownerUserId } = ctx;

  const metadata: ToolMetadata = {
    title: "管理长期记忆",
    description: TOOL_DESCRIPTION,
    annotations: {
      // Tool overall is not destructive — write actions (create/update) are
      // recoverable + delete needs explicit approval flow per Wave 2.
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
              // 当前: 直接执行 (无 approval). 防误删靠 LLM prompt 指引 + ownership
              // check (deleteMemory 内部 loadMemoryDoc + ownerUserId 比对).
              // 真 approval flow 等 morris-tool-metadata Wave 2 + confirm 端点
              // 接通后回归 (per design.md §10.6).
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

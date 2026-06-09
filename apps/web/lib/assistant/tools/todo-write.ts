import { tool } from "ai";
import { z } from "zod";

import {
  toolResult,
  type ToolResultEnvelope,
} from "../envelope";
import type { TodoItem } from "../system-prompt";

const TodoItemSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  status: z.enum(["pending", "in_progress", "done"]),
  note: z.string().max(200).optional(),
});

export interface TodoState {
  get(): TodoItem[];
  set(next: TodoItem[]): void;
}

interface TodoWriteArtifact {
  todos: TodoItem[];
}

/**
 * `todoWrite` 元工具 (R7 / morris-agent-hardening).
 *
 * 整体覆盖当前请求的 todo 列表 (per-request 闭包内存, 非持久化)。新值写入后,
 * 下一步推理的 system prompt 会通过 `<current_todo>` 段把当前进度反映给模型。
 *
 * 不读 Appwrite, 未登录用户也能用。
 */
export function buildTodoWriteTool(args: { todoState: TodoState }) {
  const { todoState } = args;
  return {
    contextPromptTemplate: undefined as string | undefined,
    spec: tool({
      description:
        "写入或更新当前任务的 todo 列表 (整体覆盖)。用于跨多步任务追踪进度,每完成一步就重新调用并把状态推进。",
      inputSchema: z.object({
        todos: z.array(TodoItemSchema).max(20),
      }),
      execute: async ({ todos }): Promise<ToolResultEnvelope<TodoWriteArtifact>> => {
        const next: TodoItem[] = todos.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          ...(t.note !== undefined ? { note: t.note } : {}),
        }));
        todoState.set(next);
        return toolResult(`已更新 todo (${next.length} 项)。`, { todos: next });
      },
    }),
  };
}

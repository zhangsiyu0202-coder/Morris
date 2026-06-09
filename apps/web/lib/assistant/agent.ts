import { ToolLoopAgent, stepCountIs, type StopCondition } from "ai";
import {
  buildAssistantTools,
  buildToolContextTemplates,
  type AssistantTools,
} from "./tools";
import type { AssistantToolContext } from "./tool-types";
import { buildSystemPrompt, renderToolContexts, type TodoItem } from "./system-prompt";
import {
  EMPTY_PAGE_CONTEXT,
  type PageContext,
} from "./page-context";
import { CHAT_MODEL, REASONING_MODEL } from "./model";
import { hasPendingApproval } from "./approval";

/**
 * Morris researcher assistant — Vercel AI SDK 6 ToolLoopAgent.
 *
 * Per-request factory (`buildMorrisAgent(ctx)`) so each request gets tools
 * scoped to the signed-in researcher's identity. The route handler resolves
 * `ownerUserId` from the Appwrite cookie session and passes it here.
 *
 * LLM is fixed to DeepSeek (deepseek-chat with deepseek-reasoner as a
 * downgrade target on tool errors / late steps). See ADR-0002 for the stack
 * decision.
 */

const budgetExceeded: StopCondition<AssistantTools> = ({ steps }) => {
  const total = steps.reduce(
    (acc, step) => acc + (step.usage?.inputTokens ?? 0) + (step.usage?.outputTokens ?? 0),
    0,
  );
  return total > 24000;
};

function hadToolError(
  steps: ReadonlyArray<{ toolResults?: ReadonlyArray<{ output?: unknown }> }>,
): boolean {
  return steps.some((step) =>
    (step.toolResults ?? []).some((r) => {
      const out = r.output as
        | { error?: boolean; artifact?: { error?: boolean } }
        | null
        | undefined;
      return Boolean(
        out &&
          typeof out === "object" &&
          (out.error === true || out.artifact?.error === true),
      );
    }),
  );
}

/**
 * Morris 单次请求构造 agent 用的上下文。
 *
 * - `ownerUserId`: 由路由层从 Appwrite cookie session 解出, 传给工具集。
 * - `pageContext`: 客户端 PageContext, 由 PageContextSchema 在路由层校验后传入。
 *   暂时只是占位; Wave D 的 system prompt 拼接器落地后, 会把它喂给
 *   `<page_context>` 与各工具的 `<tool_context>` 段。
 */
export interface MorrisRequestContext extends AssistantToolContext {
  pageContext?: PageContext;
  initialTodos?: TodoItem[];
}

export function buildMorrisAgent(ctx: MorrisRequestContext) {
  const ownerCtx: AssistantToolContext = { ownerUserId: ctx.ownerUserId };
  const pageContext = ctx.pageContext ?? EMPTY_PAGE_CONTEXT;
  const toolContextTemplates = buildToolContextTemplates(ownerCtx);
  const toolContexts = renderToolContexts(pageContext, toolContextTemplates);

  // 闭包内 todos 状态: todoWrite 工具整体覆盖, 下一步 buildSystemPrompt 读最新值。
  let todos: TodoItem[] = ctx.initialTodos ? [...ctx.initialTodos] : [];
  const todoState = {
    get: () => todos,
    set: (next: TodoItem[]) => {
      todos = next;
    },
  };

  // ToolLoopAgent 的 instructions 不接受函数形态, 但 prepareStep 可以返回 system 覆盖。
  // 我们把"基础 system prompt"放在 instructions, 通过 prepareStep 的 system 字段
  // 在每步重渲染以反映最新 todos。
  const buildPrompt = () =>
    buildSystemPrompt({ todos: todoState.get(), pageContext, toolContexts });

  return new ToolLoopAgent({
    model: CHAT_MODEL,
    instructions: buildPrompt(),
    tools: buildAssistantTools({ ...ownerCtx, todoState }),
    stopWhen: [stepCountIs(8), budgetExceeded, hasPendingApproval],
    maxRetries: 2,
    prepareStep: async ({ stepNumber, steps, messages }) => {
      // 每步重渲染 system prompt 以反映最新 todos (R7)。
      // 真正的对话压缩 (R6) 在 route.ts 进入 createAgentUIStreamResponse 之前完成,
      // 这里只保留 ModelMessage 级的兜底截断与 reasoner 降级 (与 ADR-0002 一致)。
      const patch: {
        system?: string;
        model?: typeof CHAT_MODEL;
        messages?: typeof messages;
        toolChoice?: "none" | "auto";
      } = { system: buildPrompt() };
      if (messages.length > 48) patch.messages = messages.slice(-32);
      if (hadToolError(steps) || stepNumber >= 5) {
        patch.model = REASONING_MODEL;
        patch.toolChoice = "none";
      }
      return patch;
    },
  });
}

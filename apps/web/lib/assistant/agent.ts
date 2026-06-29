import { ToolLoopAgent, pruneMessages, stepCountIs, type ModelMessage, type StopCondition } from "ai";
import {
  buildAssistantTools,
  buildAssistantToolMetadata,
  buildToolContextTemplates,
  type AssistantTools,
} from "./tools";
import type { AssistantToolContext } from "./tool-types";
import { buildSystemPrompt, renderToolContexts, type TodoItem, type MemoryItem } from "./system-prompt";
import {
  EMPTY_PAGE_CONTEXT,
  type PageContext,
} from "./page-context";
import { CHAT_MODEL, REASONING_MODEL } from "./model";
import type { AgentContext } from "./agent-context";

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
 *
 * Tool approval: 走 AI SDK 6 原生 HITL — `createStudyDraft` 在登录态 `tool({
 * needsApproval: async () => true })`, SDK 在收到 LLM 的 tool call 时自动暂停
 * 并把 `tool-approval-request` part 流到客户端;客户端按钮调
 * `useChat.addToolApprovalResponse` 写回, `sendAutomaticallyWhen:
 * lastAssistantMessageIsCompleteWithApprovalResponses` 自动续接。我们不再有自
 * 写的 `hasPendingApproval` stopWhen / `withApprovalGuard` 套壳 / `/api/assistant/
 * confirm` 端点。参 https://ai-sdk.dev/cookbook/next/human-in-the-loop。
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
 * Approximate token count for a ModelMessage[] window. Per AI SDK 6 cookbook
 * (https://ai-sdk.dev/cookbook/guides/agent-context-compaction), `JSON.stringify(messages).length / 4`
 * is a deliberately rough estimate that's "good enough" for triggering compaction
 * — not a precise tokenizer. If we ever need tight token accounting we can swap
 * to a provider's token counter, but for compaction trigger the rough number
 * stays well under provider context limits with margin.
 */
function estimateModelMessageTokens(messages: ReadonlyArray<ModelMessage>): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

/** Token budget that triggers `pruneMessages` in `prepareStep`. */
const COMPACT_AFTER_TOKENS = 12_000;

/**
 * Morris 单次请求构造 agent 用的上下文。
 *
 * - `ownerUserId`: 由路由层从 Appwrite cookie session 解出, 传给工具集。
 * - `pageContext`: 客户端 PageContext, 由 PageContextSchema 在路由层校验后传入。
 *   暂时只是占位; Wave D 的 system prompt 拼接器落地后, 会把它喂给
 *   `<page_context>` 与各工具的 `<tool_context>` 段。
 * - `agentContext`: 当前研究员 / 项目 / 时间 / URL 模式 (P1-1, morris-conversation-persistence).
 *   由路由层在请求开始时 `await buildAgentContext()` 拿到。缺省时不渲染
 *   `<agent_context>` 段, 保留向后兼容。
 */
export interface MorrisRequestContext extends AssistantToolContext {
  pageContext?: PageContext;
  initialTodos?: TodoItem[];
  agentContext?: AgentContext;
  memories?: ReadonlyArray<MemoryItem>;
}

export function buildMorrisAgent(ctx: MorrisRequestContext) {
  const ownerCtx: AssistantToolContext = { ownerUserId: ctx.ownerUserId };
  const pageContext = ctx.pageContext ?? EMPTY_PAGE_CONTEXT;
  const agentContext = ctx.agentContext;
  const toolContextTemplates = buildToolContextTemplates(ownerCtx);
  const toolContexts = renderToolContexts(pageContext, toolContextTemplates);

  // 工具 manifest: 给 system-prompt 的 <tools_overview> 段自动生成 (R2 §5 / morris-tool-metadata)。
  // 同一组 metadata 输入产出同一份字符串, 与 prompt cache 友好性兼容。
  const manifest = buildAssistantToolMetadata(ownerCtx);

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
    buildSystemPrompt({
      todos: todoState.get(),
      pageContext,
      toolContexts,
      manifest,
      agentContext,
    });

  return new ToolLoopAgent({
    model: CHAT_MODEL,
    instructions: buildPrompt(),
    tools: buildAssistantTools({ ...ownerCtx, todoState }),
    stopWhen: [stepCountIs(8), budgetExceeded],
    maxRetries: 2,
    prepareStep: async ({ stepNumber, steps, messages }) => {
      // 每步重渲染 system prompt 以反映最新 todos (R7)。
      const patch: {
        system?: string;
        model?: typeof CHAT_MODEL;
        messages?: typeof messages;
        toolChoice?: "none" | "auto";
      } = { system: buildPrompt() };

      // Token-budget-driven context compaction via official `pruneMessages`
      // (https://ai-sdk.dev/cookbook/guides/agent-context-compaction). 替换
      // 早期自写的 LLM-summarizer (compaction.ts::planCompaction + applyCompaction
      // + summarizeMessages) — 那套方案每次压缩多一次 DeepSeek 调用 + 摘要质量
      // 不稳定。pruneMessages 是**纯结构性裁剪** (删 reasoning + 老 tool calls),
      // 不调 LLM 即可控住 token 上限, 与 AI SDK 6 推荐用法对齐。
      if (estimateModelMessageTokens(messages) > COMPACT_AFTER_TOKENS) {
        patch.messages = pruneMessages({
          messages,
          reasoning: "all",
          toolCalls: "before-last-3-messages",
          emptyMessages: "remove",
        });
      }

      if (hadToolError(steps) || stepNumber >= 5) {
        patch.model = REASONING_MODEL;
        patch.toolChoice = "none";
      }
      return patch;
    },
  });
}

import { Agent } from "@mastra/core/agent";
import { pruneMessages, type ModelMessage } from "ai";

import {
  buildAssistantTools,
  buildAssistantToolMetadata,
  buildToolContextTemplates,
} from "./tools";
import type { AssistantToolContext } from "./tool-types";
import {
  buildSystemPrompt,
  renderToolContexts,
  type TodoItem,
  type MemoryItem,
} from "./system-prompt";
import {
  EMPTY_PAGE_CONTEXT,
  type PageContext,
} from "./page-context";
import { CHAT_MODEL } from "./model";
import type { AgentContext } from "./agent-context";

/**
 * Morris researcher assistant — post ADR-0013 built on **Mastra `Agent`**.
 *
 * The prior Vercel AI SDK 6 `ToolLoopAgent` implementation was superseded by
 * ADR-0013 which unified the agent runtime across the realtime interview worker
 * and this page assistant. The realtime worker is now Python Gemini Live;
 * Morris itself remains Mastra.
 * the tool declarations still use AI SDK 6 `tool({...})` because Mastra
 * accepts VercelToolV5-shaped tools directly (`ToolsInput = Record<string,
 * ToolAction | VercelTool | VercelToolV5 | ProviderDefinedTool>`).
 *
 * Per-request factory (`buildMorrisAgent(ctx)`) so each request gets tools
 * scoped to the signed-in researcher's identity. The route handler resolves
 * `ownerUserId` from the Appwrite cookie session and passes it here.
 *
 * LLM is fixed to DeepSeek V4-Flash through the internal LiteLLM gateway.
 * Mastra does not choose a second model for tool-error recovery; workflow
 * behavior changes without changing the model identity.
 *
 * Tool approval (HITL): Mastra Agent supports it natively via each tool's
 * `needsApprovalFn` field on `ToolAction`. The AI SDK 6 `tool({ needsApproval })`
 * shape flows through to Mastra when tools are wrapped as `VercelToolV5`;
 * Mastra reads `needsApproval` from the underlying tool object at
 * tool-invocation time. HITL semantics are preserved end-to-end:
 * `createStudyDraft` (signed-in) and `manageMemories.delete` still pause the
 * agent loop for researcher approval; the client-side `useChat` handles the
 * `tool-approval-request` UI part unchanged.
 *
 * Streaming: the route handler pipes `agent.stream(messages)` through
 * `@mastra/ai-sdk`'s `toAISdkStream(..., { version: "v6" })` into `ai`'s
 * `createUIMessageStreamResponse`. Client `@ai-sdk/react` `useChat` +
 * `DefaultChatTransport` consumes the resulting v6 UI-message stream
 * unchanged.
 */

/**
 * Approximate token count for a ModelMessage[] window. Per AI SDK 6 cookbook
 * (https://ai-sdk.dev/cookbook/guides/agent-context-compaction),
 * `JSON.stringify(messages).length / 4` is a deliberately rough estimate
 * that's "good enough" for triggering compaction — not a precise tokenizer.
 * If we ever need tight token accounting we can swap to a provider's
 * counter, but for compaction trigger the rough number stays well under
 * provider context limits with margin.
 */
function estimateModelMessageTokens(messages: ReadonlyArray<ModelMessage>): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

/** Token budget that triggers `pruneMessages` in the pre-turn pass. */
const COMPACT_AFTER_TOKENS = 12_000;

/**
 * Route handler pass-through: prune the message window before it reaches
 * Mastra. Kept as a free function (rather than a Mastra hook) because
 * Mastra `Agent.stream` accepts a `MessageListInput`, so we prune upstream
 * and hand Mastra a clean list. Structural-only pruning per ADR-0009 —
 * never a second LLM call.
 */
export function pruneIfOverBudget(
  messages: ReadonlyArray<ModelMessage>,
): ModelMessage[] {
  if (estimateModelMessageTokens(messages) <= COMPACT_AFTER_TOKENS) {
    return [...messages];
  }
  return pruneMessages({
    messages: [...messages],
    reasoning: "all",
    toolCalls: "before-last-3-messages",
    emptyMessages: "remove",
  }) as ModelMessage[];
}

/**
 * Morris 单次请求构造 agent 用的上下文。
 *
 * - `ownerUserId`: 由路由层从 Appwrite cookie session 解出, 传给工具集。
 * - `pageContext`: 客户端 PageContext, 由 PageContextSchema 在路由层校验后传入。
 * - `agentContext`: 当前研究员 / 项目 / 时间 / URL 模式 (P1-1).
 * - `memories`: 长期记忆条目 (per morris-memory sub-spec).
 */
export interface MorrisRequestContext extends AssistantToolContext {
  pageContext?: PageContext;
  initialTodos?: TodoItem[];
  agentContext?: AgentContext;
  memories?: ReadonlyArray<MemoryItem>;
}

export function buildMorrisAgent(ctx: MorrisRequestContext) {
  const ownerCtx: AssistantToolContext = {
    ownerUserId: ctx.ownerUserId,
    workspace: ctx.workspace ?? null,
  };
  const pageContext = ctx.pageContext ?? EMPTY_PAGE_CONTEXT;
  const agentContext = ctx.agentContext;
  const toolContextTemplates = buildToolContextTemplates(ownerCtx);
  const toolContexts = renderToolContexts(pageContext, toolContextTemplates);
  const manifest = buildAssistantToolMetadata(ownerCtx);

  // Todos are still request-scoped and mutated by the `todoWrite` meta-tool.
  // The old ToolLoopAgent path recomputed the system prompt every step via
  // `prepareStep`; Mastra Agent's `instructions` supports a
  // `DynamicArgument` shape (function form) that Mastra invokes per turn,
  // so we can preserve the "instructions reflect the latest todos" behavior.
  let todos: TodoItem[] = ctx.initialTodos ? [...ctx.initialTodos] : [];
  const todoState = {
    get: () => todos,
    set: (next: TodoItem[]) => {
      todos = next;
    },
  };

  const buildPrompt = () =>
    buildSystemPrompt({
      todos: todoState.get(),
      pageContext,
      toolContexts,
      manifest,
      agentContext,
      memories: ctx.memories,
    });

  const tools = buildAssistantTools({ ...ownerCtx, todoState });

  // Mastra Agent constructor. The `instructions` field accepts a function
  // (DynamicArgument) which Mastra invokes lazily per turn — this preserves
  // the "todos change → next turn's system prompt is up to date" behavior
  // that `prepareStep` used to enforce in AI SDK 6.
  //
  // `maxSteps: 8` mirrors the old `stopWhen: [stepCountIs(8), ...]`. The
  // token-budget `budgetExceeded` stop condition is replaced by pre-turn
  // pruning in the route handler (see `pruneIfOverBudget` above).
  //
  // Tools: Mastra's `ToolsInput` slot accepts `VercelToolV5` structurally.
  // AI SDK 6 `tool({inputSchema, execute, needsApproval})` output satisfies
  // this shape at runtime; the cast bridges the internal `ai-sdk-v5` vs
  // `ai-sdk-v6` bundled type mirrors that Mastra and `ai@6` each ship (both
  // encode the same underlying `LanguageModelV2Tool` protocol).
  //
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Agent({
    id: "morris",
    name: "Morris",
    instructions: buildPrompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: tools as any,
    model: CHAT_MODEL,
  });
}

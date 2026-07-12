import {
  createUIMessageStreamResponse,
  convertToModelMessages,
  type UIMessage,
} from "ai";
import { toAISdkStream } from "@mastra/ai-sdk";

import { buildMorrisAgent, pruneIfOverBudget } from "@/lib/assistant/agent";
import { buildAgentContext } from "@/lib/assistant/agent-context";
import { listMemories } from "@/lib/memories/actions";
import { classifyMorrisError } from "@/lib/assistant/errors";
import { morrisErrorCounter } from "@/lib/assistant/metrics";
import { createLogger } from "@merism/observability";
import {
  EMPTY_PAGE_CONTEXT,
  PageContextSchema,
  type PageContext,
} from "@/lib/assistant/page-context";
import { getCurrentUserId } from "@/lib/queries/auth";
import { getCurrentWorkspaceAccessContext } from "@/lib/auth/workspace";

// AI SDK 必须使用 Node runtime(绝不用 edge),且 cookies() 也只能在 Node 上下文里读。
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Morris 研究助手对接端点。Post ADR-0013 by Mastra `Agent` (see
 * `lib/assistant/agent.ts` doc for the migration rationale).
 *
 * 行为契约:
 * - 入参: { messages: UIMessage[]; pageContext?: PageContext }
 * - 出参: v6 UIMessageStream(text/event-stream), 由前端 useChat + DefaultChatTransport 消费
 *
 * Streaming pipeline:
 *
 *   client → useChat → route
 *   ├─ convertToModelMessages(UIMessage[]) → ModelMessage[]
 *   ├─ pruneIfOverBudget(ModelMessage[]) → ModelMessage[] (结构性裁剪)
 *   ├─ agent.stream(ModelMessage[]) → MastraModelOutput
 *   ├─ toAISdkStream(output, { from: "agent", version: "v6" }) → V6UIMessageStream
 *   └─ createUIMessageStreamResponse({ stream }) → SSE Response
 *
 * `pruneIfOverBudget` 替换了旧 AI SDK 6 `prepareStep` 内的 `pruneMessages`
 * — Mastra Agent 没有 `prepareStep` hook, 但 pre-turn 结构性裁剪落在 route
 * 侧同样能控住 token 上限。
 *
 * 错误处理 (R4): toAISdkStream 的 `onError` 把底层错误归入 5 类
 * (client/api/transient/transport/unknown), 用对应中文文案回复, 同时进程内
 * 计数器自增, 服务端日志写一行结构化简述(不含 stack/api key)。
 */
export async function POST(req: Request) {
  const log = createLogger("route.assistant.post");
  let messages: UIMessage[];
  let pageContext: PageContext = EMPTY_PAGE_CONTEXT;
  try {
    const body = await req.json();
    if (!body || !Array.isArray(body.messages)) {
      return Response.json({ error: "请求体格式不正确:messages 必须是数组。" }, { status: 400 });
    }
    messages = body.messages as UIMessage[];

    if (body.pageContext !== undefined && body.pageContext !== null) {
      const parsed = PageContextSchema.safeParse(body.pageContext);
      if (parsed.success) {
        pageContext = parsed.data;
      } else {
        // 不让一个坏的 pageContext 把整次请求 400 掉; 退化为空 + warn。
        log.warn("pageContext schema mismatch, falling back to empty", {
          issues: parsed.error.flatten(),
        });
      }
    }
  } catch {
    return Response.json({ error: "请求体不是合法的 JSON。" }, { status: 400 });
  }

  // Resolve the signed-in researcher. null → tools short-circuit with
  // "not signed in" rather than reading anything.
  const ownerUserId = await getCurrentUserId();

  // robustness-hardening REQ-4: resolve the active workspace + role for the
  // Morris workspace access-control gate. null → solo researcher (no team)
  // or unauthenticated; tools still short-circuit via NOT_SIGNED_IN above.
  const workspace = await getCurrentWorkspaceAccessContext();

  // P1-1: build the runtime AgentContext (current researcher / project / time / URL
  // patterns) once per request; injected into the system prompt so the LLM never
  // has to recover these facts from the conversation history. Failure paths inside
  // buildAgentContext degrade gracefully (no auth → fallback name, no email).
  const memoriesP = listMemories({ limit: 20 }).catch(() => ({
    items: [] as Array<{ content: string; metadata: string }>,
  }));
  const [agentContext, memoriesResult] = await Promise.all([buildAgentContext(), memoriesP]);
  const memoryItems = memoriesResult.items.map((m) => ({
    content: m.content,
    metadata: (() => {
      try {
        return JSON.parse(m.metadata) as Record<string, unknown>;
      } catch {
        return {};
      }
    })(),
  }));

  try {
    const agent = buildMorrisAgent({
      ownerUserId,
      workspace,
      pageContext,
      agentContext,
      memories: memoryItems,
    });

    // convertToModelMessages returns Promise<ModelMessage[]> per ai@6.0.196
    // (it awaits filepart URL resolution etc.). Await here so pruneIfOverBudget
    // sees a real array.
    const modelMessages = pruneIfOverBudget(await convertToModelMessages(messages));

    // Mastra Agent.stream(messages, options). `abortSignal` is a top-level
    // execution option that propagates to the underlying LLM provider so
    // client-side `useChat.stop()` cancels the in-flight DeepSeek call.
    // `maxSteps` mirrors the old `stopWhen: [stepCountIs(8)]`.
    const output = await agent.stream(modelMessages, {
      maxSteps: 8,
      abortSignal: req.signal,
    });

    const uiStream = toAISdkStream(output, {
      from: "agent",
      version: "v6",
      onError: (error) => {
        const m = classifyMorrisError(error);
        morrisErrorCounter.inc(m.kind);
        // 服务端结构化日志: 只输出 kind 与脱敏后的 detail, 不打印 stack/api key。
        log.error("morris.error", { kind: m.kind, detail: m.detail });
        return m.userMessage;
      },
    });

    return createUIMessageStreamResponse({ stream: uiStream });
  } catch (error) {
    // buildMorrisAgent / 路由配置错误 / Mastra Agent 构造失败都在这里收拢。
    const m = classifyMorrisError(error);
    morrisErrorCounter.inc(m.kind);
    log.error("morris.fatal", { kind: m.kind, detail: m.detail });
    return Response.json({ error: m.userMessage }, { status: 500 });
  }
}

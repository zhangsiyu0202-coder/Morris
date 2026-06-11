import { createAgentUIStreamResponse, type UIMessage } from "ai";

import { buildMorrisAgent } from "@/lib/assistant/agent";
import { buildAgentContext } from "@/lib/assistant/agent-context";
import { listMemories } from "@/lib/memories/actions";
import { classifyMorrisError } from "@/lib/assistant/errors";
import { morrisErrorCounter } from "@/lib/assistant/metrics";
import {
  EMPTY_PAGE_CONTEXT,
  PageContextSchema,
  type PageContext,
} from "@/lib/assistant/page-context";
import {
  applyCompaction,
  planCompaction,
  summarizeMessages,
} from "@/lib/assistant/compaction";
import { getCurrentUserId } from "@/lib/queries/auth";

const COMPACTION_OPTS = { tokenBudget: 12_000, minKeepTurns: 3, tailKeep: 8 };

// AI SDK 必须使用 Node runtime(绝不用 edge),且 cookies() 也只能在 Node 上下文里读。
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Morris 研究助手对接端点。
 *
 * 行为契约:
 * - 入参: { messages: UIMessage[]; pageContext?: PageContext }
 * - 出参: UIMessageStream(text/event-stream),由前端 useChat + DefaultChatTransport 消费
 *
 * 每次请求构造一个新的 ToolLoopAgent,把当前研究员的 ownerUserId 注入到工具集。
 * 工具的 execute 用 ownerUserId 过滤 Appwrite 查询,保证只读到该研究员自己的数据。
 * 未登录(ownerUserId === null)时,工具会返回 "请先登录" 错误而不是读任何数据。
 *
 * PageContext (R2): 客户端的 prepareSendMessagesRequest 把当前页面状态注入
 * 到 body, 这里用 strict schema 校验, 校验失败 → 退化为空对象并 warn。
 *
 * 错误处理 (R4): 由 `classifyMorrisError` 把底层错误归入 5 类(client/api/
 * transient/transport/unknown), 用对应中文文案回复, 同时进程内计数器自增,
 * 服务端日志写一行结构化简述(不含 stack/api key)。
 */
export async function POST(req: Request) {
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
        console.warn(
          "[assistant] pageContext schema mismatch, falling back to empty:",
          parsed.error.flatten(),
        );
      }
    }
  } catch {
    return Response.json({ error: "请求体不是合法的 JSON。" }, { status: 400 });
  }

  // Resolve the signed-in researcher. null → tools short-circuit with
  // "not signed in" rather than reading anything.
  const ownerUserId = await getCurrentUserId();

  // P1-1: build the runtime AgentContext (current researcher / project / time / URL
  // patterns) once per request; injected into the system prompt so the LLM never
  // has to recover these facts from the conversation history. Failure paths inside
  // buildAgentContext degrade gracefully (no auth → fallback name, no email).
  const memoriesP = listMemories({ limit: 20 }).catch(() => ({ items: [] as Array<{ content: string; metadata: string }> }));
    const [agentContext, memoriesResult] = await Promise.all([buildAgentContext(), memoriesP]);
    const memoryItems = memoriesResult.items.map((m) => ({
      content: m.content,
      metadata: (() => {
        try { return JSON.parse(m.metadata) as Record<string, unknown>; } catch { return {}; }
      })(),
    }));

  try {
    // R6: 在送进 ToolLoopAgent 之前先做对话压缩。失败 → fallback "(早期对话已省略)"。
    const compactionPlan = planCompaction(messages, COMPACTION_OPTS);
    const compacted = await applyCompaction(messages, compactionPlan, summarizeMessages);
    const uiMessages = compacted as UIMessage[];

    const agent = buildMorrisAgent({ ownerUserId, pageContext, agentContext, memories: memoryItems });
    return await createAgentUIStreamResponse({
      agent,
      uiMessages,
      // Forward the request abort signal so useChat.stop() on the client
      // actually cancels the in-flight DeepSeek call rather than running it
      // to completion (and burning tokens) after the SSE reader is closed.
      abortSignal: req.signal,
      onError: (error) => {
        const m = classifyMorrisError(error);
        morrisErrorCounter.inc(m.kind);
        // 服务端结构化日志: 只输出 kind 与脱敏后的 detail, 不打印 stack/api key。
        console.error("[assistant] %s: %s", m.kind, m.detail);
        return m.userMessage;
      },
    });
  } catch (error) {
    // 进入这里的多是 buildMorrisAgent / 路由配置错误, 也按同一分类器走一遍。
    const m = classifyMorrisError(error);
    morrisErrorCounter.inc(m.kind);
    console.error("[assistant fatal] %s: %s", m.kind, m.detail);
    return Response.json({ error: m.userMessage }, { status: 500 });
  }
}

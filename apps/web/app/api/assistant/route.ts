import { createAgentUIStreamResponse, type UIMessage } from "ai";
import { buildMorrisAgent } from "@/lib/assistant/agent";
import { getCurrentUserId } from "@/lib/queries/auth";

// AI SDK 必须使用 Node runtime(绝不用 edge),且 cookies() 也只能在 Node 上下文里读。
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Morris 研究助手对接端点。
 *
 * 行为契约:
 * - 入参: { messages: UIMessage[] }
 * - 出参: UIMessageStream(text/event-stream),由前端 useChat + DefaultChatTransport 消费
 *
 * 每次请求构造一个新的 ToolLoopAgent,把当前研究员的 ownerUserId 注入到工具集。
 * 工具的 execute 用 ownerUserId 过滤 Appwrite 查询,保证只读到该研究员自己的数据。
 * 未登录(ownerUserId === null)时,工具会返回 "请先登录" 错误而不是读任何数据。
 */
export async function POST(req: Request) {
  let messages: UIMessage[];
  try {
    const body = await req.json();
    if (!body || !Array.isArray(body.messages)) {
      return Response.json({ error: "请求体格式不正确:messages 必须是数组。" }, { status: 400 });
    }
    messages = body.messages as UIMessage[];
  } catch {
    return Response.json({ error: "请求体不是合法的 JSON。" }, { status: 400 });
  }

  // Resolve the signed-in researcher. null → tools short-circuit with
  // "not signed in" rather than reading anything.
  const ownerUserId = await getCurrentUserId();

  try {
    const agent = buildMorrisAgent({ ownerUserId });
    return await createAgentUIStreamResponse({
      agent,
      uiMessages: messages,
      onError: (error) => {
        console.error("[assistant] stream error:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (/api key|unauthor|401|403/i.test(message)) {
          return "AI 服务鉴权失败,请检查 DEEPSEEK_API_KEY 配置。";
        }
        if (/rate limit|429/i.test(message)) {
          return "请求过于频繁,请稍后再试。";
        }
        if (/timeout|timed out|ETIMEDOUT|fetch failed|ECONNRESET/i.test(message)) {
          return "连接 AI 服务超时,请稍后重试。";
        }
        return "AI 助手处理时出现问题,请重试。";
      },
    });
  } catch (error) {
    console.error("[assistant] route fatal error:", error);
    return Response.json({ error: "AI 助手暂时不可用,请稍后再试。" }, { status: 500 });
  }
}

import { createAgentUIStreamResponse, type UIMessage } from "ai";
import { morrisAgent } from "@/lib/assistant/agent";

// AI SDK 必须使用 Node runtime(绝不用 edge)。
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * AI 研究助手对接端点。
 *
 * 前端契约(不可更改,严格对接 components/assistant/conversation.tsx 的 useChat):
 * - 入参:`{ messages: UIMessage[] }`
 * - 出参:UIMessageStream(text/event-stream),由 useChat + DefaultChatTransport 消费
 *
 * 编排交给 morrisAgent(ToolLoopAgent):工具循环、上下文管理、降级、停止条件。
 * 本层只负责:请求体校验、把错误转成对用户友好的中文、以及最外层异常兜底。
 */
export async function POST(req: Request) {
  let messages: UIMessage[];

  // 参数校验:body 必须是 JSON 且 messages 为数组,否则返回 400。
  try {
    const body = await req.json();
    if (!body || !Array.isArray(body.messages)) {
      return Response.json({ error: "请求体格式不正确:messages 必须是数组。" }, { status: 400 });
    }
    messages = body.messages as UIMessage[];
  } catch {
    return Response.json({ error: "请求体不是合法的 JSON。" }, { status: 400 });
  }

  try {
    return await createAgentUIStreamResponse({
      agent: morrisAgent,
      uiMessages: messages,
      // 把流式过程中出现的任意错误转成发给前端的友好中文文本。
      onError: (error) => {
        console.error("[v0] assistant stream error:", error);
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
    // 流尚未建立时的同步异常(如 agent 初始化失败)。
    console.error("[v0] assistant route fatal error:", error);
    return Response.json({ error: "AI 助手暂时不可用,请稍后再试。" }, { status: 500 });
  }
}

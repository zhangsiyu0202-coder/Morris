import { ToolLoopAgent, stepCountIs, type StopCondition } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { assistantTools, type AssistantTools } from "./tools";
import { SYSTEM_INSTRUCTIONS } from "./system-prompt";

/**
 * Morris 研究助手 Agent —— 基于 AI SDK 6 的 ToolLoopAgent(本栈的 Agent Development Kit)。
 *
 * 这是一个真正的 agent,而非单次 LLM 调用,具备:
 * - 工具编排:createStudyDraft / searchInterviewData / analyzeData / listStudies
 * - Agent loop:多步工具调用,直到任务完成或触发停止条件
 * - 上下文管理:长对话自动裁剪,控制 token 预算
 * - 动态降级:出现工具错误或进入收尾阶段时,切换更强推理模型并停止继续调用工具
 * - 重试兜底:LLM 调用级 maxRetries + 工具内部 withRetry + 路由级 onError
 *
 * LLM 固定为直连 DeepSeek 官方(deepseek-chat),不引入其它供应商。
 */

// DeepSeek 官方直连。优先 DEEPSEEK_API_KEY,回退 AI_GATEWAY_API_KEY(历史配置)。
const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.AI_GATEWAY_API_KEY,
});

const CHAT_MODEL = deepseek("deepseek-chat");
// reasoner 用于「降级收尾」:出现错误或多步后用更强推理给出解释/总结(此阶段不再调用工具)。
const REASONING_MODEL = deepseek("deepseek-reasoner");

/** Token 预算保护:累计用量过高时停止 loop,避免失控。 */
const budgetExceeded: StopCondition<AssistantTools> = ({ steps }) => {
  const total = steps.reduce(
    (acc, step) => acc + (step.usage?.inputTokens ?? 0) + (step.usage?.outputTokens ?? 0),
    0,
  );
  return total > 24000;
};

/** 判断此前的步骤里是否出现过工具失败(工具返回了 { error: true })。 */
function hadToolError(steps: ReadonlyArray<{ toolResults?: ReadonlyArray<{ output?: unknown }> }>): boolean {
  return steps.some((step) =>
    (step.toolResults ?? []).some((r) => {
      const out = r.output as { error?: boolean } | null | undefined;
      return Boolean(out && typeof out === "object" && out.error === true);
    }),
  );
}

export const morrisAgent = new ToolLoopAgent({
  model: CHAT_MODEL,
  instructions: SYSTEM_INSTRUCTIONS,
  tools: assistantTools,
  // Loop 控制:最多 8 步,或 token 预算超限即停。
  stopWhen: [stepCountIs(8), budgetExceeded],
  // LLM 调用级重试:覆盖网络/瞬时 5xx 等可恢复错误。
  maxRetries: 2,
  // 每步前动态调整:上下文裁剪 + 失败/收尾降级。
  prepareStep: async ({ stepNumber, steps, messages }) => {
    const patch: {
      model?: typeof CHAT_MODEL;
      messages?: typeof messages;
      toolChoice?: "none" | "auto";
    } = {};

    // 上下文管理:对话过长时只保留最近的消息,控制 token 与延迟。
    if (messages.length > 24) {
      patch.messages = messages.slice(-16);
    }

    // 动态降级:若已出现工具失败,或进入后段(收尾),切到更强推理模型,
    // 并停止继续调用工具,让模型专注于向用户解释结果 / 给出建议。
    if (hadToolError(steps) || stepNumber >= 5) {
      patch.model = REASONING_MODEL;
      patch.toolChoice = "none";
    }

    return patch;
  },
});

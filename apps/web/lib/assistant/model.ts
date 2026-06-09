/**
 * Morris LLM 实例 (DeepSeek). 单例化在模块顶层,
 * 让 agent 主循环、对话压缩摘要器等共享同一个实例 (避免重复 createDeepSeek)。
 *
 * 与 ADR-0002 的栈决策一致: 只用 DeepSeek, deepseek-chat 是主模型,
 * deepseek-reasoner 用作 prepareStep 的降级目标 (工具失败 / 走得太远后切过去)。
 */

import { createDeepSeek } from "@ai-sdk/deepseek";

const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.AI_GATEWAY_API_KEY,
});

export const CHAT_MODEL = deepseek("deepseek-chat");
export const REASONING_MODEL = deepseek("deepseek-reasoner");

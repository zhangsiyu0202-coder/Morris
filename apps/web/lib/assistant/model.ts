/**
 * Morris LLM 实例 (DeepSeek). 单例化在模块顶层,
 * 让 agent 主循环、对话压缩摘要器等共享同一个实例 (避免重复 createDeepSeek)。
 *
 * 与 ADR-0002 的栈决策一致: 只用 DeepSeek, deepseek-chat 是主模型,
 * deepseek-reasoner 用作 prepareStep 的降级目标 (工具失败 / 走得太远后切过去)。
 *
 * 每个 model 实例都用 `wrapLanguageModel` 接入
 * `llmObservabilityMiddleware` (per .kiro/specs/morris-llm-observability/),
 * 让 ToolLoopAgent 内部每次 LLM 调用 (调用点不可见) 都被观测一次. 调用点
 * 可见的位置 (compaction / server actions / Function deps) 用显式 withLLMCall
 * 替代, 提供更精确的 scope.
 */

import { createDeepSeek } from "@ai-sdk/deepseek";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { llmObservabilityMiddleware } from "@merism/observability";
import { randomUUID } from "node:crypto";

const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.AI_GATEWAY_API_KEY,
});

export const CHAT_MODEL = wrapLanguageModel({
  model: deepseek("deepseek-chat"),
  middleware: llmObservabilityMiddleware({
    scope: "morris.toolloop",
    traceId: () => randomUUID(),
    defaultModel: "deepseek-chat",
  }) as LanguageModelMiddleware,
});

export const REASONING_MODEL = wrapLanguageModel({
  model: deepseek("deepseek-reasoner"),
  middleware: llmObservabilityMiddleware({
    scope: "morris.toolloop.reasoner",
    traceId: () => randomUUID(),
    defaultModel: "deepseek-reasoner",
  }) as LanguageModelMiddleware,
});

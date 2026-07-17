/**
 * Morris LLM 实例 (LiteLLM → DeepSeek). 单例化在模块顶层,
 * 让 agent 主循环、对话压缩摘要器等共享同一个实例。
 *
 * 与 ADR-0002 的模型选择一致: DeepSeek 仍是文本模型；LiteLLM 仅作为
 * server-side gateway。所有 Morris 回合均使用 `deepseek-v4-flash`；
 * prepareStep 只改变工作流策略，不切换到另一个模型。
 *
 * 每个 model 实例都用 `wrapLanguageModel` 接入
 * `llmObservabilityMiddleware` (per .kiro/specs/morris-llm-observability/),
 * 让 ToolLoopAgent 内部每次 LLM 调用 (调用点不可见) 都被观测一次. 调用点
 * 可见的位置 (compaction / server actions / Function deps) 用显式 withLLMCall
 * 替代, 提供更精确的 scope.
 */

import { createLiteLlmProvider } from "@merism/llm";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { llmObservabilityMiddleware } from "@merism/observability";
import { randomUUID } from "node:crypto";

const litellm = createLiteLlmProvider({
  baseUrl: process.env.LITELLM_BASE_URL ?? "http://localhost:4000/v1",
  apiKey: process.env.LITELLM_API_KEY ?? "",
});

const chatModel = process.env.LITELLM_CHAT_MODEL ?? "deepseek-v4-flash";
const reasoningModel = process.env.LITELLM_REASONING_MODEL ?? "deepseek-v4-flash";

export const CHAT_MODEL = wrapLanguageModel({
  model: litellm(chatModel),
  middleware: llmObservabilityMiddleware({
    scope: "morris.toolloop",
    traceId: () => randomUUID(),
    defaultModel: chatModel,
  }) as LanguageModelMiddleware,
});

export const REASONING_MODEL = wrapLanguageModel({
  model: litellm(reasoningModel),
  middleware: llmObservabilityMiddleware({
    scope: "morris.toolloop.reasoner",
    traceId: () => randomUUID(),
    defaultModel: reasoningModel,
  }) as LanguageModelMiddleware,
});

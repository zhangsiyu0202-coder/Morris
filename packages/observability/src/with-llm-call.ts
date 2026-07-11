/**
 * withLLMCall — 显式 LLM 调用观测包装器 (R2.1).
 *
 * Server Action / Function / Compaction 等"调用点可见"的位置直接用这个; Morris
 * ToolLoopAgent 内部 LLM 调用走 wrapLanguageModel + middleware (调用点不可见).
 *
 * 行为:
 *  1. 走 llmGate (R6 并发上限)
 *  2. 计时 + 抽 result.usage + 抽 result.text (debug snippets)
 *  3. 成功 → 写 success event; 失败 → 写 error/rate_limit/timeout event 并 re-throw (不吞错)
 *
 * 不修改 prompt / response — 这层只 observe, 不 transform.
 */

import {
  TransientProviderError,
  PermanentProviderError,
} from "./retry.js";
import {
  type LLMCallEvent,
  type LLMCallStatusValue,
  sinkOrDefault,
} from "./llm-call.js";
import { llmGate } from "./concurrency.js";
import { extractDebugSnippets } from "./debug-snippets.js";

const PROVIDER = "deepseek" as const; // ADR-0002 锁定

/** Vercel AI SDK 6 generateText / streamText 的 result 最小子集. */
export interface VercelAIUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
}

export interface VercelAIResultLike {
  usage?: VercelAIUsage;
  text?: string;
  /** 实际返回 model id (可能与 request.model 略异). */
  response?: { modelId?: string };
}

export interface WithLLMCallOpts {
  /** 必须满足 LLM_CALL_SCOPE_RE 正则. */
  scope: string;
  /** 与 createLogger.traceId 共享, 让跨模块 log 关联得到. */
  traceId: string;
  /** 0-based; withRetry 重试时增量传. 默认 0. */
  attempt?: number;
  /** 调用方默认 model name (用于错误 event — 错误时拿不到 result.response.modelId). */
  defaultModel?: string;
  /** 给 debug-snippets 提取用. 不会进 default event. */
  prompt?: string;
}

interface ClassifiedError {
  status: LLMCallStatusValue;
  errorClass: string;
  errorCode?: string;
}

/**
 * 把 thrown error 分类成 LLMCallEvent.status + errorClass.
 *
 * - TransientProviderError + 429 / "rate" → rate_limit
 * - TransientProviderError + timeout / abort → timeout
 * - 其他 TransientProviderError / 任意 Error → error
 * - PermanentProviderError → error
 */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof TransientProviderError) {
    const msg = err.message.toLowerCase();
    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("rate-limit")) {
      return { status: "rate_limit", errorClass: "TransientProviderError", errorCode: "rate_limited" };
    }
    if (msg.includes("timeout") || msg.includes("abort")) {
      return { status: "timeout", errorClass: "TransientProviderError", errorCode: "timeout" };
    }
    return { status: "error", errorClass: "TransientProviderError" };
  }
  if (err instanceof PermanentProviderError) {
    return { status: "error", errorClass: "PermanentProviderError" };
  }
  if (err instanceof Error) {
    return { status: "error", errorClass: err.name || "Error" };
  }
  return { status: "error", errorClass: "Unknown" };
}

/**
 * Wrap an LLM call (typically Vercel AI SDK 6 generateText / streamText).
 * 调用点可见时用这个; 调用点不可见 (ToolLoopAgent 内部) 用 wrapLanguageModel
 * + llmObservabilityMiddleware 替代.
 */
export async function withLLMCall<T extends VercelAIResultLike>(
  opts: WithLLMCallOpts,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const attempt = opts.attempt ?? 0;
  try {
    const result = await llmGate(() => fn());
    const latencyMs = Date.now() - start;
    const usage = result.usage ?? {};
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;
    const event: LLMCallEvent = {
      scope: opts.scope,
      model: result.response?.modelId ?? opts.defaultModel ?? "unknown",
      provider: PROVIDER,
      status: "success",
      latencyMs,
      inputTokens,
      outputTokens,
      totalTokens,
      ...(usage.cachedInputTokens !== undefined
        ? { cacheReadTokens: usage.cachedInputTokens }
        : {}),
      traceId: opts.traceId,
      attempt,
    };
    const snippets = extractDebugSnippets({ prompt: opts.prompt, completion: result.text });
    if (snippets) event.debugSnippets = snippets;
    sinkOrDefault(event);
    return result;
  } catch (err) {
    const latencyMs = Date.now() - start;
    const cls = classifyError(err);
    const event: LLMCallEvent = {
      scope: opts.scope,
      model: opts.defaultModel ?? "unknown",
      provider: PROVIDER,
      status: cls.status,
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      traceId: opts.traceId,
      attempt,
      errorClass: cls.errorClass,
      ...(cls.errorCode ? { errorCode: cls.errorCode } : {}),
    };
    sinkOrDefault(event);
    throw err; // 不吞错
  }
}

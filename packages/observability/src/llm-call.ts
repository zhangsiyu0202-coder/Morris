/**
 * LLM call observability schema (per .kiro/specs/morris-llm-observability/).
 *
 * 集中接入点的事件契约 — 所有 LLM 调用 (Morris ToolLoopAgent / Server Action /
 * Function) 走 withLLMCall 或 wrapLanguageModel + middleware 后, 产出一份
 * LLMCallEvent 由 sink 处理.
 *
 * Default sink = createLogger(scope).info("llm.call", event). 可注入自定义
 * sink (测试 / 未来 Appwrite collection 持久化).
 *
 * 不依赖 ai SDK / 不依赖 zod 之外的运行时 — 这层是契约 + 调度核心, 维持
 * packages/observability 的薄层定位.
 */

import { z } from "zod";
import { createLogger } from "./logger.js";

/** scope 命名格式 (per requirements.md R1):
 *  morris.tool.<toolName> / morris.compaction.<phase> / morris.toolloop[.suffix]
 *  function.<functionName>.<phase>
 *  action.<actionName>
 *
 *  正则强制 prefix + dot-separated identifier 段. K-LLMOBS-05.
 */
export const LLM_CALL_SCOPE_RE =
  /^(morris|function|action)\.[a-zA-Z][\w-]*(\.[a-zA-Z][\w-]*)*$/;

export const LLMCallStatus = z.enum([
  "success",
  "error",
  "rate_limit",
  "timeout",
]);
export type LLMCallStatusValue = z.infer<typeof LLMCallStatus>;

/** ADR-0002 锁定 DeepSeek 唯一 LLM provider; 改要新 ADR. */
export const LLMCallProvider = z.enum(["deepseek"]);
export type LLMCallProviderValue = z.infer<typeof LLMCallProvider>;

const DebugSnippetsSchema = z
  .object({
    promptHead: z.string().max(200).optional(),
    completionHead: z.string().max(200).optional(),
  })
  .strict();

export const LLMCallEventSchema = z
  .object({
    scope: z.string().regex(LLM_CALL_SCOPE_RE, {
      message:
        "scope must match morris.|function.|action. prefix + dot-separated identifiers",
    }),
    model: z.string().min(1),
    provider: LLMCallProvider,
    status: LLMCallStatus,
    latencyMs: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
    traceId: z.string().min(1),
    errorClass: z.string().optional(),
    errorCode: z.string().optional(),
    attempt: z.number().int().nonnegative(),
    debugSnippets: DebugSnippetsSchema.optional(),
  })
  .strict();
export type LLMCallEvent = z.infer<typeof LLMCallEventSchema>;

/** Sink interface — 接收 event 后做任意 side effect (log / persist / forward). */
export type LLMCallSink = (event: LLMCallEvent) => void;

/**
 * Default sink = log to createLogger(event.scope). 可被 installLLMCallSink
 * 替换 (e.g. 测试用 in-memory array, 或未来接 Appwrite collection persistence).
 */
const defaultSink: LLMCallSink = (event) => {
  const log = createLogger(event.scope, event.traceId);
  log.info("llm.call", event as unknown as Record<string, unknown>);
};

let activeSink: LLMCallSink = defaultSink;

/** 安装自定义 sink (e.g. 测试). 返回 restore 函数还原到 default. */
export function installLLMCallSink(sink: LLMCallSink): () => void {
  const previous = activeSink;
  activeSink = sink;
  return () => {
    activeSink = previous;
  };
}

/** Forward event to active sink. 包装器内部用. */
export function sinkOrDefault(event: LLMCallEvent): void {
  activeSink(event);
}

/** 还原到 default sink (测试 cleanup 用). */
export function resetLLMCallSink(): void {
  activeSink = defaultSink;
}

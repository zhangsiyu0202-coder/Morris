/**
 * Vercel AI SDK 6 LanguageModelV2Middleware — ToolLoopAgent 内部 LLM 调用观测
 * (R2.2). 调用点不可见时用这个; 调用点可见时用 withLLMCall (R2.1).
 *
 * 实施细节 (per design.md §6 + Wave A 增补):
 *  - wrapGenerate: 直接复用 withLLMCall (DRY)
 *  - wrapStream: 用 TransformStream 拦截每个 LanguageModelV2StreamPart;
 *      - type==="finish" 抽 part.usage 缓存
 *      - type==="error" 标记 errored
 *      - flush() 时根据缓存写 event (sinkOrDefault)
 *
 * 不依赖 @ai-sdk/provider 的 type — 用 structural subset (LanguageModelV2 中只
 * 用到 wrapGenerate/wrapStream 两个钩子) 避免 packages 层耦合 ai SDK 主版本.
 */

import {
  type LLMCallEvent,
  type LLMCallStatusValue,
  sinkOrDefault,
} from "./llm-call.js";
import {
  withLLMCall,
  classifyError,
  type VercelAIResultLike,
  type VercelAIUsage,
} from "./with-llm-call.js";

const PROVIDER = "deepseek" as const;

/** Subset of Vercel AI SDK 6 LanguageModelV3Middleware (ai 6.x uses V3). */
export interface LanguageModelV3MiddlewareSubset {
  readonly specificationVersion: "v3";
  wrapGenerate?: (args: {
    doGenerate: () => PromiseLike<unknown>;
    doStream: () => PromiseLike<unknown>;
    params: unknown;
    model: unknown;
  }) => PromiseLike<unknown>;
  wrapStream?: (args: {
    doGenerate: () => PromiseLike<unknown>;
    doStream: () => PromiseLike<unknown>;
    params: unknown;
    model: unknown;
  }) => PromiseLike<unknown>;
}

/** Subset of LanguageModelV2StreamPart we care about (per @ai-sdk/provider 3.x). */
interface MinimalStreamPart {
  type: string;
  usage?: VercelAIUsage;
  error?: unknown;
}

/** Subset of doStream() return value. */
interface MinimalStreamResult {
  stream: ReadableStream<MinimalStreamPart>;
  // 其他字段 (request / rawResponse / ...) — pass through
  [key: string]: unknown;
}

export interface LLMObsMiddlewareOpts {
  /** scope 必须满足 LLM_CALL_SCOPE_RE — 一般 morris.toolloop[.<role>]. */
  scope: string;
  /** 函数形式让每次调用拿新 traceId; 字符串形式让多次调用共享同一 traceId. */
  traceId: string | (() => string);
  /** 调用方默认 model name. 错误事件时填. */
  defaultModel?: string;
}

function resolveTraceId(t: LLMObsMiddlewareOpts["traceId"]): string {
  return typeof t === "function" ? t() : t;
}

/**
 * Build a sink-emitting TransformStream that observes finish/error chunks
 * without modifying them.
 */
function buildObservingTransform(opts: {
  scope: string;
  traceId: string;
  defaultModel: string;
  start: number;
}): TransformStream<MinimalStreamPart, MinimalStreamPart> {
  let usage: VercelAIUsage = {};
  let errorPart: unknown;
  let modelId: string | undefined;

  return new TransformStream<MinimalStreamPart, MinimalStreamPart>({
    transform(part, controller) {
      if (part.type === "finish" && part.usage) {
        usage = part.usage;
      } else if (part.type === "error") {
        errorPart = part.error;
      } else if (part.type === "response-metadata") {
        // response-metadata 包含真实 modelId (provider may differ from request)
        const metadata = part as MinimalStreamPart & { modelId?: string };
        if (typeof metadata.modelId === "string") modelId = metadata.modelId;
      }
      controller.enqueue(part);
    },
    flush() {
      const latencyMs = Date.now() - opts.start;
      if (errorPart !== undefined) {
        const cls = classifyError(errorPart);
        const event: LLMCallEvent = {
          scope: opts.scope,
          model: modelId ?? opts.defaultModel,
          provider: PROVIDER,
          status: cls.status,
          latencyMs,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          totalTokens:
            usage.totalTokens ??
            (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          ...(usage.cachedInputTokens !== undefined
            ? { cacheReadTokens: usage.cachedInputTokens }
            : {}),
          traceId: opts.traceId,
          attempt: 0,
          errorClass: cls.errorClass,
          ...(cls.errorCode ? { errorCode: cls.errorCode } : {}),
        };
        sinkOrDefault(event);
        return;
      }
      const inputTokens = usage.inputTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;
      const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;
      const event: LLMCallEvent = {
        scope: opts.scope,
        model: modelId ?? opts.defaultModel,
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
        attempt: 0,
      };
      sinkOrDefault(event);
    },
  });
}

export function llmObservabilityMiddleware(
  opts: LLMObsMiddlewareOpts,
): LanguageModelV3MiddlewareSubset {
  const defaultModel = opts.defaultModel ?? "unknown";
  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) => {
      const traceId = resolveTraceId(opts.traceId);
      return withLLMCall(
        { scope: opts.scope, traceId, defaultModel },
        () => doGenerate() as Promise<VercelAIResultLike>,
      );
    },
    wrapStream: async ({ doStream }) => {
      const traceId = resolveTraceId(opts.traceId);
      const start = Date.now();
      let result: MinimalStreamResult;
      try {
        result = (await doStream()) as MinimalStreamResult;
      } catch (err) {
        // 流尚未开始就失败 (e.g. 鉴权 / 网络) — 记录单条 event 后 re-throw
        const latencyMs = Date.now() - start;
        const cls = classifyError(err);
        const event: LLMCallEvent = {
          scope: opts.scope,
          model: defaultModel,
          provider: PROVIDER,
          status: cls.status,
          latencyMs,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          traceId,
          attempt: 0,
          errorClass: cls.errorClass,
          ...(cls.errorCode ? { errorCode: cls.errorCode } : {}),
        };
        sinkOrDefault(event);
        throw err;
      }
      const observed = result.stream.pipeThrough(
        buildObservingTransform({ scope: opts.scope, traceId, defaultModel, start }),
      );
      return { ...result, stream: observed };
    },
  };
}

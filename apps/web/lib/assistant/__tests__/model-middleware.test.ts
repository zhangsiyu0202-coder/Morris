/**
 * Layer 3 集成测试 (per testing.md::Four layers): 用 Vercel AI SDK 6 的
 * MockLanguageModelV3 (官方 fake, 等价于 PostHog `FakeChatOpenAI` 形态) 跑
 * llmObservabilityMiddleware + wrapLanguageModel 端到端, 验证 sink 真的收到
 * LLMCallEvent.
 *
 * 这覆盖了 model.ts 的"调用点不可见"路径 — ToolLoopAgent 内部调 LLM 时
 * middleware 是唯一观测窗口.
 */

import { describe, it, expect, afterEach } from "vitest";
import { generateText, wrapLanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import {
  installLLMCallSink,
  resetLLMCallSink,
  llmObservabilityMiddleware,
  type LLMCallEvent,
} from "@merism/observability";

const captured: LLMCallEvent[] = [];

afterEach(() => {
  resetLLMCallSink();
  captured.length = 0;
});

function installCapture() {
  installLLMCallSink((e) => captured.push(e));
}

describe("Layer 3 — middleware end-to-end with MockLanguageModelV3", () => {
  it("captures success event via wrapGenerate when generateText is called", async () => {
    installCapture();
    const mockModel = new MockLanguageModelV3({
      provider: "deepseek",
      modelId: "deepseek-chat",
      doGenerate: (async () => ({
        finishReason: "stop" as const,
        usage: { inputTokens: 120, outputTokens: 35, totalTokens: 155 },
        content: [{ type: "text" as const, text: "hello world" }],
        warnings: [],
      })) as never,
    });
    const wrapped = wrapLanguageModel({
      model: mockModel,
      middleware: llmObservabilityMiddleware({
        scope: "morris.toolloop",
        traceId: "fixed-test-trace",
        defaultModel: "deepseek-chat",
      }) as never,
    });

    const result = await generateText({ model: wrapped, prompt: "hi" });

    expect(result.text).toBe("hello world");
    expect(captured).toHaveLength(1);
    const e = captured[0];
    expect(e.scope).toBe("morris.toolloop");
    expect(e.traceId).toBe("fixed-test-trace");
    expect(e.status).toBe("success");
    expect(e.inputTokens).toBe(120);
    expect(e.outputTokens).toBe(35);
    expect(e.totalTokens).toBe(155);
    expect(e.provider).toBe("deepseek");
  });

  it("captures error event when mock model throws", async () => {
    installCapture();
    const mockModel = new MockLanguageModelV3({
      provider: "deepseek",
      modelId: "deepseek-chat",
      doGenerate: async () => {
        throw new Error("provider blew up");
      },
    });
    const wrapped = wrapLanguageModel({
      model: mockModel,
      middleware: llmObservabilityMiddleware({
        scope: "morris.toolloop",
        traceId: "err-trace",
        defaultModel: "deepseek-chat",
      }) as never,
    });

    await expect(generateText({ model: wrapped, prompt: "hi" })).rejects.toThrow();
    expect(captured).toHaveLength(1);
    expect(captured[0].status).toBe("error");
    expect(captured[0].errorClass).toBe("Error");
    expect(captured[0].traceId).toBe("err-trace");
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { llmObservabilityMiddleware } from "../src/llm-middleware.js";
import {
  installLLMCallSink,
  resetLLMCallSink,
  type LLMCallEvent,
} from "../src/llm-call.js";

const captured: LLMCallEvent[] = [];

afterEach(() => {
  resetLLMCallSink();
  captured.length = 0;
});

function installCapture() {
  installLLMCallSink((e) => captured.push(e));
}

describe("llmObservabilityMiddleware — wrapGenerate", () => {
  it("emits event with correct scope and traceId", async () => {
    installCapture();
    const mw = llmObservabilityMiddleware({
      scope: "morris.toolloop",
      traceId: "fixed-trace",
    });
    const result = await mw.wrapGenerate!({
      doGenerate: async () => ({
        usage: { inputTokens: 200, outputTokens: 60, totalTokens: 260 },
        text: "model output",
        response: { modelId: "deepseek-chat" },
      }),
      params: {},
      model: {},
    });
    expect((result as { text?: string }).text).toBe("model output");
    expect(captured).toHaveLength(1);
    expect(captured[0].scope).toBe("morris.toolloop");
    expect(captured[0].traceId).toBe("fixed-trace");
    expect(captured[0].status).toBe("success");
    expect(captured[0].inputTokens).toBe(200);
  });

  it("function traceId yields fresh id per call", async () => {
    installCapture();
    let counter = 0;
    const mw = llmObservabilityMiddleware({
      scope: "morris.toolloop",
      traceId: () => `trace-${counter++}`,
    });
    await mw.wrapGenerate!({
      doGenerate: async () => ({ usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }),
      params: {},
      model: {},
    });
    await mw.wrapGenerate!({
      doGenerate: async () => ({ usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }),
      params: {},
      model: {},
    });
    expect(captured).toHaveLength(2);
    expect(captured[0].traceId).toBe("trace-0");
    expect(captured[1].traceId).toBe("trace-1");
  });

  it("propagates and records errors", async () => {
    installCapture();
    const mw = llmObservabilityMiddleware({
      scope: "morris.toolloop",
      traceId: "err-trace",
      defaultModel: "deepseek-chat",
    });
    await expect(
      mw.wrapGenerate!({
        doGenerate: async () => {
          throw new Error("boom");
        },
        params: {},
        model: {},
      }),
    ).rejects.toThrow("boom");
    expect(captured).toHaveLength(1);
    expect(captured[0].status).toBe("error");
    expect(captured[0].model).toBe("deepseek-chat");
  });

});

describe("llmObservabilityMiddleware — wrapStream (real implementation)", () => {
  function makeStream(parts: ReadonlyArray<{ type: string; usage?: object; error?: unknown; modelId?: string }>) {
    return new ReadableStream({
      start(controller) {
        for (const p of parts) controller.enqueue(p);
        controller.close();
      },
    });
  }

  async function drain(stream: ReadableStream<unknown>): Promise<unknown[]> {
    const out: unknown[] = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(value);
    }
    return out;
  }

  it("emits success event with usage on finish chunk", async () => {
    installCapture();
    const mw = llmObservabilityMiddleware({
      scope: "morris.toolloop",
      traceId: "stream-trace",
      defaultModel: "deepseek-chat",
    });
    const result = await mw.wrapStream!({
      doStream: async () => ({
        stream: makeStream([
          { type: "stream-start" },
          { type: "text-delta" },
          { type: "finish", usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 } },
        ]),
      }),
      params: {},
      model: {},
    });
    const parts = await drain((result as { stream: ReadableStream }).stream);
    expect(parts).toHaveLength(3); // pass-through unchanged
    expect(captured).toHaveLength(1);
    expect(captured[0].status).toBe("success");
    expect(captured[0].inputTokens).toBe(50);
    expect(captured[0].outputTokens).toBe(25);
    expect(captured[0].totalTokens).toBe(75);
    expect(captured[0].scope).toBe("morris.toolloop");
    expect(captured[0].traceId).toBe("stream-trace");
  });

  it("emits error event when stream contains error chunk", async () => {
    installCapture();
    const mw = llmObservabilityMiddleware({
      scope: "morris.toolloop",
      traceId: "err-stream",
      defaultModel: "deepseek-chat",
    });
    const result = await mw.wrapStream!({
      doStream: async () => ({
        stream: makeStream([
          { type: "stream-start" },
          { type: "error", error: new Error("model crashed") },
        ]),
      }),
      params: {},
      model: {},
    });
    await drain((result as { stream: ReadableStream }).stream);
    expect(captured).toHaveLength(1);
    expect(captured[0].status).toBe("error");
    expect(captured[0].errorClass).toBe("Error");
  });

  it("emits error event when doStream itself throws (network / auth fail)", async () => {
    installCapture();
    const mw = llmObservabilityMiddleware({
      scope: "morris.toolloop",
      traceId: "auth-fail",
      defaultModel: "deepseek-chat",
    });
    await expect(
      mw.wrapStream!({
        doStream: async () => {
          throw new Error("401 unauthorized");
        },
        params: {},
        model: {},
      }),
    ).rejects.toThrow("401 unauthorized");
    expect(captured).toHaveLength(1);
    expect(captured[0].status).toBe("error");
    expect(captured[0].latencyMs).toBeGreaterThanOrEqual(0);
  });
});

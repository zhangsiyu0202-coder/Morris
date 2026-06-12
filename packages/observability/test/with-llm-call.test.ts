import { describe, it, expect, afterEach } from "vitest";
import {
  installLLMCallSink,
  resetLLMCallSink,
  type LLMCallEvent,
} from "../src/llm-call.js";
import { withLLMCall, classifyError } from "../src/with-llm-call.js";
import {
  TransientProviderError,
  PermanentProviderError,
} from "../src/retry.js";

const captured: LLMCallEvent[] = [];

afterEach(() => {
  resetLLMCallSink();
  captured.length = 0;
});

function installCapture() {
  installLLMCallSink((e) => captured.push(e));
}

describe("withLLMCall — success path", () => {
  it("emits success event with usage tokens", async () => {
    installCapture();
    const result = await withLLMCall(
      { scope: "action.notebooks.generateReport", traceId: "t-1" },
      async () => ({
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        text: "report body",
        response: { modelId: "deepseek-chat" },
      }),
    );
    expect(result.text).toBe("report body");
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      scope: "action.notebooks.generateReport",
      status: "success",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      model: "deepseek-chat",
      provider: "deepseek",
      traceId: "t-1",
      attempt: 0,
    });
    expect(captured[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("derives totalTokens when provider omits it", async () => {
    installCapture();
    await withLLMCall(
      { scope: "morris.compaction.summarize", traceId: "t-2" },
      async () => ({ usage: { inputTokens: 30, outputTokens: 20 } }),
    );
    expect(captured[0].totalTokens).toBe(50);
  });

  it("falls back to defaultModel when result.response.modelId missing", async () => {
    installCapture();
    await withLLMCall(
      {
        scope: "morris.compaction.summarize",
        traceId: "t-3",
        defaultModel: "deepseek-chat",
      },
      async () => ({ usage: { inputTokens: 10, outputTokens: 5 } }),
    );
    expect(captured[0].model).toBe("deepseek-chat");
  });
});

describe("withLLMCall — error paths", () => {
  it("classifies TransientProviderError 429 as rate_limit and re-throws", async () => {
    installCapture();
    await expect(
      withLLMCall(
        { scope: "function.analyzeSession.text-pass", traceId: "t-4" },
        async () => {
          throw new TransientProviderError("HTTP 429 too many requests");
        },
      ),
    ).rejects.toThrow(TransientProviderError);
    expect(captured).toHaveLength(1);
    expect(captured[0].status).toBe("rate_limit");
    expect(captured[0].errorCode).toBe("rate_limited");
    expect(captured[0].errorClass).toBe("TransientProviderError");
  });

  it("classifies TransientProviderError timeout as timeout", async () => {
    installCapture();
    await expect(
      withLLMCall(
        { scope: "function.analyzeSurvey.rollup", traceId: "t-5" },
        async () => {
          throw new TransientProviderError("AbortError: request aborted (timeout)");
        },
      ),
    ).rejects.toThrow();
    expect(captured[0].status).toBe("timeout");
    expect(captured[0].errorCode).toBe("timeout");
  });

  it("classifies PermanentProviderError as error", async () => {
    installCapture();
    await expect(
      withLLMCall(
        { scope: "action.notebooks.generateReport", traceId: "t-6" },
        async () => {
          throw new PermanentProviderError("invalid api key");
        },
      ),
    ).rejects.toThrow();
    expect(captured[0].status).toBe("error");
    expect(captured[0].errorClass).toBe("PermanentProviderError");
  });

  it("classifies plain Error as error with class name", async () => {
    installCapture();
    class MyCustomErr extends Error {
      constructor() {
        super("boom");
        this.name = "MyCustomErr";
      }
    }
    await expect(
      withLLMCall(
        { scope: "morris.tool.analyzeData", traceId: "t-7" },
        async () => {
          throw new MyCustomErr();
        },
      ),
    ).rejects.toThrow();
    expect(captured[0].errorClass).toBe("MyCustomErr");
  });

  it("attempt counter forwards to event", async () => {
    installCapture();
    await expect(
      withLLMCall(
        { scope: "function.analyzeSession.text-pass", traceId: "t-8", attempt: 2 },
        async () => {
          throw new TransientProviderError("429");
        },
      ),
    ).rejects.toThrow();
    expect(captured[0].attempt).toBe(2);
  });
});

describe("classifyError unit", () => {
  it("returns rate_limit for transient + 429", () => {
    expect(classifyError(new TransientProviderError("429"))).toMatchObject({
      status: "rate_limit",
      errorCode: "rate_limited",
    });
  });

  it("returns error for unknown throw", () => {
    expect(classifyError("string thrown")).toEqual({
      status: "error",
      errorClass: "Unknown",
    });
  });
});

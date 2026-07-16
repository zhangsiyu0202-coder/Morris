import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installLLMCallSink, resetLLMCallSink, type LLMCallEvent } from "@merism/observability";
import type { ConsolidateInputs } from "../src/gemini/consolidate";
import { createGeminiConsolidator } from "../src/gemini/gemini-consolidator";
import type { GeminiClient } from "../src/gemini/client";
import type { SegmentLlmOutput } from "../src/gemini/types";

const generateContent = vi.fn();
const client = { models: { generateContent } } as unknown as GeminiClient;

function seg(id = "s1"): SegmentLlmOutput {
  return { segmentId: id, startMs: 0, endMs: 1_000, title: "t", description: "d", observations: ["o"], issueLevel: "none", candidateMoments: [] };
}

const inputs: ConsolidateInputs = { segments: [seg()], expectedSegmentCount: 1, transcriptText: "你好" };
const validOutput = { text: JSON.stringify({ summary: "ok", sentiment: "neutral", tags: [], keyMoments: [] }) };
const observed: LLMCallEvent[] = [];

beforeEach(() => generateContent.mockReset());
afterEach(() => {
  resetLLMCallSink();
  observed.length = 0;
});

describe("createGeminiConsolidator", () => {
  it("uses Gemini structured JSON output and validates it locally", async () => {
    generateContent.mockResolvedValueOnce(validOutput);
    const result = await createGeminiConsolidator({ client, model: "gemini-3.1-flash-lite" })(inputs);

    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: "gemini-3.1-flash-lite",
      config: expect.objectContaining({ responseMimeType: "application/json", responseJsonSchema: expect.any(Object) }),
    }));
    expect(result).toMatchObject({ summary: "ok", sentiment: "neutral" });
  });

  it("emits a Gemini event with the invocation trace, without prompt content", async () => {
    installLLMCallSink((event) => observed.push(event));
    generateContent.mockResolvedValueOnce(validOutput);

    await createGeminiConsolidator({
      client,
      model: "gemini-3.1-flash-lite",
      traceId: "trace-gemini-visual",
    })(inputs);

    expect(observed).toEqual([expect.objectContaining({
      provider: "gemini",
      traceId: "trace-gemini-visual",
      scope: "function.analyzeSessionVisual.consolidate",
    })]);
    expect(JSON.stringify(observed[0])).not.toContain("你好");
  });

  it("retries failed or invalid outputs with correction feedback", async () => {
    generateContent.mockRejectedValueOnce(new Error("upstream 503")).mockResolvedValueOnce(validOutput);
    await createGeminiConsolidator({ client, model: "gemini-3.1-flash-lite" })(inputs);

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1]?.[0].contents).toContain("上一次输出无法通过校验");
    expect(generateContent.mock.calls[1]?.[0].contents).toContain("upstream 503");
  });

  it("retries schema-invalid JSON before accepting a corrected Gemini result", async () => {
    generateContent
      .mockResolvedValueOnce({ text: JSON.stringify({ summary: "", sentiment: "not-a-sentiment" }) })
      .mockResolvedValueOnce(validOutput);

    const result = await createGeminiConsolidator({ client, model: "gemini-3.1-flash-lite" })(inputs);

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1]?.[0].contents).toContain("上一次输出无法通过校验");
    expect(result.summary).toBe("ok");
  });

  it("falls through after its bounded retries so the deterministic fallback can run", async () => {
    generateContent.mockResolvedValue({ text: "not-json" });
    let thrown: unknown;
    try {
      await createGeminiConsolidator({ client, model: "gemini-3.1-flash-lite", maxContentAttempts: 3 })(inputs);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("Unexpected token");
    expect(generateContent).toHaveBeenCalledTimes(3);
  });
});

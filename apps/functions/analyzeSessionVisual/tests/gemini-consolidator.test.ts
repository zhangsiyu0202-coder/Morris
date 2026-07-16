import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsolidateInputs } from "../src/gemini/consolidate";
import { createGeminiConsolidator } from "../src/gemini/gemini-consolidator";
import type { GeminiClient } from "../src/gemini/client";
import type { SegmentLlmOutput } from "../src/gemini/types";

const generateContent = vi.fn();
const client = {
  models: { generateContent },
} as unknown as GeminiClient;

function seg(id = "s1"): SegmentLlmOutput {
  return {
    segmentId: id,
    startMs: 0,
    endMs: 1_000,
    title: "t",
    description: "d",
    observations: ["o"],
    issueLevel: "none",
    candidateMoments: [],
  };
}

const inputs: ConsolidateInputs = {
  segments: [seg()],
  expectedSegmentCount: 1,
  transcriptText: "你好",
};

const validOutput = {
  text: JSON.stringify({ summary: "ok", sentiment: "neutral", tags: [], keyMoments: [] }),
};

beforeEach(() => {
  generateContent.mockReset();
});

describe("createGeminiConsolidator", () => {
  it("uses Gemini structured JSON output and returns validated content", async () => {
    generateContent.mockResolvedValueOnce(validOutput);

    const result = await createGeminiConsolidator({ client, model: "gemini-3.1-flash-lite" })(inputs);

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.1-flash-lite",
        config: expect.objectContaining({
          responseMimeType: "application/json",
          responseJsonSchema: expect.any(Object),
        }),
      }),
    );
    expect(result).toMatchObject({ summary: "ok", sentiment: "neutral" });
  });

  it("retries with validation feedback after an upstream failure", async () => {
    generateContent.mockRejectedValueOnce(new Error("upstream 503")).mockResolvedValueOnce(validOutput);

    await createGeminiConsolidator({ client, model: "gemini-3.1-flash-lite" })(inputs);

    expect(generateContent).toHaveBeenCalledTimes(2);
    const firstContents = generateContent.mock.calls[0]?.[0].contents as string;
    const secondContents = generateContent.mock.calls[1]?.[0].contents as string;
    expect(firstContents).not.toContain("上一次输出无法通过校验");
    expect(secondContents).toContain("上一次输出无法通过校验");
    expect(secondContents).toContain("upstream 503");
  });

  it("retries when Gemini returns schema-invalid JSON, then succeeds", async () => {
    generateContent
      .mockResolvedValueOnce({ text: JSON.stringify({ summary: "", sentiment: "bogus" }) })
      .mockResolvedValueOnce(validOutput);

    const result = await createGeminiConsolidator({ client, model: "gemini-3.1-flash-lite" })(inputs);

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ summary: "ok" });
  });

  it("bubbles up after exhausting content attempts so the orchestrator falls back", async () => {
    generateContent.mockRejectedValue(new Error("persistent failure"));

    await expect(
      createGeminiConsolidator({ client, model: "gemini-3.1-flash-lite", maxContentAttempts: 3 })(inputs),
    ).rejects.toThrow("persistent failure");
    expect(generateContent).toHaveBeenCalledTimes(3);
  });
});

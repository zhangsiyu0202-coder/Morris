import { describe, expect, it, beforeEach, vi } from "vitest";
import type { LanguageModel } from "ai";
import type { ConsolidateInputs } from "../src/gemini/consolidate";
import type { SegmentLlmOutput } from "../src/gemini/types";

// Mock the AI SDK: control generateText, keep Output.object a passthrough so
// the consolidator still runs ConsolidatedSummarySchema.parse for real.
const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));
vi.mock("ai", () => ({
  generateText: generateTextMock,
  Output: { object: (x: unknown) => x },
}));

import { createDeepSeekConsolidator } from "../src/gemini/deepseek-consolidator";

const model = {} as LanguageModel;

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
  experimental_output: { summary: "ok", sentiment: "neutral", tags: [], keyMoments: [] },
};

beforeEach(() => {
  generateTextMock.mockReset();
});

describe("createDeepSeekConsolidator — retry with error feedback (Gap 4c)", () => {
  it("returns on the first attempt when output is valid", async () => {
    generateTextMock.mockResolvedValueOnce(validOutput);
    const consolidate = createDeepSeekConsolidator({ model });

    const result = await consolidate(inputs);

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ summary: "ok", sentiment: "neutral" });
  });

  it("retries with appended error feedback after a transport failure, then succeeds", async () => {
    generateTextMock
      .mockRejectedValueOnce(new Error("upstream 503"))
      .mockResolvedValueOnce(validOutput);
    const consolidate = createDeepSeekConsolidator({ model });

    const result = await consolidate(inputs);

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    const firstPrompt = generateTextMock.mock.calls[0][0].prompt as string;
    const secondPrompt = generateTextMock.mock.calls[1][0].prompt as string;
    expect(firstPrompt).not.toContain("上一次输出无法通过校验");
    expect(secondPrompt).toContain("上一次输出无法通过校验");
    expect(secondPrompt).toContain("upstream 503");
    expect(result).toMatchObject({ summary: "ok" });
  });

  it("retries when the model returns schema-invalid output, then succeeds", async () => {
    generateTextMock
      .mockResolvedValueOnce({ experimental_output: { summary: "", sentiment: "bogus" } })
      .mockResolvedValueOnce(validOutput);
    const consolidate = createDeepSeekConsolidator({ model });

    const result = await consolidate(inputs);

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ summary: "ok" });
  });

  it("bubbles up after exhausting maxContentAttempts so the orchestrator can fall back", async () => {
    generateTextMock.mockRejectedValue(new Error("persistent failure"));
    const consolidate = createDeepSeekConsolidator({ model, maxContentAttempts: 3 });

    await expect(consolidate(inputs)).rejects.toThrow("persistent failure");
    expect(generateTextMock).toHaveBeenCalledTimes(3);
  });
});

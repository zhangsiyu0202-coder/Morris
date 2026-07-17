/**
 * Unit tests for `generateInstructionBaseline` — the shared LLM entry
 * point (ADR-0015 Wave 2). We assert on the prompt shape (title +
 * questions make it into the LLM prompt) and
 * error handling (empty LLM response throws).
 *
 * The actual LLM call is stubbed via a vi.mock() on the `ai` module,
 * mirroring the pattern used by `apps/web/lib/conversations/__tests__/title.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const observability = vi.hoisted(() => ({
  withLLMCall: vi.fn(async (_opts: unknown, fn: () => Promise<unknown>) => fn()),
}));

// AI SDK 6: mock `generateText` so we can inspect the prompt.
const generateTextMock = vi.fn();
vi.mock("ai", () => ({
  generateText: (opts: unknown) => generateTextMock(opts),
}));

// Observability: pass through to the real generateText so we can still
// inspect its arguments.
vi.mock("@merism/observability", () => ({
  withLLMCall: observability.withLLMCall,
  createLogger: () => ({
    traceId: "test-trace",
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

vi.mock("@merism/llm", () => ({
  createLiteLlmProvider: () => (modelId: string) => ({ modelId }),
}));

// Import AFTER the mocks so the module resolves the stubs.
const { generateInstructionBaseline } = await import("../generator");

beforeEach(() => {
  generateTextMock.mockReset();
  observability.withLLMCall.mockClear();
});

describe("generateInstructionBaseline — prompt shape", () => {
  it("uses the invocation trace id supplied by its caller", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "## 研究意图\n..." });

    await generateInstructionBaseline({
      surveyTitle: "study",
      questions: [{ text: "q1", type: "open_ended" }],
      traceId: "request-trace-1",
    });

    expect(observability.withLLMCall).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "request-trace-1" }),
      expect.any(Function),
    );
  });

  it("includes the survey title in the user prompt", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "## 研究意图\n..." });
    await generateInstructionBaseline({
      surveyTitle: "SaaS 首月流失访谈",
      questions: [{ text: "上手时最挫败的是什么?", type: "open_ended" }],
    });
    const args = generateTextMock.mock.calls[0][0];
    expect(args.prompt).toContain("SaaS 首月流失访谈");
  });

  it("lists every question in interview order", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "..." });
    await generateInstructionBaseline({
      surveyTitle: "study",
      questions: [
        { text: "first", type: "open_ended" },
        { text: "second", type: "single_choice" },
        { text: "third", type: "open_ended" },
      ],
    });
    const args = generateTextMock.mock.calls[0][0];
    // ordering: first before second before third
    const idx1 = args.prompt.indexOf("first");
    const idx2 = args.prompt.indexOf("second");
    const idx3 = args.prompt.indexOf("third");
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });

  it("annotates each question with its type", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "..." });
    await generateInstructionBaseline({
      surveyTitle: "study",
      questions: [{ text: "rate the service", type: "rating" }],
    });
    const args = generateTextMock.mock.calls[0][0];
    expect(args.prompt).toContain("[rating]");
  });

  it("does not include deprecated hints supplied by a stale caller", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "..." });
    await generateInstructionBaseline({
      surveyTitle: "study",
      questions: [{ text: "q1", type: "open_ended" }],
      legacy: {
        researchGoal: "understand decision path",
        targetAudience: "SaaS buyers",
      },
    } as never);
    const args = generateTextMock.mock.calls[0][0];
    expect(args.prompt).not.toContain("研究员已有的背景信息");
    expect(args.prompt).not.toContain("understand decision path");
    expect(args.prompt).not.toContain("SaaS buyers");
  });

  it("passes low temperature (deterministic template output)", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "..." });
    await generateInstructionBaseline({
      surveyTitle: "study",
      questions: [{ text: "q1", type: "open_ended" }],
    });
    const args = generateTextMock.mock.calls[0][0];
    // ADR-0015 § baseline-generation-prompt-design recommends 0.3-0.5
    expect(args.temperature).toBeGreaterThanOrEqual(0.3);
    expect(args.temperature).toBeLessThanOrEqual(0.5);
  });

  it("uses the ADR-0015 section template in the system prompt", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "..." });
    await generateInstructionBaseline({
      surveyTitle: "study",
      questions: [{ text: "q1", type: "open_ended" }],
    });
    const args = generateTextMock.mock.calls[0][0];
    // System prompt must name every one of the five sections
    expect(args.system).toContain("## 研究意图");
    expect(args.system).toContain("## 访谈对象");
    expect(args.system).toContain("## 主持行为要点");
    expect(args.system).toContain("## 开场");
    expect(args.system).toContain("## 结束");
  });
});

describe("generateInstructionBaseline — output handling", () => {
  it("trims the LLM response", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "\n\n## 研究意图\ncontent\n\n" });
    const result = await generateInstructionBaseline({
      surveyTitle: "study",
      questions: [{ text: "q1", type: "open_ended" }],
    });
    expect(result.startsWith("## 研究意图")).toBe(true);
    expect(result.endsWith("content")).toBe(true);
  });

  it("throws on empty response", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "   \n  " });
    await expect(
      generateInstructionBaseline({
        surveyTitle: "study",
        questions: [{ text: "q1", type: "open_ended" }],
      }),
    ).rejects.toThrow(/empty/);
  });

  it("throws on LLM failure (propagates)", async () => {
    generateTextMock.mockRejectedValueOnce(new Error("provider timeout"));
    await expect(
      generateInstructionBaseline({
        surveyTitle: "study",
        questions: [{ text: "q1", type: "open_ended" }],
      }),
    ).rejects.toThrow("provider timeout");
  });
});

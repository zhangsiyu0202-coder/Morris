import { describe, it, expect } from "vitest";

import { buildSessionAnalyzeUserPrompt } from "../src/prompts/session-analyze.js";

const base = {
  surveyTitle: "差旅住宿调研",
  questions: [{ questionId: "q1", questionType: "open_ended", prompt: "你怎么选酒店?" }],
  segments: [
    { transcriptId: "s1", segmentIndex: 0, speaker: "respondent", text: "我看评分" },
  ],
  collectedAnswers: {},
};

describe("buildSessionAnalyzeUserPrompt — research-intent backdrop (ADR-0015 Wave 4)", () => {
  it("embeds the research intent ahead of the question list when present", () => {
    const intent = "## 研究意图\n了解差旅用户选酒店的决策路径";
    const prompt = buildSessionAnalyzeUserPrompt({ ...base, researchIntent: intent });
    expect(prompt).toContain("研究说明");
    expect(prompt).toContain("了解差旅用户选酒店的决策路径");
    // Backdrop precedes the question list.
    expect(prompt.indexOf("研究说明")).toBeLessThan(prompt.indexOf("题目列表"));
  });

  it("omits the backdrop section entirely when researchIntent is empty", () => {
    const prompt = buildSessionAnalyzeUserPrompt({ ...base, researchIntent: "" });
    expect(prompt).not.toContain("研究说明");
  });

  it("omits the backdrop when researchIntent is undefined (legacy caller)", () => {
    const prompt = buildSessionAnalyzeUserPrompt(base);
    expect(prompt).not.toContain("研究说明");
  });

  it("treats whitespace-only researchIntent as empty", () => {
    const prompt = buildSessionAnalyzeUserPrompt({ ...base, researchIntent: "   \n " });
    expect(prompt).not.toContain("研究说明");
  });
});

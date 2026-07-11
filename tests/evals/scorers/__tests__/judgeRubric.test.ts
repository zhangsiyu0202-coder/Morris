import { describe, expect, it } from "vitest";

import { createJudgeRubricScorer } from "../judgeRubric";

describe("judgeRubricScorer", () => {
  it("passes on majority vote and marks flake on disagreement", async () => {
    const scorer = createJudgeRubricScorer(async ({ sampleIndex }) => ({
      pass: sampleIndex !== 1,
      reason: `sample ${sampleIndex}`,
      tokens: { input: 10, output: 5 },
    }));

    const result = await scorer.score({}, { answer: "ok" }, { judge_rubric: "must be acceptable" });
    expect(result.ok).toBe(true);
    expect(result.judgeFlake).toBe(true);
    expect(result.tokens).toEqual({ input: 30, output: 15 });
  });

  it("fails when fewer than two of three samples pass", async () => {
    const scorer = createJudgeRubricScorer(async ({ sampleIndex }) => ({
      pass: sampleIndex === 0,
      reason: `sample ${sampleIndex}`,
      tokens: { input: 1, output: 1 },
    }));

    const result = await scorer.score({}, { answer: "bad" }, { judge_rubric: "must fail" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("sample 1");
      expect(result.reason).toContain("sample 2");
    }
  });
});

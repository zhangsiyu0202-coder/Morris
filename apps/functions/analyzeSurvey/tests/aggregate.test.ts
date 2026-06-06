import { describe, it, expect } from "vitest";
import { aggregateQuestionStats } from "../src/aggregate";

const survey = {
  surveyId: "sv1",
  title: "Test",
  questionBlocks: [
    {
      questionId: "q1",
      type: "single_choice",
      prompt: "Pick one",
      config: { options: ["A", "B", "C"] },
    },
    { questionId: "q2", type: "rating", prompt: "Rate", config: { scaleMax: 5 } },
    { questionId: "q3", type: "nps", prompt: "Recommend", config: {} },
    { questionId: "q4", type: "open_ended", prompt: "Tell me", config: {} },
  ],
};

describe("aggregateQuestionStats", () => {
  it("returns [] when no answers", () => {
    expect(aggregateQuestionStats(survey, [])).toEqual([]);
  });

  it("aggregates single_choice with pct rounded to one decimal", () => {
    const stats = aggregateQuestionStats(survey, [
      { sessionId: "s1", questionId: "q1", questionType: "single_choice", selectedOptions: ["A"] },
      { sessionId: "s2", questionId: "q1", questionType: "single_choice", selectedOptions: ["A"] },
      { sessionId: "s3", questionId: "q1", questionType: "single_choice", selectedOptions: ["B"] },
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ kind: "choice", multi: false, total: 3 });
    if (stats[0]?.kind === "choice") {
      const a = stats[0].data.find((d) => d.label === "A");
      const b = stats[0].data.find((d) => d.label === "B");
      const c = stats[0].data.find((d) => d.label === "C");
      expect(a).toMatchObject({ count: 2, pct: 66.7 });
      expect(b).toMatchObject({ count: 1, pct: 33.3 });
      expect(c).toMatchObject({ count: 0, pct: 0 });
    }
  });

  it("aggregates rating with average and distribution", () => {
    const stats = aggregateQuestionStats(survey, [
      { sessionId: "s1", questionId: "q2", questionType: "rating", score: 5 },
      { sessionId: "s2", questionId: "q2", questionType: "rating", score: 4 },
      { sessionId: "s3", questionId: "q2", questionType: "rating", score: 3 },
    ]);
    expect(stats[0]).toMatchObject({ kind: "rating", total: 3, average: 4, scaleMax: 5 });
    if (stats[0]?.kind === "rating") {
      expect(stats[0].data).toEqual([
        { score: 3, count: 1 },
        { score: 4, count: 1 },
        { score: 5, count: 1 },
      ]);
    }
  });

  it("aggregates nps with promoter / passive / detractor classification", () => {
    const stats = aggregateQuestionStats(survey, [
      { sessionId: "s1", questionId: "q3", questionType: "nps", score: 9 },
      { sessionId: "s2", questionId: "q3", questionType: "nps", score: 10 },
      { sessionId: "s3", questionId: "q3", questionType: "nps", score: 7 },
      { sessionId: "s4", questionId: "q3", questionType: "nps", score: 5 },
    ]);
    if (stats[0]?.kind === "nps") {
      expect(stats[0]).toMatchObject({
        total: 4,
        promoters: 2,
        passives: 1,
        detractors: 1,
      });
      expect(stats[0].score).toBe(25);
    }
  });

  it("skips open_ended (handled by LLM stage)", () => {
    const stats = aggregateQuestionStats(survey, [
      { sessionId: "s1", questionId: "q4", questionType: "open_ended" },
    ]);
    expect(stats).toEqual([]);
  });
});

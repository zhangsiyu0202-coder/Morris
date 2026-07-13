import { describe, it, expect } from "vitest";

import { buildComposeInsightsUserPrompt } from "../src/prompts/compose-insights.js";

const base = {
  surveyTitle: "差旅住宿调研",
  totalSessions: 5,
  themes: [{ id: "t1", label: "价格敏感", mentions: 3, pct: 60 }],
  themeContexts: [
    { id: "t1", label: "价格敏感", description: "受访者常提价格", evidenceRefs: [] },
  ],
  questionStats: [{ questionId: "q1", kind: "choice" }],
  sessionReports: [],
};

describe("buildComposeInsightsUserPrompt — research-intent backdrop (ADR-0015 Wave 4)", () => {
  it("embeds research intent ahead of themes when present", () => {
    const intent = "## 研究意图\n了解差旅用户对价格的敏感度";
    const prompt = buildComposeInsightsUserPrompt({ ...base, researchIntent: intent });
    expect(prompt).toContain("研究说明");
    expect(prompt).toContain("了解差旅用户对价格的敏感度");
    expect(prompt.indexOf("研究说明")).toBeLessThan(prompt.indexOf("Themes"));
  });

  it("omits backdrop when researchIntent is empty or undefined", () => {
    expect(buildComposeInsightsUserPrompt({ ...base, researchIntent: "" })).not.toContain(
      "研究说明",
    );
    expect(buildComposeInsightsUserPrompt(base)).not.toContain("研究说明");
  });

  it("treats whitespace-only researchIntent as empty", () => {
    expect(
      buildComposeInsightsUserPrompt({ ...base, researchIntent: "  \n\t" }),
    ).not.toContain("研究说明");
  });
});

import { describe, expect, it } from "vitest";

import {
  buildBackfillQueries,
  buildSurveyInstructionBackfillUpdate,
  parseBackfillApplyMode,
} from "../../scripts/backfill-survey-instruction";
import { Query } from "node-appwrite";

describe("buildSurveyInstructionBackfillUpdate", () => {
  it("creates an instruction update only for a blank instruction with legacy content", () => {
    const result = buildSurveyInstructionBackfillUpdate({
      $id: "survey-1",
      instruction: "  ",
      moderatorInstruction: "语气温和，不诱导",
      flowConfig: JSON.stringify({
        researchGoal: "了解续费决策",
        targetAudience: "最近续费的用户",
        introScript: "感谢参与",
        unrelatedFutureField: "keep-me",
      }),
    });

    expect(result).toMatchObject({
      kind: "update",
      surveyId: "survey-1",
      data: { instruction: expect.stringContaining("## 研究意图") },
    });
    if (result.kind !== "update") throw new Error("expected update");
    expect(result.data).not.toHaveProperty("flowConfig");
  });

  it("skips a survey whose instruction is already populated", () => {
    expect(
      buildSurveyInstructionBackfillUpdate({
        $id: "survey-2",
        instruction: "## 研究意图\n现有说明",
        moderatorInstruction: "legacy",
        flowConfig: JSON.stringify({ researchGoal: "legacy goal" }),
      }),
    ).toEqual({ kind: "skip-populated", surveyId: "survey-2" });
  });

  it("reports unresolved rather than inventing an instruction when every legacy source is blank", () => {
    expect(
      buildSurveyInstructionBackfillUpdate({
        $id: "survey-3",
        instruction: "",
        moderatorInstruction: " ",
        flowConfig: JSON.stringify({ researchGoal: " ", unrelatedFutureField: "keep-me" }),
      }),
    ).toEqual({ kind: "unresolved", surveyId: "survey-3" });
  });

  it("treats malformed flowConfig as empty legacy input without overwriting the row", () => {
    expect(
      buildSurveyInstructionBackfillUpdate({
        $id: "survey-4",
        instruction: "",
        moderatorInstruction: "",
        flowConfig: "{not-json",
      }),
    ).toEqual({ kind: "unresolved", surveyId: "survey-4" });
  });
});

describe("parseBackfillApplyMode", () => {
  it("defaults to dry-run and requires the exact apply flag for writes", () => {
    expect(parseBackfillApplyMode([])).toBe(false);
    expect(parseBackfillApplyMode(["--apply"])).toBe(true);
  });

  it("rejects unknown or combined flags before touching Appwrite", () => {
    expect(() => parseBackfillApplyMode(["--force"])).toThrow(/Usage/);
    expect(() => parseBackfillApplyMode(["--apply", "--force"])).toThrow(/Usage/);
  });
});

describe("buildBackfillQueries", () => {
  it("uses a stable id order and adds the resume cursor only when supplied", () => {
    expect(buildBackfillQueries()).toEqual([
      Query.orderAsc("$id"),
      Query.limit(100),
    ]);
    expect(buildBackfillQueries("survey-100")).toEqual([
      Query.orderAsc("$id"),
      Query.limit(100),
      Query.cursorAfter("survey-100"),
    ]);
  });
});

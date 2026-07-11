import { describe, expect, it } from "vitest";
import { TOOL_CATALOG, toolEnrichLabel, toolEnrichUrl } from "../tool-catalog";

describe("tool catalog", () => {
  it("keeps enrichUrl and enrichLabel in one static source", () => {
    expect(toolEnrichUrl("analyzeData")).toBe("/reports/{surveyId}");
    expect(toolEnrichUrl("createNotebook")).toBe("/notebooks/{notebookShortId}");
    expect(toolEnrichLabel("analyzeData")).toBe("查看完整报告");
    expect(toolEnrichLabel("createNotebook")).toBe("查看 Notebook");
  });

  it("covers all current Morris tools", () => {
    expect(Object.keys(TOOL_CATALOG).sort()).toEqual([
      "analyzeData",
      "createNotebook",
      "createStudyDraft",
      "listStudies",
      "manageMemories",
      "searchAcrossStudies",
      "searchInterviewData",
      "todoWrite",
    ]);
  });
});

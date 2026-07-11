import { describe, expect, it } from "vitest";
import { buildSurveyDraft } from "@merism/contracts";

describe("buildSurveyDraft", () => {
  it("preserves stimulus while ordering sections and questions", () => {
    const draft = buildSurveyDraft({
      survey: {
        title: "Survey",
        flowConfig: {
          researchGoal: "Goal",
          targetAudience: "Audience",
          introScript: "Intro",
        },
        moderatorInstruction: "Speak gently",
      },
      sections: [
        { $id: "s2", title: "Later", description: "Later objective", order: 1 },
        {
          $id: "s1",
          title: "First",
          description: "First objective",
          sectionInstruction: "Fallback objective",
          order: 0,
        },
      ],
      questions: [
        {
          $id: "q2",
          sectionId: "s1",
          prompt: "Choose one",
          type: "single_choice",
          orderInSection: 1,
          config: { options: ["A", "B"] },
          probeConfig: { level: "deep", instruction: "Probe" },
          stimulus: { id: "stim-1", type: "text", text: "Shown text" },
        },
        {
          $id: "q3",
          sectionId: "s2",
          prompt: "Another question",
          type: "open_ended",
          orderInSection: 0,
          config: {},
          probeConfig: undefined,
          stimulus: { id: "stim-2", type: "text", text: "Later text" },
        },
        {
          $id: "q1",
          sectionId: "s1",
          prompt: "Start here",
          type: "open_ended",
          orderInSection: 0,
          config: {},
          probeConfig: undefined,
        },
      ],
    });

    expect(draft.sections.map((section) => section.title)).toEqual(["First", "Later"]);
    expect(draft.sections[0]?.questions.map((question) => question.questionText)).toEqual([
      "Start here",
      "Choose one",
    ]);
    expect(draft.sections[0]?.questions[1]?.stimulus).toEqual({
      id: "stim-1",
      type: "text",
      text: "Shown text",
    });
  });
});

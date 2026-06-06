import { describe, it, expect } from "vitest";
import type { Survey, SurveySection, QuestionBlock } from "@merism/contracts";
import { assembleSurveyDraft } from "../survey-draft";

const survey: Survey = {
  $id: "sv1",
  projectId: "p1",
  title: "差旅住宿调研",
  status: "draft",
  flowConfig: {
    researchGoal: "了解预订习惯",
    targetAudience: "常旅客",
    introScript: "你好,感谢参与",
  },
  version: 1,
  updatedAt: "2024-12-03T00:00:00.000Z",
};

const sections: SurveySection[] = [
  { $id: "se2", surveyId: "sv1", title: "深入", description: "细节", order: 1 },
  { $id: "se1", surveyId: "sv1", title: "暖场", description: "整体习惯", order: 0 },
];

const questions: QuestionBlock[] = [
  {
    $id: "q2",
    surveyId: "sv1",
    sectionId: "se1",
    order: 1,
    orderInSection: 1,
    type: "single_choice",
    prompt: "更常用哪个平台?",
    config: { options: ["Airbnb", "Booking"], allowSkip: true },
    probeConfig: { level: "deep", instruction: "追问原因", maxRounds: 5 },
    probingPolicy: {},
    skipLogic: {},
  },
  {
    $id: "q1",
    surveyId: "sv1",
    sectionId: "se1",
    order: 0,
    orderInSection: 0,
    type: "open_ended",
    prompt: "常用的订房网站?",
    config: {},
    probingPolicy: {},
    skipLogic: {},
  },
];

describe("assembleSurveyDraft", () => {
  it("maps meta from flowConfig and orders sections/questions", () => {
    const draft = assembleSurveyDraft(survey, sections, questions);

    expect(draft.title).toBe("差旅住宿调研");
    expect(draft.researchGoal).toBe("了解预订习惯");
    expect(draft.targetAudience).toBe("常旅客");
    expect(draft.introScript).toBe("你好,感谢参与");

    // sections sorted by order
    expect(draft.sections.map((s) => s.title)).toEqual(["暖场", "深入"]);
    expect(draft.sections[0].objective).toBe("整体习惯");

    // questions sorted by orderInSection within the section
    const q = draft.sections[0].questions;
    expect(q.map((x) => x.questionText)).toEqual(["常用的订房网站?", "更常用哪个平台?"]);
    expect(q[0].questionType).toBe("open_ended");
    expect(q[0].allowSkip).toBe(false);
    expect(q[1].options).toEqual(["Airbnb", "Booking"]);
    expect(q[1].allowSkip).toBe(true);
    expect(q[1].probeLevel).toBe("deep");
    expect(q[1].probeInstruction).toBe("追问原因");
  });

  it("defaults missing meta to empty strings and coerces unknown question types", () => {
    const draft = assembleSurveyDraft(
      { ...survey, flowConfig: {} },
      [{ $id: "se1", surveyId: "sv1", title: "S", description: "D", order: 0 }],
      [
        {
          $id: "q1",
          surveyId: "sv1",
          sectionId: "se1",
          order: 0,
          orderInSection: 0,
          type: "text",
          prompt: "P",
          config: {},
          probingPolicy: {},
          skipLogic: {},
        },
      ],
    );
    expect(draft.researchGoal).toBe("");
    expect(draft.sections[0].questions[0].questionType).toBe("open_ended");
    expect(draft.sections[0].questions[0].probeLevel).toBe("standard");
  });
});

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildSurveyDraftFromDocs } from "../src/survey-draft-mapper";

// The SurveyDraft mapper used to live inline in deps.ts::createRoom and
// silently emitted `probeLevel: "none"` while StudyProbeLevelSchema only
// accepts `"standard" | "deep"`. The drift surfaced as a generic 500 when an
// interviewee tried to claim a token. These tests pin the mapping forever.

const baseSurvey = {
  $id: "sv1",
  title: "Survey",
  flowConfig: { researchGoal: "g", targetAudience: "t", introScript: "i" },
};
const baseSection = {
  $id: "sec1",
  title: "Section A",
  description: "Section objective",
  sectionInstruction: undefined,
  order: 0,
};
const baseQuestion = {
  $id: "q1",
  sectionId: "sec1",
  prompt: "How was your day?",
  type: "open_ended",
  orderInSection: 0,
  config: {},
  probeConfig: {},
  stimulus: { id: "stim1", type: "text", text: "Prompt" },
};

describe("buildSurveyDraftFromDocs — probeLevel mapping (contract drift guard)", () => {
  it("maps `deep` straight through", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: baseSurvey,
      sections: [baseSection],
      questions: [{ ...baseQuestion, probeConfig: { level: "deep" } }],
    });
    expect(draft.sections[0].questions[0].probeLevel).toBe("deep");
  });

  it("falls back to `standard` for missing probeConfig (default-survey path)", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: baseSurvey,
      sections: [baseSection],
      questions: [{ ...baseQuestion, probeConfig: undefined }],
    });
    expect(draft.sections[0].questions[0].probeLevel).toBe("standard");
  });

  it("falls back to `standard` for legacy enum values that are no longer in the schema", () => {
    for (const legacy of ["none", "follow_up", "shallow", "", "off"]) {
      const draft = buildSurveyDraftFromDocs({
        survey: baseSurvey,
        sections: [baseSection],
        questions: [{ ...baseQuestion, probeConfig: { level: legacy } }],
      });
      expect(draft.sections[0].questions[0].probeLevel, `legacy=${legacy}`).toBe("standard");
    }
  });

  it("property: any persisted level string produces a SurveyDraft that re-parses (no ZodError leak)", () => {
    fc.assert(
      fc.property(fc.option(fc.string()), (legacy) => {
        const draft = buildSurveyDraftFromDocs({
          survey: baseSurvey,
          sections: [baseSection],
          questions: [
            { ...baseQuestion, probeConfig: legacy === null ? undefined : { level: legacy } },
          ],
        });
        const level = draft.sections[0].questions[0].probeLevel;
        expect(level === "deep" || level === "standard").toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe("buildSurveyDraftFromDocs — moderatorInstruction passthrough (T16/T17 wiring guard)", () => {
  // Before this fix, `SurveyRow` did not carry `moderatorInstruction` and
  // `deps.ts::createRoom` never forwarded it. Researcher-authored persona was
  // silently dropped: `buildInterviewWorkflowConfigFromDraft` always saw
  // `draft.moderatorInstruction === ""` and composed the operational-only
  // supervisor instruction, even when guide-editor.tsx had captured the value
  // and `surveys.moderatorInstruction` was populated in Appwrite. This test
  // pins the contract: whatever the survey row carries reaches the draft
  // verbatim so the contract composer can do its job.
  it("passes researcher-authored moderatorInstruction through to the draft verbatim", () => {
    const persona = "Speak slowly, let pauses breathe, never read questions verbatim.";
    const draft = buildSurveyDraftFromDocs({
      survey: { ...baseSurvey, moderatorInstruction: persona },
      sections: [baseSection],
      questions: [baseQuestion],
    });
    expect(draft.moderatorInstruction).toBe(persona);
  });

  it("coerces missing / null / empty to the schema default \"\" (operational-base-only path)", () => {
    for (const empty of [undefined, null, ""] as const) {
      const draft = buildSurveyDraftFromDocs({
        survey: { ...baseSurvey, moderatorInstruction: empty },
        sections: [baseSection],
        questions: [baseQuestion],
      });
      expect(draft.moderatorInstruction, `empty=${String(empty)}`).toBe("");
    }
  });

  it("does not duplicate persona into researchGoal/targetAudience/introScript", () => {
    // Guards against a future refactor that 'helpfully' copies the persona
    // into flowConfig fields. researchGoal/targetAudience/introScript are
    // factual research backdrop; moderatorInstruction is delivery style.
    // The contract composer is the only place they meet.
    const persona = "warm, unhurried";
    const draft = buildSurveyDraftFromDocs({
      survey: { ...baseSurvey, moderatorInstruction: persona },
      sections: [baseSection],
      questions: [baseQuestion],
    });
    expect(draft.researchGoal).not.toBe(persona);
    expect(draft.targetAudience).not.toBe(persona);
    expect(draft.introScript).not.toBe(persona);
  });
});

describe("buildSurveyDraftFromDocs — section objective fallback", () => {
  it("uses description first", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: baseSurvey,
      sections: [{ ...baseSection, description: "desc here", sectionInstruction: "inst here" }],
      questions: [baseQuestion],
    });
    expect(draft.sections[0].objective).toBe("desc here");
  });

  it("falls back to sectionInstruction when description is empty", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: baseSurvey,
      sections: [{ ...baseSection, description: "", sectionInstruction: "inst here" }],
      questions: [baseQuestion],
    });
    expect(draft.sections[0].objective).toBe("inst here");
  });

  it("throws ZodError when both are empty (objective.min(1) violation surfaces, not silently)", () => {
    expect(() =>
      buildSurveyDraftFromDocs({
        survey: baseSurvey,
        sections: [{ ...baseSection, description: "", sectionInstruction: undefined }],
        questions: [baseQuestion],
      }),
    ).toThrow();
  });
});

describe("buildSurveyDraftFromDocs — flowConfig parsing", () => {
  it("uses researchGoal/targetAudience/introScript from parsed flowConfig", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: {
        $id: "sv1",
        title: "Survey",
        flowConfig: { researchGoal: "G", targetAudience: "A", introScript: "I" },
      },
      sections: [baseSection],
      questions: [baseQuestion],
    });
    expect(draft.researchGoal).toBe("G");
    expect(draft.targetAudience).toBe("A");
    expect(draft.introScript).toBe("I");
  });

  it("rejects when flowConfig is empty (researchGoal/min(1) violation)", () => {
    expect(() =>
      buildSurveyDraftFromDocs({
        survey: { $id: "sv1", title: "Survey", flowConfig: {} },
        sections: [baseSection],
        questions: [baseQuestion],
      }),
    ).toThrow();
  });
});

describe("buildSurveyDraftFromDocs — ordering", () => {
  it("sorts sections by order and questions by orderInSection", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: baseSurvey,
      sections: [
        { ...baseSection, $id: "secB", order: 1, description: "B" },
        { ...baseSection, $id: "secA", order: 0, description: "A" },
      ],
      questions: [
        { ...baseQuestion, $id: "qB2", sectionId: "secB", orderInSection: 1, prompt: "B2" },
        { ...baseQuestion, $id: "qA0", sectionId: "secA", orderInSection: 0, prompt: "A0" },
        { ...baseQuestion, $id: "qB0", sectionId: "secB", orderInSection: 0, prompt: "B0" },
      ],
    });
    expect(draft.sections.map((s) => s.objective)).toEqual(["A", "B"]);
    expect(draft.sections[0].questions.map((q) => q.questionText)).toEqual(["A0"]);
    expect(draft.sections[1].questions.map((q) => q.questionText)).toEqual(["B0", "B2"]);
  });
});

describe("buildSurveyDraftFromDocs — single_choice options invariant", () => {
  it("requires at least 2 options for choice-based questions (superRefine)", () => {
    expect(() =>
      buildSurveyDraftFromDocs({
        survey: baseSurvey,
        sections: [baseSection],
        questions: [
          {
            ...baseQuestion,
            type: "single_choice",
            config: { options: ["only one"] },
          },
        ],
      }),
    ).toThrow(/options/);
  });

  it("accepts 2+ options for choice-based questions", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: baseSurvey,
      sections: [baseSection],
      questions: [
        {
          ...baseQuestion,
          type: "single_choice",
          config: { options: ["a", "b"] },
        },
      ],
    });
    expect(draft.sections[0].questions[0].options).toEqual(["a", "b"]);
  });

  it("preserves stimulus from the persisted row", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: baseSurvey,
      sections: [baseSection],
      questions: [baseQuestion],
    });

    expect(draft.sections[0].questions[0].stimulus).toEqual(baseQuestion.stimulus);
  });
});

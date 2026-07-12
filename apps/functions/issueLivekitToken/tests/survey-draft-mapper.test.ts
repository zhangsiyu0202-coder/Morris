import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildSurveyDraftFromDocs, type SurveyRow } from "../src/survey-draft-mapper";

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
  skipLogic: {},
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
});

describe("buildSurveyDraftFromDocs — branchRules / stableId / stimulus read path (gap regression)", () => {
  // Before this fix, the mapper's QuestionRow shape only declared `config` and
  // `probeConfig` — the `skipLogic` (where the frontend piggybacks
  // branchRules) and `stimulus` fields were dropped on the floor, and
  // `config.stableId` / `config.allowSkip` weren't propagated either. The
  // guide editor let researchers configure branch rules in the UI, the writer
  // persisted them, but they never reached `SurveyDraft` → the flow-engine
  // composer emitted a purely linear flow and every branch rule was silently
  // no-op'd. These tests pin the corrected read path.

  it("propagates branchRules + stableId together so the SurveyDraft superRefine passes", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: baseSurvey,
      sections: [baseSection],
      questions: [
        {
          ...baseQuestion,
          $id: "q1",
          orderInSection: 0,
          config: { stableId: "sid-1" },
          skipLogic: {
            branchRules: [{ condition: "answer mentions frustration", jumpToQuestionId: "sid-2" }],
          },
        },
        {
          ...baseQuestion,
          $id: "q2",
          orderInSection: 1,
          prompt: "Second question",
          config: { stableId: "sid-2" },
        },
      ],
    });

    expect(draft.sections[0].questions[0].stableId).toBe("sid-1");
    expect(draft.sections[0].questions[0].branchRules).toEqual([
      { condition: "answer mentions frustration", jumpToQuestionId: "sid-2" },
    ]);
    expect(draft.sections[0].questions[1].stableId).toBe("sid-2");
    expect(draft.sections[0].questions[1].branchRules).toEqual([]);
  });

  it("propagates allowSkip from config", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: baseSurvey,
      sections: [baseSection],
      questions: [{ ...baseQuestion, config: { allowSkip: true } }],
    });
    expect(draft.sections[0].questions[0].allowSkip).toBe(true);
  });

  it("propagates stimulus when present", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: baseSurvey,
      sections: [baseSection],
      questions: [
        {
          ...baseQuestion,
          stimulus: {
            id: "stim-1",
            type: "image",
            url: "https://example.com/pic.png",
          },
        },
      ],
    });
    expect(draft.sections[0].questions[0].stimulus).toEqual({
      id: "stim-1",
      type: "image",
      url: "https://example.com/pic.png",
    });
  });

  it("omits stimulus when undefined so the schema's optional handling is preserved", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: baseSurvey,
      sections: [baseSection],
      questions: [{ ...baseQuestion, stimulus: undefined }],
    });
    expect(draft.sections[0].questions[0].stimulus).toBeUndefined();
  });

  it("treats missing skipLogic bucket as empty branchRules (legacy row)", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: baseSurvey,
      sections: [baseSection],
      questions: [{ ...baseQuestion, skipLogic: undefined }],
    });
    expect(draft.sections[0].questions[0].branchRules).toEqual([]);
  });

  it("treats non-array branchRules payload as empty (defensive on bad writer)", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: baseSurvey,
      sections: [baseSection],
      questions: [
        {
          ...baseQuestion,
          skipLogic: { branchRules: "not an array" as unknown as never[] },
        },
      ],
    });
    expect(draft.sections[0].questions[0].branchRules).toEqual([]);
  });

  it("rejects branchRules whose jumpToQuestionId does not resolve to any stableId (SurveyDraft superRefine)", () => {
    expect(() =>
      buildSurveyDraftFromDocs({
        survey: baseSurvey,
        sections: [baseSection],
        questions: [
          {
            ...baseQuestion,
            config: { stableId: "sid-1" },
            skipLogic: {
              branchRules: [{ condition: "x", jumpToQuestionId: "sid-does-not-exist" }],
            },
          },
        ],
      }),
    ).toThrow(/jumpToQuestionId/);
  });
});

describe("buildSurveyDraftFromDocs — Survey.moderatorInstruction read path (persona chain regression)", () => {
  // Before this fix, `SurveyRow` had no moderatorInstruction field and the
  // SDK wrapper did not pass one through, so every published survey lost
  // the researcher's persona directive on its way to the flow-engine.
  // AGENTS.md § "Instruction 字段链" step 3 literally warns: "这一步漏一
  // 字段就会让研究员的 persona 整条链被静默丢掉". These tests pin the fix.

  it("propagates a non-empty moderatorInstruction to the draft", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: { ...baseSurvey, moderatorInstruction: "warm, professional, no clinical language" },
      sections: [baseSection],
      questions: [baseQuestion],
    });
    expect(draft.moderatorInstruction).toBe("warm, professional, no clinical language");
  });

  it("treats missing moderatorInstruction as empty string (schema default) for legacy surveys", () => {
    // moderatorInstruction is optional on the SurveyRow shape; omit it
    // entirely to simulate a legacy row that predates the column.
    const { moderatorInstruction: _drop, ...withoutField } = baseSurvey as SurveyRow & {
      moderatorInstruction?: string;
    };
    void _drop;
    const draft = buildSurveyDraftFromDocs({
      survey: withoutField,
      sections: [baseSection],
      questions: [baseQuestion],
    });
    expect(draft.moderatorInstruction).toBe("");
  });

  it("passes through a whitespace-heavy moderatorInstruction that the schema trims", () => {
    // SurveyDraftSchema.moderatorInstruction has .trim() — verify the
    // schema-level trim happens rather than the mapper silently
    // trimming out of turn (which would be surprising to a caller who
    // wrote leading whitespace deliberately).
    const draft = buildSurveyDraftFromDocs({
      survey: { ...baseSurvey, moderatorInstruction: "   keep-me   " },
      sections: [baseSection],
      questions: [baseQuestion],
    });
    expect(draft.moderatorInstruction).toBe("keep-me");
  });
});

describe("buildSurveyDraftFromDocs — Survey.instruction (ADR-0015 primary field)", () => {
  // The ADR-0015 rollout adds a new top-level `Survey.instruction` column
  // carrying the CLAUDE.md-style AI moderator operating manual. The mapper
  // reads it through; during Wave 1 the field is still optional so legacy
  // rows (that predate the column) continue to work — the composer's
  // fallback path rebuilds a supervisor instruction from the four legacy
  // fields when this one is empty.

  it("propagates a non-empty instruction to the draft", () => {
    const markdown = [
      "## 研究意图",
      "了解设计师在跨部门评审时的沟通痛点。",
      "",
      "## 主持行为要点",
      "- 语气温和,允许沉默",
      "- 遇到抽象回答,追问具体案例",
    ].join("\n");
    const draft = buildSurveyDraftFromDocs({
      survey: { ...baseSurvey, instruction: markdown },
      sections: [baseSection],
      questions: [baseQuestion],
    });
    expect(draft.instruction).toBe(markdown);
  });

  it("defaults to '' when survey has no instruction column (legacy row)", () => {
    const { instruction: _drop, ...withoutField } = baseSurvey as SurveyRow & {
      instruction?: string;
    };
    void _drop;
    const draft = buildSurveyDraftFromDocs({
      survey: withoutField,
      sections: [baseSection],
      questions: [baseQuestion],
    });
    expect(draft.instruction).toBe("");
  });

  it("preserves instruction independently of moderatorInstruction (both fields coexist during migration)", () => {
    const draft = buildSurveyDraftFromDocs({
      survey: {
        ...baseSurvey,
        moderatorInstruction: "legacy persona",
        instruction: "new markdown manual",
      },
      sections: [baseSection],
      questions: [baseQuestion],
    });
    expect(draft.moderatorInstruction).toBe("legacy persona");
    expect(draft.instruction).toBe("new markdown manual");
  });
});

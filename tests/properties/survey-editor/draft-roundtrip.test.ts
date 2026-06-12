import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Survey, SurveySection, QuestionBlock, SurveyDraft } from "@merism/contracts";
import { assembleSurveyDraft } from "../../../apps/web/lib/survey/draft";

/**
 * P-DATA-01 (survey-editor): 对任意合法 SurveyDraft,写→读往返语义等价。
 *
 * 这里以纯函数复刻 lib/actions/survey.ts 的写映射(draft → 三类文档),再用真实的
 * assembleSurveyDraft 读回,断言与原 draft 等价。live 版见 scripts/verify-survey-editor.ts。
 */

const questionTypeArb = fc.constantFrom(
  "open_ended",
  "single_choice",
  "multi_choice",
  "rating",
  "nps",
  "ranking",
) as fc.Arbitrary<SurveyDraft["sections"][number]["questions"][number]["questionType"]>;

const questionArb = fc.record({
  questionText: fc.string({ minLength: 1 }),
  questionType: questionTypeArb,
  probeLevel: fc.constantFrom("standard", "deep") as fc.Arbitrary<"standard" | "deep">,
  probeInstruction: fc.string(),
  options: fc.array(fc.string({ minLength: 1 }), { maxLength: 5 }),
  allowSkip: fc.boolean(),
});

const sectionArb = fc.record({
  title: fc.string({ minLength: 1 }),
  objective: fc.string({ minLength: 1 }),
  questions: fc.array(questionArb, { minLength: 1, maxLength: 4 }),
});

const draftArb: fc.Arbitrary<SurveyDraft> = fc.record({
  title: fc.string({ minLength: 1 }),
  researchGoal: fc.string(),
  targetAudience: fc.string(),
  introScript: fc.string(),
  sections: fc.array(sectionArb, { minLength: 1, maxLength: 4 }),
});

// --- pure mirror of the write path (lib/actions/survey.ts) ---
function draftToDocs(draft: SurveyDraft): {
  survey: Survey;
  sections: SurveySection[];
  questions: QuestionBlock[];
} {
  const survey = {
    $id: "sv",
    projectId: "default",
    title: draft.title,
    status: "draft",
    flowConfig: {
      researchGoal: draft.researchGoal,
      targetAudience: draft.targetAudience,
      introScript: draft.introScript,
    },
    version: 1,
    updatedAt: "2024-01-01T00:00:00.000Z",
  } as Survey;

  const sections: SurveySection[] = [];
  const questions: QuestionBlock[] = [];
  let order = 0;
  draft.sections.forEach((s, si) => {
    const sectionId = `se${si}`;
    sections.push({ $id: sectionId, surveyId: "sv", title: s.title, description: s.objective, order: si });
    s.questions.forEach((q, qi) => {
      questions.push({
        $id: `q${order}`,
        surveyId: "sv",
        sectionId,
        order: order++,
        orderInSection: qi,
        type: q.questionType,
        prompt: q.questionText,
        config: { options: q.options, allowSkip: q.allowSkip },
        probeConfig: { level: q.probeLevel, instruction: q.probeInstruction, maxRounds: q.probeLevel === "deep" ? 5 : 3 },
        probingPolicy: {},
        skipLogic: {},
      } as unknown as QuestionBlock);
    });
  });
  return { survey, sections, questions };
}

describe("P-DATA-01: SurveyDraft write->read roundtrip is lossless", () => {
  it("assembleSurveyDraft reproduces the original draft", () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const { survey, sections, questions } = draftToDocs(draft);
        const out = assembleSurveyDraft(survey, sections, questions);

        expect(out.title).toBe(draft.title);
        expect(out.researchGoal).toBe(draft.researchGoal);
        expect(out.targetAudience).toBe(draft.targetAudience);
        expect(out.introScript).toBe(draft.introScript);
        expect(out.sections.length).toBe(draft.sections.length);

        draft.sections.forEach((s, si) => {
          const os = out.sections[si];
          expect(os.title).toBe(s.title);
          expect(os.objective).toBe(s.objective);
          expect(os.questions.length).toBe(s.questions.length);
          s.questions.forEach((q, qi) => {
            const oq = os.questions[qi];
            expect(oq.questionText).toBe(q.questionText);
            expect(oq.questionType).toBe(q.questionType);
            expect(oq.probeLevel).toBe(q.probeLevel);
            expect(oq.probeInstruction).toBe(q.probeInstruction);
            expect(oq.options).toEqual(q.options);
            expect(oq.allowSkip).toBe(q.allowSkip);
          });
        });
      }),
    );
  });
});

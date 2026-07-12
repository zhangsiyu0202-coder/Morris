// P-FLOW-01 through P-FLOW-05: pure state machine invariants for the
// Section → Question walk, ported per ADR-0013 § Migration completeness bar
// §8 from the deleted `apps/agent/tests/properties/test_workflow_state.py`
// (Python hypothesis) to TS vitest+fast-check. These properties are the
// backbone of the interview correctness contract preserved from ADR-0001.
import { describe, it, expect } from "vitest";
import fc from "fast-check";

import type {
  InterviewWorkflowConfig,
  QuestionTaskConfig,
  QuestionTaskResult,
  SectionTaskGroupConfig,
} from "@merism/contracts";

import {
  advanceTo,
  collectedAnswersMap,
  completedQuestionCount,
  findNextCursor,
  flattenQuestions,
  initialWorkflowState,
  isComplete,
  recordQuestionResult,
  totalQuestionCount,
} from "../../../apps/agent-voice-worker/src/interview/workflow-state.js";

// --- arbitraries --------------------------------------------------------

const questionType = fc.constantFrom<QuestionTaskConfig["questionType"]>(
  "open_ended",
  "single_choice",
  "multi_choice",
  "rating",
  "nps",
  "ranking",
);

function questionArb(idPrefix: string) {
  return fc
    .record({
      idx: fc.nat({ max: 999 }),
      questionType,
      content: fc.string({ minLength: 1, maxLength: 60 }),
      hasOptions: fc.boolean(),
    })
    .map(
      (r): QuestionTaskConfig => ({
        questionId: `${idPrefix}-q-${r.idx}`,
        questionType: r.questionType,
        questionContent: r.content,
        options: r.hasOptions ? ["A", "B", "C"] : [],
        probeConfig: {
          level: "standard",
          instruction: "probe",
          maxRounds: 2,
        },
      }),
    );
}

function sectionArb(sectionIdx: number) {
  return fc
    .array(questionArb(`s-${sectionIdx}`), { minLength: 1, maxLength: 4 })
    .map(
      (questions): SectionTaskGroupConfig => ({
        sectionId: `s-${sectionIdx}`,
        title: `section ${sectionIdx}`,
        description: "obj",
        sectionInstruction: "instr",
        questions: dedupeById(questions),
      }),
    );
}

const configArb: fc.Arbitrary<InterviewWorkflowConfig> = fc
  .array(fc.constant(0), { minLength: 1, maxLength: 4 })
  .chain((slots) =>
    fc
      .tuple(...slots.map((_, i) => sectionArb(i)))
      .map((sections): InterviewWorkflowConfig => {
        // ensure section ids are unique (arbitrary index-based already, but
        // dedupeById questions inside each section)
        return {
          surveyId: "srv",
          sessionId: "sess",
          supervisorInstruction: "s",
          sections: sections as SectionTaskGroupConfig[],
        };
      }),
  );

function dedupeById(qs: QuestionTaskConfig[]): QuestionTaskConfig[] {
  const seen = new Set<string>();
  const out: QuestionTaskConfig[] = [];
  for (const q of qs) {
    if (seen.has(q.questionId)) continue;
    seen.add(q.questionId);
    out.push(q);
  }
  return out;
}

function fakeResult(q: QuestionTaskConfig): QuestionTaskResult {
  return {
    questionType: q.questionType,
    questionContent: q.questionContent,
    respondentAnswer: "answer",
    probe: null,
  };
}

// --- properties ---------------------------------------------------------

describe("P-FLOW-01: initialWorkflowState positions at first question", () => {
  it("first section's first question is the cursor", () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const state = initialWorkflowState(config);
        const firstSection = config.sections[0];
        const firstQuestion = firstSection.questions[0];
        expect(state.currentSectionId).toBe(firstSection.sectionId);
        expect(state.currentQuestionTaskId).toBe(firstQuestion.questionId);
        expect(state.sessionId).toBe(config.sessionId);
        expect(state.surveyId).toBe(config.surveyId);
      }),
    );
  });
});

describe("P-FLOW-02: completedQuestionCount is monotone non-decreasing across recordings", () => {
  it("each record either increments or leaves count unchanged (idempotent on same qid)", () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const state = initialWorkflowState(config);
        const flat = flattenQuestions(config);
        let prev = completedQuestionCount(state);
        for (const { section, question } of flat) {
          recordQuestionResult(state, {
            sectionId: section.sectionId,
            questionId: question.questionId,
            result: fakeResult(question),
          });
          const next = completedQuestionCount(state);
          expect(next).toBeGreaterThanOrEqual(prev);
          prev = next;
        }
        // record the same question again → count unchanged (idempotent write)
        const before = completedQuestionCount(state);
        const { section, question } = flat[0];
        recordQuestionResult(state, {
          sectionId: section.sectionId,
          questionId: question.questionId,
          result: fakeResult(question),
        });
        expect(completedQuestionCount(state)).toBe(before);
      }),
    );
  });
});

describe("P-FLOW-03: isComplete iff all questions have results", () => {
  it("false before all recorded, true after all recorded", () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const state = initialWorkflowState(config);
        const total = totalQuestionCount(config);
        expect(isComplete(state)).toBe(total === 0);
        for (const { section, question } of flattenQuestions(config)) {
          recordQuestionResult(state, {
            sectionId: section.sectionId,
            questionId: question.questionId,
            result: fakeResult(question),
          });
        }
        expect(isComplete(state)).toBe(true);
      }),
    );
  });
});

describe("P-FLOW-04: findNextCursor walks sections in configured order, questions in configured order", () => {
  it("emits exactly the flatten order and returns null after last", () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const state = initialWorkflowState(config);
        const flat = flattenQuestions(config);
        // consume one at a time via advanceTo(next)
        for (let i = 0; i < flat.length - 1; i++) {
          const next = findNextCursor(state);
          expect(next).not.toBeNull();
          expect(next!.sectionId).toBe(flat[i + 1].section.sectionId);
          expect(next!.questionId).toBe(flat[i + 1].question.questionId);
          advanceTo(state, next!);
        }
        // At the last question, next is null.
        expect(findNextCursor(state)).toBeNull();
      }),
    );
  });
});

describe("P-FLOW-05: collectedAnswersMap key set == recorded questions", () => {
  it("map keys equal set of recorded questionIds; entries carry sectionId/answer/source", () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const state = initialWorkflowState(config);
        const flat = flattenQuestions(config);
        const recordedIds: string[] = [];
        for (const { section, question } of flat) {
          recordQuestionResult(state, {
            sectionId: section.sectionId,
            questionId: question.questionId,
            result: fakeResult(question),
          });
          recordedIds.push(question.questionId);
        }
        const answers = collectedAnswersMap(state);
        expect(Object.keys(answers).sort()).toEqual([...recordedIds].sort());
        for (const [qid, entry] of Object.entries(answers)) {
          expect(entry.answer).toBe("answer");
          expect(entry.source).toBe("voice");
          const found = flat.find((f) => f.question.questionId === qid);
          expect(found).toBeDefined();
          expect(entry.sectionId).toBe(found!.section.sectionId);
        }
      }),
    );
  });
});

/**
 * Tests for `buildInterviewFlowConfigFromDraft` branch rule compilation.
 *
 * Rules are `{ condition: string, jumpToQuestionId: string }` — a natural-
 * language condition + target. The composer inserts a ConditionStep after
 * each question with rules; each rule becomes one ConditionStep item whose
 * predicate carries the condition verbatim. Runtime evaluation is the
 * host's LLM job (see `agent/flow_engine/condition_eval.py`).
 */
import { describe, expect, it } from "vitest";
import {
  buildInterviewFlowConfigFromDraft,
  SurveyDraftSchema,
  type SurveyDraft,
} from "../src/api.js";

function draftWithStableIds(): SurveyDraft {
  return {
    title: "Branch Study",
    researchGoal: "test branches",
    targetAudience: "testers",
    introScript: "Hi.",
    moderatorInstruction: "",
    sections: [
      {
        title: "Q",
        objective: "test",
        questions: [
          {
            stableId: "s1",
            questionText: "你是学生吗?",
            questionType: "open_ended",
            probeLevel: "standard",
            probeInstruction: "",
            options: [],
            allowSkip: false,
            branchRules: [],
          },
          {
            stableId: "s2",
            questionText: "你的专业?",
            questionType: "open_ended",
            probeLevel: "standard",
            probeInstruction: "",
            options: [],
            allowSkip: false,
            branchRules: [],
          },
          {
            stableId: "s3",
            questionText: "你的工作?",
            questionType: "open_ended",
            probeLevel: "standard",
            probeInstruction: "",
            options: [],
            allowSkip: false,
            branchRules: [],
          },
        ],
      },
    ],
  };
}

function targetOf(cfg: ReturnType<typeof buildInterviewFlowConfigFromDraft>, stepId: string): string | null {
  const step = cfg.steps.find((s) => s.stepId === stepId);
  if (!step?.outgoingEdgeId) return null;
  return cfg.edges.find((e) => e.id === step.outgoingEdgeId)?.to.stepId ?? null;
}

describe("branchRules → ConditionStep compilation", () => {
  it("inserts a ConditionStep after a question with any branch rules", () => {
    const draft = draftWithStableIds();
    draft.sections[0].questions[0].branchRules = [
      { condition: "用户在学习", jumpToQuestionId: "s2" },
    ];
    const parsed = SurveyDraftSchema.parse(draft);
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: parsed,
    });

    // Sequence: q_s1 → c_s1 → p_s1 → q_s2 → p_s2 → q_s3 → p_s3
    expect(cfg.steps.map((s) => s.stepId)).toEqual([
      "q_s1", "c_s1", "p_s1", "q_s2", "p_s2", "q_s3", "p_s3",
    ]);
    // q_s1 flows to c_s1 (not directly to p_s1)
    expect(targetOf(cfg, "q_s1")).toBe("c_s1");
    // c_s1 default (no rule matched) flows to p_s1 (backbone restored)
    expect(targetOf(cfg, "c_s1")).toBe("p_s1");
  });

  it("each branch rule becomes exactly one ConditionStep item in declared order", () => {
    const draft = draftWithStableIds();
    draft.sections[0].questions[0].branchRules = [
      { condition: "用户是全职学生", jumpToQuestionId: "s2" },
      { condition: "用户在工作或创业", jumpToQuestionId: "s3" },
    ];
    const parsed = SurveyDraftSchema.parse(draft);
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: parsed,
    });

    const c1 = cfg.steps.find((s) => s.stepId === "c_s1")!;
    if (c1.kind !== "condition") throw new Error("expected condition step");
    expect(c1.items.length).toBe(2);
    expect(c1.items[0].predicate.condition).toBe("用户是全职学生");
    expect(c1.items[0].predicate.sourceStepId).toBe("q_s1");
    expect(c1.items[1].predicate.condition).toBe("用户在工作或创业");

    const edgeById = new Map(cfg.edges.map((e) => [e.id, e]));
    // Item 0 routes to q_s2
    expect(edgeById.get(c1.items[0].outgoingEdgeId!)!.to.stepId).toBe("q_s2");
    // Item 1 routes to q_s3
    expect(edgeById.get(c1.items[1].outgoingEdgeId!)!.to.stepId).toBe("q_s3");
  });

  it("ConditionStep default outgoingEdgeId restores backbone (probe if present)", () => {
    const draft = draftWithStableIds();
    draft.sections[0].questions[1].branchRules = [
      { condition: "用户提到关键词", jumpToQuestionId: "s1" },
    ];
    const parsed = SurveyDraftSchema.parse(draft);
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: parsed,
    });

    // Q2 has a probe (standard level). c_s2 default should go to p_s2.
    expect(targetOf(cfg, "c_s2")).toBe("p_s2");
  });

  it("SurveyDraft rejects branchRule with target not in draft (when stableIds exist)", () => {
    const draft = draftWithStableIds();
    draft.sections[0].questions[0].branchRules = [
      { condition: "cond", jumpToQuestionId: "nonexistent" },
    ];
    const result = SurveyDraftSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((e) => e.message.includes("does not reference"))).toBe(true);
    }
  });

  it("SurveyDraft rejects branchRule with empty condition (min-length trim)", () => {
    const draft = draftWithStableIds();
    draft.sections[0].questions[0].branchRules = [
      { condition: "   ", jumpToQuestionId: "s2" },
    ];
    const result = SurveyDraftSchema.safeParse(draft);
    expect(result.success).toBe(false);
  });

  it("SurveyDraft rejects branchRule with condition exceeding 500 chars", () => {
    const draft = draftWithStableIds();
    draft.sections[0].questions[0].branchRules = [
      { condition: "a".repeat(501), jumpToQuestionId: "s2" },
    ];
    const result = SurveyDraftSchema.safeParse(draft);
    expect(result.success).toBe(false);
  });

  it("draft with no branchRules keeps legacy linear layout (no ConditionStep inserted)", () => {
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: draftWithStableIds(),
    });
    expect(cfg.steps.some((s) => s.kind === "condition")).toBe(false);
    expect(cfg.steps.map((s) => s.stepId)).toEqual([
      "q_s1", "p_s1", "q_s2", "p_s2", "q_s3", "p_s3",
    ]);
  });

  it("legacy draft (no stableIds) uses positional question ids", () => {
    const draft = draftWithStableIds();
    delete draft.sections[0].questions[0].stableId;
    delete draft.sections[0].questions[1].stableId;
    delete draft.sections[0].questions[2].stableId;
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft,
    });
    expect(cfg.steps.map((s) => s.stepId)).toContain("q_question-1-1");
    expect(cfg.steps.map((s) => s.stepId)).toContain("q_question-1-2");
    expect(cfg.steps.map((s) => s.stepId)).toContain("q_question-1-3");
  });
});

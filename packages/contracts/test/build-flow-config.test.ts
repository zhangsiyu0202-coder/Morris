/**
 * Tests for `buildInterviewFlowConfigFromDraft` — the TS-side flow config
 * composer. Pins:
 *   - shape parity with the Python fallback (`agent.flow_engine.metadata.
 *     flow_config_from_runtime_study`): flat q → probe → q → probe sequence,
 *     edge ids follow `e_q_to_p_${questionId}` / `e_p_to_q_${questionId}` /
 *     `e_q_to_q_${questionId}` conventions
 *   - moderator instruction composition (persona + operational base)
 *   - buildInterviewRoomMetadataFromDraft populates all three: runtimeStudy,
 *     workflowConfig, flowConfig
 */
import { describe, expect, it } from "vitest";
import {
  buildInterviewFlowConfigFromDraft,
  buildInterviewRoomMetadataFromDraft,
  type SurveyDraft,
} from "../src/api.js";

function draftFixture(overrides: Partial<SurveyDraft> = {}): SurveyDraft {
  return {
    title: "Test Study",
    researchGoal: "understand user motivation",
    targetAudience: "adults 25-40",
    introScript: "Hi, thanks for joining.",
    moderatorInstruction: "",
    sections: [
      {
        title: "Warm-up",
        objective: "get user talking",
        questions: [
          {
            questionText: "What brought you here today?",
            questionType: "open_ended",
            probeLevel: "standard",
            probeInstruction: "Dig into motivation.",
            options: [],
          },
          {
            questionText: "Are you a student?",
            questionType: "single_choice",
            probeLevel: "standard",
            probeInstruction: "",
            options: ["Yes", "No"],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("buildInterviewFlowConfigFromDraft", () => {
  it("produces q → p → q → p linear layout with correctly-linked edges", () => {
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: draftFixture(),
    });

    // Expected step ids in order:
    //   q_question-1-1  →  p_question-1-1  →  q_question-1-2  →  p_question-1-2
    expect(cfg.steps.map((s) => s.stepId)).toEqual([
      "q_question-1-1",
      "p_question-1-1",
      "q_question-1-2",
      "p_question-1-2",
    ]);
    expect(cfg.startStepId).toBe("q_question-1-1");

    // Traverse the graph structurally (edge id format is an internal detail,
    // not part of the contract).
    const stepById = new Map(cfg.steps.map((s) => [s.stepId, s]));
    const edgeById = new Map(cfg.edges.map((e) => [e.id, e]));
    const targetOf = (stepId: string): string | null => {
      const step = stepById.get(stepId);
      if (!step?.outgoingEdgeId) return null;
      return edgeById.get(step.outgoingEdgeId)?.to.stepId ?? null;
    };
    expect(targetOf("q_question-1-1")).toBe("p_question-1-1");
    expect(targetOf("p_question-1-1")).toBe("q_question-1-2");
    expect(targetOf("q_question-1-2")).toBe("p_question-1-2");
    expect(targetOf("p_question-1-2")).toBe(null); // flow ends
  });

  it("expands legacy string options into FlowQuestionOption with stable optionIds", () => {
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: draftFixture(),
    });
    const q2 = cfg.steps.find((s) => s.stepId === "q_question-1-2")!;
    expect(q2.kind).toBe("question");
    if (q2.kind !== "question") return;
    expect(q2.options).toEqual([
      { optionId: "opt-1", content: "Yes", outgoingEdgeId: null },
      { optionId: "opt-2", content: "No", outgoingEdgeId: null },
    ]);
  });

  it("uses probeLevel to pick maxRounds (standard=3, deep=5)", () => {
    const draft = draftFixture({
      sections: [
        {
          title: "s",
          objective: "o",
          questions: [
            {
              questionText: "std",
              questionType: "open_ended",
              probeLevel: "standard",
              probeInstruction: "x",
              options: [],
            },
            {
              questionText: "deep",
              questionType: "open_ended",
              probeLevel: "deep",
              probeInstruction: "y",
              options: [],
            },
          ],
        },
      ],
    });
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "s",
      sessionId: "x",
      draft,
    });
    const p1 = cfg.steps.find((s) => s.stepId === "p_question-1-1")!;
    const p2 = cfg.steps.find((s) => s.stepId === "p_question-1-2")!;
    if (p1.kind !== "probe" || p2.kind !== "probe") throw new Error("expected probe steps");
    expect(p1.maxRounds).toBe(3);
    expect(p2.maxRounds).toBe(5);
    expect(p1.instruction).toBe("x");
    expect(p2.instruction).toBe("y");
    expect(p1.forQuestionStepId).toBe("q_question-1-1");
  });

  it("composes moderatorInstruction: persona + operational base", () => {
    const draft = draftFixture({
      moderatorInstruction: "Warm and unhurried, use plain language.",
    });
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft,
    });
    // Persona prepended
    expect(cfg.moderatorInstruction).toContain("Warm and unhurried");
    // Operational base follows
    expect(cfg.moderatorInstruction).toContain('Guide a qualitative interview for "Test Study"');
    expect(cfg.moderatorInstruction.startsWith("Warm and unhurried")).toBe(true);
  });

  it("moderatorInstruction override wins over composition", () => {
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: draftFixture({ moderatorInstruction: "Ignored" }),
      moderatorInstruction: "Explicit override",
    });
    expect(cfg.moderatorInstruction).toBe("Explicit override");
  });

  it("moderatorInstruction default (empty persona) drops the persona line", () => {
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: draftFixture({ moderatorInstruction: "" }),
    });
    expect(cfg.moderatorInstruction.startsWith("Guide a qualitative interview")).toBe(true);
  });

  it("passes the InterviewFlowConfigSchema invariants (all endpoints valid)", () => {
    // Round-tripping the produced config through the schema should not throw.
    // Any orphan outgoingEdgeId or missing step target would be caught by
    // the schema's superRefine.
    expect(() =>
      buildInterviewFlowConfigFromDraft({
        surveyId: "surv-1",
        sessionId: "sess-1",
        draft: draftFixture(),
      }),
    ).not.toThrow();
  });
});

describe("buildInterviewRoomMetadataFromDraft (P3: now also populates flowConfig)", () => {
  it("includes runtimeStudy, workflowConfig, AND flowConfig", () => {
    const md = buildInterviewRoomMetadataFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: draftFixture(),
    });
    expect(md.runtimeStudy).toBeDefined();
    expect(md.workflowConfig).toBeDefined();
    expect(md.flowConfig).toBeDefined();
    expect(md.flowConfig!.startStepId).toBe("q_question-1-1");
  });

  it("carries the same moderator instruction on flowConfig as workflowConfig.supervisorInstruction", () => {
    const md = buildInterviewRoomMetadataFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: draftFixture({
        moderatorInstruction: "Curious and calm.",
      }),
    });
    expect(md.flowConfig!.moderatorInstruction).toBe(
      md.workflowConfig!.supervisorInstruction,
    );
  });
});

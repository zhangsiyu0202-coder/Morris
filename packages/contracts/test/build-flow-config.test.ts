/**
 * Tests for `buildInterviewFlowConfigFromDraft` — the TS-side flow config
 * composer. Pins:
 *   - shape parity with the Python fallback (`agent.flow_engine.metadata.
 *     flow_config_from_runtime_study`): flat q → probe → q → probe sequence,
 *     edge ids follow `e_q_to_p_${questionId}` / `e_p_to_q_${questionId}` /
 *     `e_q_to_q_${questionId}` conventions
 *   - instruction passthrough into the flow config
 *   - buildInterviewRoomMetadataFromDraft retains runtimeStudy for structured
 *     progress and emits only the flow-engine config for moderation
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
    instruction: "## 研究意图\n默认测试说明。",
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

  it("moderatorInstruction override wins over composition", () => {
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: draftFixture({ moderatorInstruction: "Ignored" }),
      moderatorInstruction: "Explicit override",
    });
    expect(cfg.moderatorInstruction).toBe("Explicit override");
  });

  // ADR-0015 — `draft.instruction` (CLAUDE.md-style single markdown doc)
  // supersedes the four legacy fields when non-empty. Composer plumbing
  // tests. UI/mapper/writer tests live in the mapper suite + web action
  // suite; here we pin the composer's preference order only.

  it("instruction (ADR-0015) supersedes composed persona+operational when non-empty", () => {
    const markdown = [
      "## 研究意图",
      "了解设计师在跨部门评审时的沟通痛点。",
      "",
      "## 主持行为要点",
      "- 语气温和",
    ].join("\n");
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: draftFixture({
        instruction: markdown,
        // These legacy values would compose into a supervisorInstruction
        // string that starts with "Legacy persona"; the ADR-0015
        // instruction must win over that composition.
        moderatorInstruction: "Legacy persona should be ignored",
      }),
    });
    expect(cfg.moderatorInstruction).toBe(markdown);
    // no compose wrapper added
    expect(cfg.moderatorInstruction).not.toContain("Guide a qualitative interview");
    expect(cfg.moderatorInstruction).not.toContain("Legacy persona");
  });

  it("instruction empty (legacy row) falls back to composed persona+operational", () => {
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: draftFixture({
        instruction: "",
        moderatorInstruction: "Warm and unhurried.",
      }),
    });
    expect(cfg.moderatorInstruction.startsWith("Warm and unhurried")).toBe(true);
    expect(cfg.moderatorInstruction).toContain("Guide a qualitative interview");
  });

  it("instruction whitespace-only counts as empty (falls back to legacy compose)", () => {
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: draftFixture({ instruction: "   \n\t  ", moderatorInstruction: "Persona" }),
    });
    expect(cfg.moderatorInstruction.startsWith("Persona")).toBe(true);
  });

  it("explicit override still wins over instruction (composer symmetry)", () => {
    const cfg = buildInterviewFlowConfigFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: draftFixture({ instruction: "would-normally-win" }),
      moderatorInstruction: "Explicit override",
    });
    expect(cfg.moderatorInstruction).toBe("Explicit override");
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

describe("buildInterviewRoomMetadataFromDraft", () => {
  it("includes runtimeStudy and flowConfig", () => {
    const md = buildInterviewRoomMetadataFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: draftFixture(),
    });
    expect(md.runtimeStudy).toBeDefined();
    expect(md.flowConfig).toBeDefined();
    expect(md.flowConfig!.startStepId).toBe("q_question-1-1");
  });

  it("copies instruction verbatim to flowConfig.moderatorInstruction", () => {
    const instruction = "## 研究意图\n平静好奇地探索。";
    const md = buildInterviewRoomMetadataFromDraft({
      surveyId: "surv-1",
      sessionId: "sess-1",
      draft: draftFixture({
        instruction,
      }),
    });
    expect(md.flowConfig!.moderatorInstruction).toBe(instruction);
  });

  it("W5b emits only flowConfig plus question-only runtimeStudy and rejects blank instruction", () => {
    const instruction = "## 研究意图\n直接使用这份研究说明。";
    const metadata = buildInterviewRoomMetadataFromDraft({
      surveyId: "surv-w5b",
      sessionId: "sess-w5b",
      draft: draftFixture({ instruction }),
    });

    expect(metadata).not.toHaveProperty("workflowConfig");
    expect(metadata.flowConfig?.moderatorInstruction).toBe(instruction);
    expect(metadata.runtimeStudy).toMatchObject({
      surveyId: "surv-w5b",
      sections: expect.any(Array),
    });
    expect(metadata.runtimeStudy).not.toHaveProperty("researchGoal");
    expect(metadata.runtimeStudy).not.toHaveProperty("targetAudience");
    expect(metadata.runtimeStudy).not.toHaveProperty("introScript");

    expect(() =>
      buildInterviewRoomMetadataFromDraft({
        surveyId: "surv-blank",
        sessionId: "sess-blank",
        draft: draftFixture({ instruction: "   " }),
      }),
    ).toThrow();
  });
});

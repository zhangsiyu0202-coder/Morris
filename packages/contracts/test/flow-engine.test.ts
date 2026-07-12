/**
 * Property + unit tests for `InterviewFlowConfigSchema` and step schemas.
 *
 * These pin the invariants the engine relies on:
 *  - startStepId resolves to a real step
 *  - every edge endpoint (from.stepId, to.stepId) resolves to a real step
 *  - every outgoingEdgeId (on step / option / condition item) resolves to a real edge
 *  - stepIds are unique
 *  - the FlowStep discriminated union dispatches by `kind`
 *
 * Borrowed shape from typebot's contract tests
 * (packages/typebot/test/*) but written against fast-check for property coverage.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ConditionStepSchema,
  FlowEdgeSchema,
  FlowStepSchema,
  InterviewFlowConfigSchema,
  ProbeStepSchema,
  QuestionStepSchema,
  type FlowStep,
  type FlowEdge,
} from "../src/flow-engine.js";

// --- Minimal valid building blocks ---------------------------------------------

function q(id: string, options: string[] = [], overrides: Partial<Record<string, unknown>> = {}): FlowStep {
  return {
    stepId: id,
    kind: "question",
    questionType: "open_ended",
    content: `question ${id}`,
    options: options.map((opt) => ({ optionId: opt, content: opt })),
    ...overrides,
  } as FlowStep;
}

function probe(id: string, forQuestionStepId: string): FlowStep {
  return {
    stepId: id,
    kind: "probe",
    forQuestionStepId,
    instruction: "",
    level: "standard",
    maxRounds: 3,
  } as FlowStep;
}

function cond(id: string, items: Array<{ itemId: string; sourceStepId: string; condition: string; outgoingEdgeId?: string }>): FlowStep {
  return {
    stepId: id,
    kind: "condition",
    items: items.map((it) => ({
      itemId: it.itemId,
      predicate: { sourceStepId: it.sourceStepId, condition: it.condition },
      outgoingEdgeId: it.outgoingEdgeId,
    })),
  } as FlowStep;
}

function edge(id: string, fromStep: string, toStep: string, fromOption?: string): FlowEdge {
  return {
    id,
    from: { stepId: fromStep, optionId: fromOption },
    to: { stepId: toStep },
  };
}

// --- Discriminated union dispatch ----------------------------------------------

describe("FlowStepSchema discriminated union", () => {
  it("parses a QuestionStep", () => {
    const parsed = FlowStepSchema.parse(q("s1", ["a", "b"]));
    expect(parsed.kind).toBe("question");
  });

  it("parses a ProbeStep", () => {
    const parsed = FlowStepSchema.parse(probe("s2", "s1"));
    expect(parsed.kind).toBe("probe");
  });

  it("parses a ConditionStep", () => {
    const parsed = FlowStepSchema.parse(
      cond("s3", [{ itemId: "i1", sourceStepId: "s1", condition: "yes" }]),
    );
    expect(parsed.kind).toBe("condition");
  });

  it("rejects an unknown kind", () => {
    const result = FlowStepSchema.safeParse({
      stepId: "s1",
      kind: "unknown-kind",
    });
    expect(result.success).toBe(false);
  });
});

// --- Individual step schemas ---------------------------------------------------

describe("QuestionStepSchema", () => {
  it("defaults options to []", () => {
    const parsed = QuestionStepSchema.parse({
      stepId: "s1",
      kind: "question",
      questionType: "open_ended",
      content: "hello",
    });
    expect(parsed.options).toEqual([]);
  });

  it("rejects empty content", () => {
    const result = QuestionStepSchema.safeParse({
      stepId: "s1",
      kind: "question",
      questionType: "open_ended",
      content: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects option with empty optionId", () => {
    const result = QuestionStepSchema.safeParse({
      stepId: "s1",
      kind: "question",
      questionType: "single_choice",
      content: "pick",
      options: [{ optionId: "", content: "a" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("ProbeStepSchema", () => {
  it("defaults maxRounds and level", () => {
    const parsed = ProbeStepSchema.parse({
      stepId: "s1",
      kind: "probe",
      forQuestionStepId: "s0",
    });
    expect(parsed.maxRounds).toBe(3);
    expect(parsed.level).toBe("standard");
  });

  it("rejects maxRounds <= 0", () => {
    const result = ProbeStepSchema.safeParse({
      stepId: "s1",
      kind: "probe",
      forQuestionStepId: "s0",
      maxRounds: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("ConditionStepSchema", () => {
  it("requires at least one item", () => {
    const result = ConditionStepSchema.safeParse({
      stepId: "s1",
      kind: "condition",
      items: [],
    });
    expect(result.success).toBe(false);
  });
});

// --- FlowEdge --------------------------------------------------------------------

describe("FlowEdgeSchema", () => {
  it("parses a bare block-level edge", () => {
    expect(FlowEdgeSchema.parse(edge("e1", "s1", "s2")).from.optionId).toBeUndefined();
  });

  it("parses a per-option edge", () => {
    const parsed = FlowEdgeSchema.parse(edge("e1", "s1", "s2", "opt-a"));
    expect(parsed.from.optionId).toBe("opt-a");
  });

  it("rejects empty ids", () => {
    expect(FlowEdgeSchema.safeParse({ id: "", from: { stepId: "s1" }, to: { stepId: "s2" } }).success).toBe(false);
  });
});

// --- InterviewFlowConfig invariants (superRefine) ------------------------------

describe("InterviewFlowConfigSchema invariants", () => {
  const baseConfig = {
    surveyId: "surv-1",
    sessionId: "sess-1",
    moderatorInstruction: "be nice",
  };

  it("accepts a minimal linear flow (Q1 → Q2)", () => {
    const parsed = InterviewFlowConfigSchema.parse({
      ...baseConfig,
      startStepId: "s1",
      steps: [q("s1", [], { outgoingEdgeId: "e1" }), q("s2")],
      edges: [edge("e1", "s1", "s2")],
    });
    expect(parsed.steps).toHaveLength(2);
  });

  it("rejects startStepId not in steps", () => {
    const result = InterviewFlowConfigSchema.safeParse({
      ...baseConfig,
      startStepId: "does-not-exist",
      steps: [q("s1")],
      edges: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("startStepId");
    }
  });

  it("rejects an edge endpoint pointing at a missing step", () => {
    const result = InterviewFlowConfigSchema.safeParse({
      ...baseConfig,
      startStepId: "s1",
      steps: [q("s1", [], { outgoingEdgeId: "e1" })],
      edges: [edge("e1", "s1", "MISSING")],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("edge.to.stepId"))).toBe(true);
    }
  });

  it("rejects a dangling outgoingEdgeId on a step", () => {
    const result = InterviewFlowConfigSchema.safeParse({
      ...baseConfig,
      startStepId: "s1",
      steps: [q("s1", [], { outgoingEdgeId: "DANGLING" }), q("s2")],
      edges: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a dangling outgoingEdgeId on a question option", () => {
    const result = InterviewFlowConfigSchema.safeParse({
      ...baseConfig,
      startStepId: "s1",
      steps: [
        {
          stepId: "s1",
          kind: "question",
          questionType: "single_choice",
          content: "pick",
          options: [{ optionId: "opt-a", content: "A", outgoingEdgeId: "DANGLING" }],
        },
        q("s2"),
      ],
      edges: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a dangling outgoingEdgeId on a condition item", () => {
    const result = InterviewFlowConfigSchema.safeParse({
      ...baseConfig,
      startStepId: "s1",
      steps: [
        q("s1"),
        cond("s2", [{ itemId: "i1", sourceStepId: "s1", condition: "yes", outgoingEdgeId: "DANGLING" }]),
      ],
      edges: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate stepIds", () => {
    const result = InterviewFlowConfigSchema.safeParse({
      ...baseConfig,
      startStepId: "s1",
      steps: [q("s1"), q("s1")],
      edges: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("duplicate"))).toBe(true);
    }
  });

  // --- Property: any well-formed linear flow of N steps parses cleanly ---------

  it("property: any linear flow of arbitrary length parses", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (n) => {
        const steps = Array.from({ length: n }, (_, i) => {
          const id = `s${i}`;
          const outgoing = i < n - 1 ? `e${i}` : undefined;
          return q(id, [], outgoing ? { outgoingEdgeId: outgoing } : {});
        });
        const edges = Array.from({ length: n - 1 }, (_, i) => edge(`e${i}`, `s${i}`, `s${i + 1}`));
        const result = InterviewFlowConfigSchema.safeParse({
          ...baseConfig,
          startStepId: "s0",
          steps,
          edges,
        });
        expect(result.success).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it("property: reversing edges (target ↔ source swap) is still schema-valid as long as endpoints exist", () => {
    // The schema doesn't enforce reachability — a "reachable set" check is
    // engine-level concern. This pins that we don't accidentally over-refine.
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 10 }), (n) => {
        const steps = Array.from({ length: n }, (_, i) => q(`s${i}`));
        const edges = Array.from({ length: n - 1 }, (_, i) => edge(`e${i}`, `s${i + 1}`, `s${i}`));
        const result = InterviewFlowConfigSchema.safeParse({
          ...baseConfig,
          startStepId: "s0",
          steps,
          edges,
        });
        // Schema passes; the engine will silently terminate at s0 because no edge leaves it.
        // That's the engine's problem to signal, not the schema's.
        expect(result.success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});

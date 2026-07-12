/**
 * Engine main-loop invariants. Ports the essential tests from Python
 * `apps/agent/tests/test_flow_engine.py` to TS. Locks HANDOFF.md § 关键设计
 * decisions 1 (InterviewFlowConfig new schema) + 4 (probe decision code-driven)
 * + 5 (probe content LLM-driven) at the runtime layer.
 *
 * Property test ids (locked in `.kiro/steering/testing.md` P-FLOW-* series):
 *   P-FLOW-11: linear walk visits each step at most once
 *   P-FLOW-12: ConditionStep first-YES-wins; all-NO falls to default edge
 *   P-FLOW-13: condition source missing → item skipped + warn emitted +
 *              evaluateCondition NEVER called for that item
 *   P-FLOW-15: MAX_REVISITS safety guard breaks the loop
 */

import { describe, expect, it } from "vitest";
import type { InterviewFlowConfig } from "@merism/contracts";

import {
  initialFlowState,
  MAX_REVISITS,
  runFlow,
} from "../../../apps/agent-voice-worker/src/interview/flow-engine/index";
import { ScriptedFlowHost } from "./_scripted-host";

// ---------------------------------------------------------------------------
// Config helpers — succinct fluent builders keep the tests readable
// ---------------------------------------------------------------------------

function q(stepId: string, content: string, outgoingEdgeId: string | null): {
  stepId: string;
  kind: "question";
  outgoingEdgeId: string | null;
  questionType: "open_text";
  content: string;
  options: [];
} {
  return {
    stepId,
    kind: "question",
    outgoingEdgeId,
    questionType: "open_text",
    content,
    options: [],
  };
}

function probe(stepId: string, forQuestionStepId: string, outgoingEdgeId: string | null): {
  stepId: string;
  kind: "probe";
  outgoingEdgeId: string | null;
  forQuestionStepId: string;
  instruction: string;
  level: "standard";
  maxRounds: number;
} {
  return {
    stepId,
    kind: "probe",
    outgoingEdgeId,
    forQuestionStepId,
    instruction: "dig deeper",
    level: "standard",
    maxRounds: 2,
  };
}

function cond(
  stepId: string,
  items: Array<{ itemId: string; sourceStepId: string; condition: string; outgoingEdgeId: string | null }>,
  defaultEdgeId: string | null,
): {
  stepId: string;
  kind: "condition";
  outgoingEdgeId: string | null;
  items: Array<{
    itemId: string;
    predicate: { sourceStepId: string; condition: string };
    outgoingEdgeId: string | null;
  }>;
} {
  return {
    stepId,
    kind: "condition",
    outgoingEdgeId: defaultEdgeId,
    items: items.map((it) => ({
      itemId: it.itemId,
      predicate: { sourceStepId: it.sourceStepId, condition: it.condition },
      outgoingEdgeId: it.outgoingEdgeId,
    })),
  };
}

function makeConfig(steps: unknown[], edges: Array<{ id: string; from: string; to: string }>, startStepId: string): InterviewFlowConfig {
  return {
    surveyId: "surv-1",
    sessionId: "sess-1",
    moderatorInstruction: "be nice",
    startStepId,
    steps: steps as InterviewFlowConfig["steps"],
    edges: edges.map((e) => ({ id: e.id, from: { stepId: e.from }, to: { stepId: e.to } })),
  };
}

// ---------------------------------------------------------------------------
// P-FLOW-11: linear walk
// ---------------------------------------------------------------------------

describe("P-FLOW-11 — linear walk", () => {
  it("visits each step at most once for a linear q1 → q2 → q3 flow", async () => {
    const cfg = makeConfig(
      [q("s1", "Q1", "e_s1_s2"), q("s2", "Q2", "e_s2_s3"), q("s3", "Q3", null)],
      [
        { id: "e_s1_s2", from: "s1", to: "s2" },
        { id: "e_s2_s3", from: "s2", to: "s3" },
      ],
      "s1",
    );
    const host = new ScriptedFlowHost({
      questionAnswers: {
        s1: { respondentAnswer: "a1", selectedOptionIds: [] },
        s2: { respondentAnswer: "a2", selectedOptionIds: [] },
        s3: { respondentAnswer: "a3", selectedOptionIds: [] },
      },
    });
    const state = initialFlowState(cfg);
    await runFlow(state, host);

    expect(state.visitedStepIds).toEqual(["s1", "s2", "s3"]);
    // At most once each — no revisit.
    expect(new Set(state.visitedStepIds).size).toBe(state.visitedStepIds.length);
    expect(host.flowCompleted.called).toBe(true);
  });

  it("terminates cleanly when the last step has no outgoing edge", async () => {
    const cfg = makeConfig([q("s1", "Q1", null)], [], "s1");
    const host = new ScriptedFlowHost({
      questionAnswers: { s1: { respondentAnswer: "final", selectedOptionIds: [] } },
    });
    const state = initialFlowState(cfg);
    await runFlow(state, host);

    expect(state.currentStepId).toBeNull();
    expect(state.answers.get("s1")?.respondentAnswer).toBe("final");
  });
});

// ---------------------------------------------------------------------------
// P-FLOW-12: condition first-YES-wins
// ---------------------------------------------------------------------------

describe("P-FLOW-12 — ConditionStep dispatch", () => {
  it("takes the first item's edge whose evaluateCondition returns YES", async () => {
    const cfg = makeConfig(
      [
        q("s1", "Q1", "e_s1_c1"),
        cond(
          "c1",
          [
            { itemId: "i1", sourceStepId: "s1", condition: "student", outgoingEdgeId: "e_c1_sa" },
            { itemId: "i2", sourceStepId: "s1", condition: "worker", outgoingEdgeId: "e_c1_sb" },
          ],
          "e_c1_default",
        ),
        q("sa", "Q-student", null),
        q("sb", "Q-worker", null),
        q("sd", "Q-default", null),
      ],
      [
        { id: "e_s1_c1", from: "s1", to: "c1" },
        { id: "e_c1_sa", from: "c1", to: "sa" },
        { id: "e_c1_sb", from: "c1", to: "sb" },
        { id: "e_c1_default", from: "c1", to: "sd" },
      ],
      "s1",
    );
    const host = new ScriptedFlowHost({
      questionAnswers: {
        s1: { respondentAnswer: "I'm a student", selectedOptionIds: [] },
        sa: { respondentAnswer: "a-answer", selectedOptionIds: [] },
        sb: { respondentAnswer: "b-answer", selectedOptionIds: [] },
        sd: { respondentAnswer: "d-answer", selectedOptionIds: [] },
      },
      conditionScripts: { student: true, worker: true }, // both scripted YES; first wins
    });
    const state = initialFlowState(cfg);
    await runFlow(state, host);

    expect(state.visitedStepIds).toEqual(["s1", "c1", "sa"]);
    // Second item MUST NOT have been evaluated (short-circuit on first YES).
    expect(host.conditionCalls).toHaveLength(1);
    expect(host.conditionCalls[0].condition).toBe("student");
  });

  it("falls through to the ConditionStep's default edge when all items are NO", async () => {
    const cfg = makeConfig(
      [
        q("s1", "Q1", "e_s1_c1"),
        cond(
          "c1",
          [{ itemId: "i1", sourceStepId: "s1", condition: "match_me", outgoingEdgeId: "e_c1_sa" }],
          "e_c1_default",
        ),
        q("sa", "SA", null),
        q("sd", "SD-default", null),
      ],
      [
        { id: "e_s1_c1", from: "s1", to: "c1" },
        { id: "e_c1_sa", from: "c1", to: "sa" },
        { id: "e_c1_default", from: "c1", to: "sd" },
      ],
      "s1",
    );
    const host = new ScriptedFlowHost({
      questionAnswers: {
        s1: { respondentAnswer: "unrelated answer", selectedOptionIds: [] },
        sd: { respondentAnswer: "default reached", selectedOptionIds: [] },
      },
      // No script for "match_me" → default false → item skipped → default edge
    });
    const state = initialFlowState(cfg);
    await runFlow(state, host);

    expect(state.visitedStepIds).toEqual(["s1", "c1", "sd"]);
    expect(host.conditionCalls[0]?.matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P-FLOW-13: condition source missing gate
// ---------------------------------------------------------------------------

describe("P-FLOW-13 — condition source missing must-not-call", () => {
  it("skips a condition item whose sourceStepId has not been answered yet, emits warn, follows default edge", async () => {
    // Start directly at c1 without ever running s0 — source missing.
    const cfg = makeConfig(
      [
        cond(
          "c1",
          [{ itemId: "i1", sourceStepId: "s0_unrecorded", condition: "any", outgoingEdgeId: "e_bad" }],
          "e_default",
        ),
        q("sd", "SD", null),
        q("bad", "should not reach", null),
      ],
      [
        { id: "e_bad", from: "c1", to: "bad" },
        { id: "e_default", from: "c1", to: "sd" },
      ],
      "c1",
    );
    const host = new ScriptedFlowHost({
      questionAnswers: { sd: { respondentAnswer: "safe default reached", selectedOptionIds: [] } },
      conditionScripts: { any: true }, // would jump to `bad` if called
    });
    const warns: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    const state = initialFlowState(cfg);
    await runFlow(state, host, {
      info: () => {},
      warn: (event, fields) => warns.push({ event, fields }),
    });

    // evaluateCondition MUST NOT have been called (source_missing gate).
    expect(host.conditionCalls).toHaveLength(0);
    // Flow followed default edge to sd, NOT to `bad`.
    expect(state.visitedStepIds).toContain("sd");
    expect(state.visitedStepIds).not.toContain("bad");
    // Exactly one source_missing warn with the expected fields.
    const sourceMissing = warns.filter((w) => w.event === "flow.condition.source_missing");
    expect(sourceMissing).toHaveLength(1);
    expect(sourceMissing[0].fields).toMatchObject({
      stepId: "c1",
      itemId: "i1",
      sourceStepId: "s0_unrecorded",
    });
  });
});

// ---------------------------------------------------------------------------
// P-FLOW-15: infinite-loop safety guard
// ---------------------------------------------------------------------------

describe("P-FLOW-15 — MAX_REVISITS safety guard", () => {
  it("breaks the loop after visiting the same stepId more than MAX_REVISITS times", async () => {
    // s1 loops back to itself via a condition that always says YES on `loop`.
    const cfg = makeConfig(
      [
        q("s1", "Q1", "e_s1_c1"),
        cond(
          "c1",
          [{ itemId: "i1", sourceStepId: "s1", condition: "loop", outgoingEdgeId: "e_c1_s1" }],
          null,
        ),
      ],
      [
        { id: "e_s1_c1", from: "s1", to: "c1" },
        { id: "e_c1_s1", from: "c1", to: "s1" },
      ],
      "s1",
    );
    const host = new ScriptedFlowHost({
      questionAnswers: { s1: { respondentAnswer: "still going", selectedOptionIds: [] } },
      conditionScripts: { loop: true },
    });
    const warns: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    const state = initialFlowState(cfg);
    await runFlow(state, host, {
      info: () => {},
      warn: (event, fields) => warns.push({ event, fields }),
    });

    // We should have tripped the guard, NOT looped forever.
    const guardTrips = warns.filter((w) => w.event === "flow.loop.guard.tripped");
    expect(guardTrips).toHaveLength(1);
    // s1 was visited at most MAX_REVISITS + 1 times (the +1 is the visit
    // during which the guard trips).
    const s1Visits = state.visitedStepIds.filter((id) => id === "s1").length;
    expect(s1Visits).toBeLessThanOrEqual(MAX_REVISITS + 1);
  });
});

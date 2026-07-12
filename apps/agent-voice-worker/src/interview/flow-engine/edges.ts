/**
 * Edge resolution — pure lookups over the flow graph.
 *
 * Port of `apps/agent/agent/flow_engine/edges.py` per ADR-0013 + the
 * flow-engine-ts-reimpl sub-spec.
 *
 * Each function is a single-purpose lookup. Together they answer "given the
 * current step and its just-produced result, what's the next stepId?" — the
 * whole answer to "how does the interview advance?".
 *
 * Corresponds line-for-line with typebot's `walkFlowForward.ts` edge helpers
 * (see the Python source for the exact citations).
 */

import type {
  ConditionStep,
  FlowEdge,
  FlowStep,
  InterviewFlowConfig,
  ProbeStep,
  QuestionStep,
} from "@merism/contracts";

import type { QuestionRunResult } from "./types.js";

/** Look up an edge by id. O(n) scan; edge lists are small. */
export function findEdge(
  edges: readonly FlowEdge[],
  edgeId: string | null | undefined,
): FlowEdge | null {
  if (edgeId == null) return null;
  return edges.find((e) => e.id === edgeId) ?? null;
}

/** Look up a step by stepId. O(n) scan; the whole flow is small (dozens of
 *  steps per interview at most). */
export function locateStep(
  config: InterviewFlowConfig,
  stepId: string | null | undefined,
): FlowStep | null {
  if (stepId == null) return null;
  return config.steps.find((s) => s.stepId === stepId) ?? null;
}

/**
 * Resolve the outgoing edge id for a QuestionStep given its answer.
 *
 * Precedence (matches typebot's `getReplyOutgoingEdge.ts` for CHOICE):
 *   1. If a selected option carries its own `outgoingEdgeId`, use that.
 *   2. Else fall back to the step's default `outgoingEdgeId`.
 *   3. Else the flow ends here (`null`).
 *
 * Multi-select branching is a config anti-pattern (there is no single "the
 * answer said X" for multi-select); we take the first selected option that
 * has an edge, mirroring what a single-select UI does.
 */
export function resolveAnswerEdge(
  step: QuestionStep,
  result: QuestionRunResult,
): string | null {
  if (result.selectedOptionIds.length > 0) {
    for (const option of step.options) {
      if (
        result.selectedOptionIds.includes(option.optionId) &&
        option.outgoingEdgeId
      ) {
        return option.outgoingEdgeId;
      }
    }
  }
  return step.outgoingEdgeId ?? null;
}

/** Return the step's static default outgoing edge id. Used for ProbeStep
 *  and terminal QuestionSteps with no option-scoped edges. */
export function resolveDefaultEdge(step: FlowStep): string | null {
  return step.outgoingEdgeId ?? null;
}

/**
 * Given an edge id, return the destination stepId, or `null` if no such
 * edge exists. Terminates the loop when there is no outgoing edge from the
 * current step.
 */
export function followEdge(
  config: InterviewFlowConfig,
  edgeId: string | null | undefined,
): string | null {
  const edge = findEdge(config.edges, edgeId);
  if (edge === null) return null;
  return edge.to.stepId;
}

/**
 * True if the cursor at `stepId` has no reachable next step.
 *
 * Used as a post-execution check to avoid one wasted iteration when a leaf
 * step is reached. NOT used to short-circuit the main loop (the loop
 * terminates on `followEdge` returning `null`).
 */
export function isTerminal(
  config: InterviewFlowConfig,
  stepId: string,
): boolean {
  const step = locateStep(config, stepId);
  if (step === null) return true;
  if (step.outgoingEdgeId == null) {
    if (step.kind === "question") {
      const q = step as QuestionStep;
      return !q.options.some((opt) => opt.outgoingEdgeId != null);
    }
    if (step.kind === "condition") {
      const c = step as ConditionStep;
      return !c.items.some((item) => item.outgoingEdgeId != null);
    }
    if (step.kind === "probe") {
      // ProbeStep has no per-item edges; if outgoingEdgeId is unset it's
      // terminal.
      const _p: ProbeStep = step;
      void _p;
      return true;
    }
  }
  return false;
}

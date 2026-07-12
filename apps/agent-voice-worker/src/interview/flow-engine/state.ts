/**
 * Runtime state carried through the engine loop.
 *
 * Port of `apps/agent/agent/flow_engine/state.py` per ADR-0013 + the
 * flow-engine-ts-reimpl sub-spec.
 *
 * Pure state, no IO. The engine reads/writes these fields as it walks the
 * flow graph; the host layer never touches them directly (it goes through
 * the engine's `record*` helpers via the FlowEngineHost seam).
 */

import type { InterviewFlowConfig } from "@merism/contracts";

import type { AnswerRecord, ProbeRecord, QuestionRunResult } from "./types.js";

/**
 * Loop safety cap: a step visited more than this many times triggers a
 * `flow.loop.guard.tripped` warn and the engine terminates the flow. A
 * well-formed config never revisits a step at all — the guard exists so a
 * researcher misconfiguring edges into a cycle can't loop the interview
 * forever. Matches the Python default.
 */
export const MAX_REVISITS = 3;

export interface FlowState {
  readonly config: InterviewFlowConfig;
  readonly sessionId: string;
  readonly surveyId: string;
  currentStepId: string | null;
  readonly visitedStepIds: string[];
  /** Recorded QuestionStep answers, keyed by stepId. */
  readonly answers: Map<string, AnswerRecord>;
  /** Recorded ProbeStep results, keyed by ProbeStep.stepId. */
  readonly probes: Map<string, ProbeRecord>;
}

/**
 * Fresh state at the start of a session. Cursor points at
 * `config.startStepId`; both answer maps are empty.
 */
export function initialFlowState(config: InterviewFlowConfig): FlowState {
  return {
    config,
    sessionId: config.sessionId,
    surveyId: config.surveyId,
    currentStepId: config.startStepId,
    visitedStepIds: [],
    answers: new Map(),
    probes: new Map(),
  };
}

/**
 * Record a QuestionStep answer. Called by the engine after the host's
 * `askQuestion` returns.
 */
export function recordStepAnswer(
  state: FlowState,
  args: {
    stepId: string;
    questionContent: string;
    result: QuestionRunResult;
  },
): void {
  state.answers.set(args.stepId, {
    questionContent: args.questionContent,
    respondentAnswer: args.result.respondentAnswer,
    selectedOptionIds: [...args.result.selectedOptionIds],
  });
}

/**
 * Read a QuestionStep answer, or `null` if the referenced step has not been
 * recorded yet. ConditionStep dispatch uses this to gate branch evaluation
 * on the presence of the source answer.
 */
export function stepAnswer(state: FlowState, stepId: string): AnswerRecord | null {
  return state.answers.get(stepId) ?? null;
}

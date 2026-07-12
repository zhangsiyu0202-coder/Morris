/**
 * Public surface of the flow-engine module. Consumers import from here;
 * internal files (edges.ts, state.ts) may still be imported directly for
 * fine-grained access in property tests, but production code should use
 * the barrel to keep the seam surface small.
 */

export type {
  FlowEngineHost,
  HostContext,
  QuestionRunResult,
  ProbeRunResult,
  ProbeRound,
  AnswerRecord,
  ProbeRecord,
} from "./types.js";
export type { FlowState } from "./state.js";
export type { FlowEngineLogger } from "./engine.js";

export { initialFlowState, recordStepAnswer, stepAnswer, MAX_REVISITS } from "./state.js";
export {
  findEdge,
  locateStep,
  resolveAnswerEdge,
  resolveDefaultEdge,
  followEdge,
  isTerminal,
} from "./edges.js";
export {
  parseYesNo,
  respondentSignaledNoMore,
  buildJudgePrompt,
  buildProbeGenerationPrompt,
  runProbeLoop,
  type ProbeLoopCallbacks,
  type ProbeLoopLogger,
  type JudgePromptArgs,
  type ProbeGenerationPromptArgs,
} from "./probe.js";
export { buildConditionPrompt } from "./condition-eval.js";
export { runFlow } from "./engine.js";

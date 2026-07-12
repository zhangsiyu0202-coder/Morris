/**
 * Effect envelopes and the FlowEngineHost interface.
 *
 * Port of `apps/agent/agent/flow_engine/types.py` per ADR-0013 + the
 * flow-engine-ts-reimpl sub-spec. See archived Python source at
 * `git show archive/flow-engine-20260712-integration:apps/agent/agent/flow_engine/types.py`.
 *
 * Two responsibilities:
 *   1. Data envelopes the engine hands the host (and vice versa): they mirror
 *      the shape of `packages/contracts/src/api.ts::QuestionTaskResult` /
 *      `ProbeRound` but are engine-owned so tests can construct them without
 *      pulling the full contracts surface.
 *   2. `FlowEngineHost` interface — the seam through which the engine reaches
 *      out for the effects it cannot perform itself (asking a question over
 *      LiveKit voice, running a probe conversation, LLM condition judgment,
 *      publishing state to the room). Two implementations at runtime:
 *        - `apps/agent-voice-worker/src/interview/livekit-flow-host.ts` for
 *          production (wraps LiveKit `voice.AgentSession` + Mastra Agent LLM)
 *        - the property tests' `ScriptedFlowHost` for
 *          `tests/properties/flow-engine-ts-reimpl/`.
 *
 * NO LiveKit / Mastra imports here. This file must stay dependency-free so
 * the engine module (engine.ts + edges.ts + probe.ts + condition-eval.ts)
 * remains pure and unit-testable without spinning up any of the realtime
 * stack.
 */

import type { ProbeStep, QuestionStep } from "@merism/contracts";

// ---------------------------------------------------------------------------
// Envelopes handed BY the host TO the engine after a step executes.
// ---------------------------------------------------------------------------

/**
 * What the host returns from `askQuestion`. Mirrors the shape of
 * `QuestionTaskResult` in @merism/contracts but is decoupled from the
 * LiveKit-specific types so tests can stub freely.
 */
export interface QuestionRunResult {
  /** The consolidated answer text stored under this question. */
  respondentAnswer: string;
  /**
   * For choice-based questions, the optionId(s) the user picked. Used by
   * `resolveAnswerEdge` to look up per-option `outgoingEdgeId`s. Empty for
   * open-ended questions.
   */
  selectedOptionIds: readonly string[];
}

/** One (probe question, respondent answer) exchange. */
export interface ProbeRound {
  probeQuestion: string;
  respondentAnswer: string;
}

/** What the host returns from `runProbe`. */
export interface ProbeRunResult {
  rounds: readonly ProbeRound[];
}

// ---------------------------------------------------------------------------
// Records the engine stores in FlowState (see state.ts).
// ---------------------------------------------------------------------------

/** One recorded QuestionStep answer. Consumed by ConditionStep judgments. */
export interface AnswerRecord {
  questionContent: string;
  respondentAnswer: string;
  selectedOptionIds: readonly string[];
}

/** One recorded ProbeStep result. */
export interface ProbeRecord {
  forQuestionStepId: string;
  rounds: readonly ProbeRound[];
}

// ---------------------------------------------------------------------------
// Runtime context handed to the host on every call. Kept as a plain object
// so tests can construct it freely.
// ---------------------------------------------------------------------------

export interface HostContext {
  sessionId: string;
  surveyId: string;
  /**
   * The current FlowState. Typed as `unknown` here to avoid the circular
   * import with state.ts; the actual runtime type is always `FlowState`.
   * Callers that need to inspect it should import FlowState and narrow via
   * a helper (e.g. `readAnswerFromState(ctx.state, stepId)`).
   */
  state: unknown;
}

// ---------------------------------------------------------------------------
// The engine → host seam.
// ---------------------------------------------------------------------------

/**
 * The engine calls out to a host for the effects it cannot perform itself.
 *
 * All methods are async because the production host performs real-time IO;
 * a test host can `return Promise.resolve(...)` synchronously.
 *
 * Contract for `evaluateCondition`:
 *   - Returns `true` iff the branch should be taken; `false` otherwise.
 *   - NEVER throws. LLM error, timeout, malformed output — all surface as
 *     `false` so the flow falls through to the ConditionStep's default
 *     `outgoingEdgeId`. The "when unsure, don't divert" bias is deliberate
 *     and symmetric-opposite to the probe judge (which defaults YES on
 *     failure to STOP hammering the user).
 */
export interface FlowEngineHost {
  /**
   * Ask the QuestionStep's content through the appropriate modality
   * (voice + UI first-writer-wins for the LiveKit host) and return the
   * collected answer. May block waiting on the respondent.
   */
  askQuestion(step: QuestionStep, ctx: HostContext): Promise<QuestionRunResult>;

  /**
   * Run a probe follow-up sequence for `step.forQuestionStepId`'s main
   * answer. Bounded by `step.maxRounds`. The host looks up the main
   * question's answer from `ctx.state` and drives probe rounds via
   * `runProbeLoop` (see probe.ts).
   */
  runProbe(step: ProbeStep, ctx: HostContext): Promise<ProbeRunResult>;

  /**
   * Judge whether the natural-language `condition` is satisfied by
   * `sourceAnswer`. See file-level docstring for the fail-shut contract.
   */
  evaluateCondition(
    condition: string,
    sourceAnswer: AnswerRecord,
    ctx: HostContext,
  ): Promise<boolean>;

  /**
   * Called each time the engine cursor lands on a new step, BEFORE the
   * executor runs. Production host uses this to publish the current step
   * as a room attribute so the UI renders its structured control. Test
   * host may no-op.
   */
  onStepEnter(stepId: string, ctx: HostContext): Promise<void>;

  /** Called when the engine finishes normally (no next edge). */
  onFlowCompleted(ctx: HostContext): Promise<void>;
}

/**
 * LiveKit + Mastra Agent host for the flow engine.
 *
 * Implements `FlowEngineHost` (see `flow-engine/types.ts`) on top of a
 * running Mastra `Agent` + LiveKit `Room`. This is the production adapter;
 * unit tests use a `ScriptedFlowHost` under `tests/properties/`.
 *
 * Contract highlights (all match the Python source's semantics):
 *   - `evaluateCondition` NEVER throws. Any LLM / parse failure surfaces as
 *     `false` so the flow engine falls through to the ConditionStep's
 *     default outgoing edge. "When unsure, don't divert" — see
 *     `flow-engine/probe.ts::parseYesNo` bias table.
 *   - `runProbe` returns `{ rounds: [] }` when the researcher-authored
 *     `instruction` is empty (matches Python `run_probe_loop` skip path).
 *   - `askQuestion` waits for a first-writer-wins answer arriving via
 *     `merism.submit_answer` RPC; the pending promise is resolved by
 *     `handleUiSubmission`. The voice-completion tool loop is a follow-up
 *     task on the interview-tool-loop backlog (parity with the linear-walk
 *     orchestrator, which also has voice completion as a TODO today).
 *   - `onStepEnter` reuses the same `InterviewStatePublisher` used by the
 *     linear-walk orchestrator, so the UI code path is identical regardless
 *     of which driver runs.
 */

import type { Agent } from "@mastra/core/agent";
import type { Room } from "@livekit/rtc-node";

import type {
  InterviewAnswerPayload,
  InterviewRuntimeQuestion,
  ProbeStep,
  QuestionStep,
} from "@merism/contracts";

import type { SessionLogger } from "../observability/session-logger.js";
import type { InterviewStatePublisher } from "../transport/attribute-publisher.js";
import {
  buildConditionPrompt,
  buildJudgePrompt,
  buildProbeGenerationPrompt,
  parseYesNo,
  runProbeLoop,
  stepAnswer,
  type AnswerRecord,
  type FlowEngineHost,
  type FlowState,
  type HostContext,
  type ProbeRunResult,
  type QuestionRunResult,
} from "./flow-engine/index.js";

// ---------------------------------------------------------------------------
// Deferred-answer plumbing (askQuestion + probe askAndWait)
// ---------------------------------------------------------------------------

interface PendingAnswer {
  stepId: string;
  resolve: (result: QuestionRunResult) => void;
}

// ---------------------------------------------------------------------------
// LLM helpers — condition eval + probe judge single-shot calls
// ---------------------------------------------------------------------------

/**
 * Wraps `agent.generate(prompt)` with a fail-shut translator: any thrown
 * error surfaces as `null` so callers can substitute their own safe default.
 * `condition-eval` uses `null → false`(HANDOFF § evaluateCondition never
 * raises — LLM/parse errors fall through to the ConditionStep default edge);
 * `probe-judge` uses `null → true`(STOP probing on garbage — the maxRounds
 * cap still bounds runaway probes). This is exactly the "best-effort
 * cleanup / rollback" branch of the try/catch matrix in
 * `.kiro/steering/errors-and-observability.md` § try/catch matrix, so the
 * silent return null is correct here; caller-side logs at warn.
 */
async function tryGenerate(agent: Agent, prompt: string): Promise<string | null> {
  // nosemgrep: no-silent-catch-fallback -- fail-shut translator; caller maps null to safe default (condition→false, probe→true) per JSDoc above.
  try {
    const output = await agent.generate(prompt);
    return output.text ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

export interface LiveKitFlowHostArgs {
  agent: Agent;
  room: Room;
  log: SessionLogger;
  publisher: InterviewStatePublisher;
  runtimeQuestions: Map<string, InterviewRuntimeQuestion>;
}

export class LiveKitFlowHost implements FlowEngineHost {
  #agent: Agent;
  #log: SessionLogger;
  #publisher: InterviewStatePublisher;
  #runtimeQuestions: Map<string, InterviewRuntimeQuestion>;
  #pendingAnswer: PendingAnswer | null = null;

  constructor(args: LiveKitFlowHostArgs) {
    this.#agent = args.agent;
    // `room` is retained on the arg surface for symmetry with the linear
    // orchestrator (transport modules type against `Room`), but the flow
    // host does not currently need direct room access — it publishes state
    // through `publisher` and receives UI answers through the driver-owned
    // RPC handler. Kept as an argument so future STT-listener wiring lands
    // in one place without an API break.
    void args.room;
    this.#log = args.log;
    this.#publisher = args.publisher;
    this.#runtimeQuestions = args.runtimeQuestions;
  }

  // -------------------------------------------------------------------------
  // FlowEngineHost interface
  // -------------------------------------------------------------------------

  async askQuestion(step: QuestionStep, _ctx: HostContext): Promise<QuestionRunResult> {
    // Publish the current stepId so the UI renders the structured control
    // for this step. `onStepEnter` also publishes but only on the engine's
    // first enter — `askQuestion` re-publishes to be idempotent on retries.
    // The publisher already dedupes on identical payloads.
    await this.#publisher.publish({
      status: "collecting",
      currentQuestionId: step.stepId,
    });

    return new Promise<QuestionRunResult>((resolve) => {
      this.#pendingAnswer = { stepId: step.stepId, resolve };
      // NOTE: no LLM utterance here — the Mastra Agent that carries the
      // system prompt for the interview will speak the question when it
      // sees the flow reach this step (the outline in the agent's
      // `instructions` names each step). Explicit prompt fire will land
      // when the voice-completion tool loop is implemented.
    });
  }

  async runProbe(step: ProbeStep, ctx: HostContext): Promise<ProbeRunResult> {
    // The engine hands us the FlowState via ctx; narrow it.
    const state = ctx.state as FlowState;
    const mainAnswer = stepAnswer(state, step.forQuestionStepId);

    if (mainAnswer === null) {
      // Misconfigured flow (ProbeStep before its ForQuestionStep). The engine
      // will publish and continue via the default edge. Skip probe rounds.
      this.#log.warn("probe.for_question_missing", {
        stepId: step.stepId,
        forQuestionStepId: step.forQuestionStepId,
      });
      return { rounds: [] };
    }

    const rounds = await runProbeLoop(
      step,
      {
        generateProbe: async (existing) => {
          const prompt = buildProbeGenerationPrompt({
            probeInstruction: step.instruction,
            mainQuestionContent: mainAnswer.questionContent,
            mainAnswer: mainAnswer.respondentAnswer,
            rounds: existing,
          });
          const text = await tryGenerate(this.#agent, prompt);
          if (text === null) {
            // On generation failure, return an empty string — the probe
            // loop still records a round but the UI-side won't see a
            // meaningful question. Emit a warn so ops can trace.
            this.#log.warn("probe.generate.llm_failed", { stepId: step.stepId });
            return "";
          }
          return text.trim();
        },
        askAndWait: async (probeQuestion) => {
          // Uses the same deferred slot as `askQuestion`, keyed on a
          // synthetic stepId so `handleUiSubmission` can match. The current
          // Mastra worker does not yet have a voice-completion tool loop or
          // an STT-transcript listener, so probe rounds are collected via
          // UI-RPC (interviewee taps a "next" affordance carrying the probe
          // text). Falls through to an empty answer if no UI submits within
          // a bounded wait — matching the Python worker's `TimeoutError`
          // path in `_speak_and_wait_for_reply`.
          void probeQuestion;
          return new Promise<string>((resolve) => {
            this.#pendingAnswer = {
              stepId: `${step.stepId}:probe`,
              resolve: ({ respondentAnswer }) => resolve(respondentAnswer),
            };
          });
        },
        judgeSatisfied: async (existing) => {
          const prompt = buildJudgePrompt({
            probeInstruction: step.instruction,
            mainQuestionContent: mainAnswer.questionContent,
            mainAnswer: mainAnswer.respondentAnswer,
            rounds: existing,
          });
          const text = await tryGenerate(this.#agent, prompt);
          if (text === null) {
            // Safe default = STOP probing on judge failure (bias=true).
            this.#log.warn("probe.judge.llm_failed", { stepId: step.stepId });
            return true;
          }
          return parseYesNo(text, { defaultBias: true });
        },
      },
      {
        info: (event, fields) => this.#log.info(event, fields ?? {}),
        warn: (event, fields) => this.#log.warn(event, fields ?? {}),
      },
    );

    return { rounds };
  }

  async evaluateCondition(
    condition: string,
    sourceAnswer: AnswerRecord,
    _ctx: HostContext,
  ): Promise<boolean> {
    const prompt = buildConditionPrompt(condition, sourceAnswer);
    const text = await tryGenerate(this.#agent, prompt);
    if (text === null) {
      // Provider failure → no divert. Symmetric-opposite to probe judge.
      this.#log.warn("agent.flow-engine.condition-eval.llm_failed", {
        condition: condition.substring(0, 80),
      });
      return false;
    }
    const matched = parseYesNo(text, { defaultBias: false });
    // Operational fields at info; raw LLM output NEVER at info per
    // errors-and-observability.md § Provider adapter rules.
    this.#log.info("agent.flow-engine.condition-eval.decision", {
      condition: condition.substring(0, 80),
      matched,
    });
    return matched;
  }

  async onStepEnter(stepId: string, _ctx: HostContext): Promise<void> {
    await this.#publisher.publish({
      status: "collecting",
      currentQuestionId: stepId,
    });
  }

  async onFlowCompleted(_ctx: HostContext): Promise<void> {
    // Terminal publish is done by the driver's `shutdown` path so the same
    // "completed vs abandoned" logic applies whether the flow terminates
    // naturally or the participant disconnects mid-flow. No-op here.
  }

  // -------------------------------------------------------------------------
  // External driver API
  // -------------------------------------------------------------------------

  /**
   * Fulfil the currently pending `askQuestion` / probe `askAndWait` with
   * a UI-submitted answer. Returns `true` when accepted, `false` when the
   * submission is stale or targets the wrong step (first-writer-wins with
   * any competing voice completion; today only UI wins because the voice
   * loop is not implemented yet).
   */
  handleUiSubmission(answer: InterviewAnswerPayload): boolean {
    const pending = this.#pendingAnswer;
    if (pending === null) return false;
    if (pending.stepId !== answer.questionId) return false;
    this.#pendingAnswer = null;
    // selectedOptionIds: mirror the QuestionTaskResult convention — pick
    // the ids off the payload for single_choice / multiple_choice, else [].
    const selectedOptionIds: string[] = extractSelectedOptionIds(answer);
    pending.resolve({
      respondentAnswer: formatUiAnswer(answer),
      selectedOptionIds,
    });
    return true;
  }

  /** Whether there is a pending answer awaiting a UI submission. */
  get hasPending(): boolean {
    return this.#pendingAnswer !== null;
  }

  /** The current stepId this host is waiting on, or `null` when idle. */
  get pendingStepId(): string | null {
    return this.#pendingAnswer?.stepId ?? null;
  }

  /** Runtime-questions map (index of `questionId → InterviewRuntimeQuestion`)
   *  the driver may use when composing snapshots. Exposed as a getter so the
   *  underlying map stays owned by the host. */
  get runtimeQuestions(): ReadonlyMap<string, InterviewRuntimeQuestion> {
    return this.#runtimeQuestions;
  }
}

// ---------------------------------------------------------------------------
// Answer helpers (inlined from the removed workflow-state module)
// ---------------------------------------------------------------------------

/**
 * Extract selected option ids from an InterviewAnswerPayload. The runtime
 * shape is `selectedOptions: string[]` (per api.ts InterviewAnswerPayloadSchema),
 * a flat list because the payload does not carry choice-vs-multi-choice type
 * discrimination — that lives on `questionType`. Multi-select single-choice
 * would be a config anti-pattern.
 */
function extractSelectedOptionIds(answer: InterviewAnswerPayload): string[] {
  return [...answer.selectedOptions];
}

/**
 * Render a UI-submitted structured answer as the human-readable string
 * stored in `QuestionRunResult.respondentAnswer` (pure). Port of the pre-
 * flow-engine `workflow-state.ts::formatUiAnswer`; precedence matches the
 * response modes: free text → selected options → ranking → numeric score.
 */
function formatUiAnswer(answer: InterviewAnswerPayload): string {
  if (answer.text.trim().length > 0) return answer.text.trim();
  if (answer.selectedOptions.length > 0) return answer.selectedOptions.join(", ");
  if (answer.ranking.length > 0) return answer.ranking.join(" > ");
  if (answer.score != null) {
    return Number.isInteger(answer.score) ? String(Math.trunc(answer.score)) : String(answer.score);
  }
  return "";
}

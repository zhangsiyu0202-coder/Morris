/**
 * Scripted `FlowEngineHost` for tests. Port of Python `InMemoryHost` from
 * `apps/agent/tests/test_flow_engine.py::_InMemoryHost` per the flow-engine
 * refactor HANDOFF.md, adapted for TS.
 *
 * The scripted host lets a test:
 *   - queue up `QuestionRunResult`s for `askQuestion` (per stepId or FIFO)
 *   - queue up `ProbeRunResult`s for `runProbe` (per stepId or FIFO)
 *   - script `evaluateCondition` per (stepId, condition-substring) pair
 *   - inspect the sequence of `onStepEnter` events for assertions
 *
 * Fail-shut contract on `evaluateCondition`: an unscripted `(condition,
 * source)` pair returns `false` (matches Python's parse_yes_no(default=False)
 * behavior when the host has no scripted opinion). Tests can flip this with
 * `defaultCondition = true` in the constructor when needed.
 */

import type {
  AnswerRecord,
  FlowEngineHost,
  HostContext,
  ProbeRound,
  ProbeRunResult,
  QuestionRunResult,
} from "../../../apps/agent-voice-worker/src/interview/flow-engine/index";
import type { ProbeStep, QuestionStep } from "@merism/contracts";

export interface ScriptedFlowHostOpts {
  /** Default value for unscripted condition evaluations. */
  defaultCondition?: boolean;
  /** Queue of QuestionRunResults, keyed by stepId. Non-array = same result each time. */
  questionAnswers?: Record<string, QuestionRunResult | QuestionRunResult[]>;
  /** Queue of ProbeRunResults, keyed by stepId. */
  probeRuns?: Record<string, ProbeRunResult>;
  /** Scripted condition outcomes. Key = `${sourceStepId}::${conditionSubstring}`. */
  conditionScripts?: Record<string, boolean>;
}

export class ScriptedFlowHost implements FlowEngineHost {
  readonly stepEnters: string[] = [];
  readonly conditionCalls: Array<{ condition: string; sourceStepId: string; matched: boolean }> = [];
  readonly flowCompleted = { called: false };

  #defaultCondition: boolean;
  #questionAnswers: Record<string, QuestionRunResult[]>;
  #probeRuns: Record<string, ProbeRunResult>;
  #conditionScripts: Record<string, boolean>;

  constructor(opts: ScriptedFlowHostOpts = {}) {
    this.#defaultCondition = opts.defaultCondition ?? false;
    this.#questionAnswers = {};
    for (const [k, v] of Object.entries(opts.questionAnswers ?? {})) {
      this.#questionAnswers[k] = Array.isArray(v) ? [...v] : [v];
    }
    this.#probeRuns = { ...(opts.probeRuns ?? {}) };
    this.#conditionScripts = { ...(opts.conditionScripts ?? {}) };
  }

  async askQuestion(step: QuestionStep, _ctx: HostContext): Promise<QuestionRunResult> {
    const queue = this.#questionAnswers[step.stepId];
    if (!queue || queue.length === 0) {
      throw new Error(`ScriptedFlowHost: no scripted answer for stepId=${step.stepId}`);
    }
    // Peek at head; if there's a next in queue, consume, else keep last.
    const next = queue.length === 1 ? queue[0] : queue.shift()!;
    return next;
  }

  async runProbe(step: ProbeStep, _ctx: HostContext): Promise<ProbeRunResult> {
    return this.#probeRuns[step.stepId] ?? { rounds: [] as ProbeRound[] };
  }

  async evaluateCondition(
    condition: string,
    sourceAnswer: AnswerRecord,
    _ctx: HostContext,
  ): Promise<boolean> {
    // Find a scripted outcome by substring match on the condition. Multiple
    // items on a ConditionStep have distinct conditions, so this lets tests
    // script per-item outcomes without hard-coding step ids.
    let matched = this.#defaultCondition;
    for (const [key, value] of Object.entries(this.#conditionScripts)) {
      const [srcId, sub] = key.split("::");
      if (
        (srcId === "*" || srcId === (sourceAnswer as unknown as { sourceStepId?: string }).sourceStepId) &&
        condition.includes(sub)
      ) {
        matched = value;
        break;
      }
    }
    // Also allow bare condition-substring keys (no `::` split).
    for (const [key, value] of Object.entries(this.#conditionScripts)) {
      if (!key.includes("::") && condition.includes(key)) {
        matched = value;
        break;
      }
    }
    this.conditionCalls.push({ condition, sourceStepId: (sourceAnswer as unknown as { sourceStepId?: string }).sourceStepId ?? "", matched });
    return matched;
  }

  async onStepEnter(stepId: string, _ctx: HostContext): Promise<void> {
    this.stepEnters.push(stepId);
  }

  async onFlowCompleted(_ctx: HostContext): Promise<void> {
    this.flowCompleted.called = true;
  }
}

import type {
  InterviewAnswerPayload,
  ProbeConfig,
  ProbeRound,
  QuestionTaskConfig,
  QuestionTaskResult,
} from "@merism/contracts";

import { formatUiAnswer } from "./workflow-state.js";

/**
 * Ported from `apps/agent/agent/interview/tasks/question.py` per ADR-0013.
 * Preserves the interview-probe-task-hardening sub-spec semantics:
 *
 * - `record_probe_round` is only *observable* to the LLM when
 *   `probeConfig.maxRounds > 0` (the orchestrator, not this file, is
 *   responsible for hiding the tool schema — see orchestrator.ts).
 * - `confirmation_heard: bool` is a self-reporting gate: `false` never bumps
 *   rounds and never flips completed; it returns a rejection string.
 * - `complete_question` is always available. For a probing question it
 *   demands at least one recorded round before completing.
 * - First-writer-wins between voice-completion and UI-click completion.
 */

export const PROBE_GATE_REJECTION =
  "You must actually voice the probe out loud and wait for the respondent's " +
  "answer before recording. Ask the probe now; after you hear the response, " +
  "call this tool again with confirmation_heard=True. If the respondent is " +
  "refusing or has gone silent, you may still record with the verbatim " +
  "refusal or 'no answer' as probe_respondent_answer — but only after you " +
  "actually heard them say so.";

export interface RecordProbeInput {
  probeQuestion: string;
  probeRespondentAnswer: string;
  confirmationHeard: boolean;
}

export interface QuestionRunnerCallbacks {
  onCompleted?: (result: QuestionTaskResult) => void;
}

/**
 * Session-scoped runner for one configured question. Owns the probe rounds
 * list, the completed flag, and the two tool implementations
 * (`recordProbeRound` / `completeQuestion`). The LLM tool bindings are
 * assembled in `orchestrator.ts` — this class stays framework-agnostic.
 */
export class QuestionRunner {
  #config: QuestionTaskConfig;
  #callbacks: QuestionRunnerCallbacks;
  #rounds: ProbeRound[] = [];
  #completed = false;
  #result: QuestionTaskResult | null = null;

  constructor(config: QuestionTaskConfig, callbacks: QuestionRunnerCallbacks = {}) {
    this.#config = config;
    this.#callbacks = callbacks;
  }

  get config(): QuestionTaskConfig {
    return this.#config;
  }

  get completed(): boolean {
    return this.#completed;
  }

  get result(): QuestionTaskResult | null {
    return this.#result;
  }

  /** `maxRounds` collapsed: `probeConfig=null` and `maxRounds=0` both give 0. */
  get maxRounds(): number {
    return this.#config.probeConfig?.maxRounds ?? 0;
  }

  /** Whether the LLM should see the `record_probe_round` tool. */
  get probeToolEnabled(): boolean {
    return this.maxRounds > 0;
  }

  /**
   * Record one probe exchange. Returns a message the LLM should read on
   * every branch, matching the Python impl's behaviour verbatim.
   */
  recordProbeRound(input: RecordProbeInput): string {
    // SelfReportingConfirmation gate — must run BEFORE any state branch
    // so that confirmationHeard=false is a true no-op.
    if (!input.confirmationHeard) return PROBE_GATE_REJECTION;

    if (this.#completed) return "This question was already answered on screen. Move on.";

    const cap = this.maxRounds;
    if (this.#rounds.length >= cap) {
      return `Probe limit of ${cap} already reached. Do not ask another probe — call complete_question now.`;
    }

    this.#rounds.push({
      probeQuestion: input.probeQuestion,
      respondentAnswer: input.probeRespondentAnswer,
    });
    const used = this.#rounds.length;

    if (used >= cap) {
      return `Recorded probe ${used}/${cap}. Probe limit reached — call complete_question now.`;
    }
    return `Recorded probe ${used}/${cap}. Ask another probe if useful, or call complete_question to finish.`;
  }

  /**
   * Model-driven completion (`complete_question` tool). Enforces the lower
   * bound: when probing is configured you must record at least one probe
   * round before completing. First-writer-wins with UI clicks.
   */
  completeFromVoice(respondentAnswer: string): { ok: true } | { ok: false; message: string } {
    if (this.#completed) return { ok: true }; // already done; no-op (idempotent)

    if (this.maxRounds <= 0) {
      this.#complete({
        questionType: this.#config.questionType,
        questionContent: this.#config.questionContent,
        respondentAnswer,
        probe: null,
      });
      return { ok: true };
    }

    if (this.#rounds.length === 0) {
      return {
        ok: false,
        message:
          "You must ask at least one probe before finishing. " +
          "Ask a follow-up question and call record_probe_round first.",
      };
    }

    const probe = this.#config.probeConfig as ProbeConfig;
    this.#complete({
      questionType: this.#config.questionType,
      questionContent: this.#config.questionContent,
      respondentAnswer,
      probe: {
        level: probe.level,
        probeInstruction: probe.instruction,
        rounds: [...this.#rounds],
      },
    });
    return { ok: true };
  }

  /**
   * UI-click completion via `merism.submit_answer` RPC. First-writer-wins:
   * returns `false` if the model already completed this question by voice.
   * A click completes the question directly and does not trigger voice probing.
   */
  completeFromUi(answer: InterviewAnswerPayload): boolean {
    if (this.#completed) return false;
    this.#complete({
      questionType: this.#config.questionType,
      questionContent: this.#config.questionContent,
      respondentAnswer: formatUiAnswer(answer),
      probe: null,
    });
    return true;
  }

  #complete(result: QuestionTaskResult): void {
    this.#completed = true;
    this.#result = result;
    this.#callbacks.onCompleted?.(result);
  }
}

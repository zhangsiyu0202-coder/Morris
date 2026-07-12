import type { Room } from "@livekit/rtc-node";

import type {
  InterviewAnswerPayload,
  InterviewRuntimeQuestion,
  InterviewRuntimeStudy,
  InterviewWorkflowConfig,
  InterviewWorkflowState,
  QuestionTaskConfig,
  QuestionTaskResult,
  SectionTaskGroupConfig,
} from "@merism/contracts";

import type { SessionLogger } from "../observability/session-logger.js";
import { InterviewStatePublisher } from "../transport/attribute-publisher.js";
import { QuestionRunner } from "./question-runner.js";
import {
  advanceTo,
  collectedAnswersMap,
  findNextCursor,
  flattenQuestions,
  initialWorkflowState,
  isComplete,
  recordQuestionResult,
} from "./workflow-state.js";

/**
 * Session-scoped orchestrator. Port of
 * `apps/agent/agent/interview/supervisor.py::InterviewSupervisorAgent` per
 * ADR-0013.
 *
 * Owns:
 *   - the authoritative `InterviewWorkflowState` (section cursor / question
 *     cursor / recorded results)
 *   - a `QuestionRunner` per configured question (probe gate + first-writer-wins)
 *   - the `InterviewStatePublisher` (writes `merism.interviewState`)
 *   - the runtime-questions map (`questionId → InterviewRuntimeQuestion`) so
 *     each attribute publish carries the structured control for the UI
 *
 * Does NOT own:
 *   - LiveKit session / audio pipeline (LiveKit-provided `voice.AgentSession`)
 *   - LLM generation (Mastra `Agent.stream()` via `@mastra/livekit`)
 *   - Appwrite writes (delegated to `persistence/finalize-client.ts`)
 *
 * The LiveKit worker wires this together in `voice-worker.ts` via
 * `onSessionStart` / `onTurnComplete` / `onCallEnd` hooks. The Mastra Agent
 * built from `merism-room-metadata::buildMerismVoiceAgent` speaks the
 * questions; the orchestrator advances after each question is completed
 * (either by voice tool call or by UI RPC).
 */
export interface OrchestratorArgs {
  room: Room;
  log: SessionLogger;
  workflowConfig: InterviewWorkflowConfig;
  runtimeQuestions: Map<string, InterviewRuntimeQuestion>;
}

export interface OrchestratorSnapshot {
  sessionId: string;
  surveyId: string;
  currentSectionId?: string;
  currentQuestionId?: string;
  isComplete: boolean;
  collectedAnswers: Record<string, Record<string, unknown>>;
}

export class InterviewOrchestrator {
  #room: Room;
  #log: SessionLogger;
  #state: InterviewWorkflowState;
  #publisher: InterviewStatePublisher;
  #runners: Map<string, QuestionRunner>;
  #hasActiveTask = false;

  constructor(args: OrchestratorArgs) {
    this.#room = args.room;
    this.#log = args.log;
    this.#state = initialWorkflowState(args.workflowConfig);
    this.#publisher = new InterviewStatePublisher({
      room: args.room,
      log: args.log,
      config: args.workflowConfig,
      runtimeQuestions: args.runtimeQuestions,
    });
    this.#runners = new Map(
      flattenQuestions(args.workflowConfig).map(({ question }) => [
        question.questionId,
        new QuestionRunner(question, {
          onCompleted: (result) => this.#onQuestionCompleted(question, result),
        }),
      ]),
    );
  }

  get currentQuestionId(): string | null | undefined {
    return this.#state.currentQuestionTaskId;
  }

  get hasActiveTask(): boolean {
    return this.#hasActiveTask;
  }

  get state(): InterviewWorkflowState {
    return this.#state;
  }

  get snapshot(): OrchestratorSnapshot {
    return {
      sessionId: this.#state.sessionId,
      surveyId: this.#state.surveyId,
      currentSectionId: this.#state.currentSectionId,
      currentQuestionId: this.#state.currentQuestionTaskId,
      isComplete: isComplete(this.#state),
      collectedAnswers: collectedAnswersMap(this.#state),
    };
  }

  /**
   * Announce readiness and publish the first question's attribute so the UI
   * renders its control. Called from `voice-worker.ts::onSessionStart` once
   * the LiveKit session is up and the RPC handler is registered.
   */
  async begin(): Promise<void> {
    await this.#publisher.publish({
      status: "ready",
      currentSectionId: this.#state.currentSectionId,
      currentQuestionId: this.#state.currentQuestionTaskId,
    });
    await this.#activateCurrentQuestion();
  }

  /**
   * Voice-side completion for the currently active question. Called by the
   * `complete_question` tool binding installed on the Mastra Agent. Returns
   * a message the LLM should read; `null` means completion succeeded (the
   * orchestrator will advance and the LLM continues with the next question).
   *
   * For probing questions, returns the "must ask at least one probe first"
   * rejection until at least one round has been recorded.
   */
  handleVoiceCompletion(respondentAnswer: string): string | null {
    const runner = this.#currentRunner();
    if (!runner) return "No active question to complete.";

    const result = runner.completeFromVoice(respondentAnswer);
    if (!result.ok) return result.message;
    return null;
  }

  /** Voice-side probe round record. */
  handleProbeRound(input: Parameters<QuestionRunner["recordProbeRound"]>[0]): string {
    const runner = this.#currentRunner();
    if (!runner) return "No active question to record a probe for.";
    return runner.recordProbeRound(input);
  }

  /** Whether the LLM should see `record_probe_round` for the current question. */
  probeToolEnabledForCurrent(): boolean {
    return this.#currentRunner()?.probeToolEnabled ?? false;
  }

  /**
   * UI-click submission via `merism.submit_answer` RPC. Delegates
   * first-writer-wins to `QuestionRunner.completeFromUi`. Returns `true`
   * when the answer was accepted, `false` when the question was already
   * completed by voice (the voice answer stands).
   */
  handleUiSubmission(answer: InterviewAnswerPayload): boolean {
    const runner = this.#runnerForId(answer.questionId);
    if (!runner) return false;
    return runner.completeFromUi(answer);
  }

  /**
   * Notify the orchestrator that a LiveKit AgentSession barge-in cancelled
   * the current question's ongoing tool loop. The state machine treats this
   * as "the model got interrupted; keep the cursor where it is and let the
   * next turn resume" — matches the Python impl (LiveKit Supervisor also
   * relies on `AgentSession` to preserve cursor across barge-in).
   */
  onBargeIn(): void {
    this.#log.info("interview barge-in observed; cursor preserved", {
      currentQuestionId: this.#state.currentQuestionTaskId ?? null,
    });
  }

  /**
   * Called when the LiveKit session shuts down (participant disconnect /
   * SIGTERM / job cancelled). Publishes a terminal attribute so the UI
   * transitions to the completed / abandoned screen. Persistence is
   * triggered from `voice-worker.ts::onCallEnd` which reads
   * `snapshot.collectedAnswers` and forwards it to
   * `persistence/finalize-client.ts`.
   */
  async shutdown(terminalStatus: "completed" | "abandoned" | "failed"): Promise<void> {
    await this.#publisher.publish({
      status: terminalStatus === "completed" ? "completed" : "abandoned",
      currentSectionId: this.#state.currentSectionId,
      currentQuestionId: this.#state.currentQuestionTaskId,
    });
    this.#hasActiveTask = false;
  }

  // --- internals ---------------------------------------------------------

  async #activateCurrentQuestion(): Promise<void> {
    const questionId = this.#state.currentQuestionTaskId;
    if (!questionId) {
      this.#hasActiveTask = false;
      return;
    }
    this.#hasActiveTask = true;
    await this.#publisher.publish({
      status: "collecting",
      currentSectionId: this.#state.currentSectionId,
      currentQuestionId: questionId,
    });
    this.#log.info("interview question activated", {
      sectionId: this.#state.currentSectionId ?? null,
      questionId,
    });
  }

  #currentRunner(): QuestionRunner | undefined {
    if (!this.#state.currentQuestionTaskId) return undefined;
    return this.#runners.get(this.#state.currentQuestionTaskId);
  }

  #runnerForId(questionId: string): QuestionRunner | undefined {
    return this.#runners.get(questionId);
  }

  #onQuestionCompleted(question: QuestionTaskConfig, result: QuestionTaskResult): void {
    const sectionId = this.#state.currentSectionId ?? this.#findSectionForQuestion(question.questionId);
    if (!sectionId) {
      this.#log.warn("question completed but section cursor is unset", {
        questionId: question.questionId,
      });
      return;
    }

    recordQuestionResult(this.#state, {
      sectionId,
      questionId: question.questionId,
      result,
    });

    const next = findNextCursor(this.#state);
    if (!next) {
      advanceTo(this.#state, { sectionId: undefined, questionId: undefined });
      this.#hasActiveTask = false;
      void this.#publisher.publish({
        status: "completed",
      });
      this.#log.info("interview completed", {
        totalAnswered: Object.keys(collectedAnswersMap(this.#state)).length,
      });
      return;
    }

    advanceTo(this.#state, { sectionId: next.sectionId, questionId: next.questionId });
    // Fire-and-forget; the publisher already logs failures.
    void this.#activateCurrentQuestion();
  }

  #findSectionForQuestion(questionId: string): string | undefined {
    for (const section of this.#state.workflowConfig.sections) {
      if (section.questions.some((q) => q.questionId === questionId)) {
        return section.sectionId;
      }
    }
    return undefined;
  }
}

/**
 * Build the runtime-questions map (`questionId → InterviewRuntimeQuestion`)
 * from either an `InterviewRuntimeStudy` or a workflow config. The
 * `InterviewRuntimeQuestion` shape carries the structured control the UI
 * renders, so we cache it once per session at start.
 */
export function indexRuntimeQuestions(
  study: InterviewRuntimeStudy | undefined,
): Map<string, InterviewRuntimeQuestion> {
  const map = new Map<string, InterviewRuntimeQuestion>();
  if (!study) return map;
  for (const section of study.sections) {
    for (const question of section.questions) {
      map.set(question.questionId, question);
    }
  }
  return map;
}

/** Utility: enumerate sections in configured order. */
export function orderedSections(config: InterviewWorkflowConfig): readonly SectionTaskGroupConfig[] {
  return config.sections;
}

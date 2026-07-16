/**
 * Session-scoped driver. Port of
 * `apps/agent/agent/interview/session_runner.py` per the flow-engine
 * refactor HANDOFF.md (2026-07-09). Replaces the ADR-0013 iteration-1
 * `orchestrator.ts` / `question-runner.ts` / `workflow-state.ts` trio —
 * these are removed in the same cutover, matching the Python-side
 * `chore(agent): delete old supervisor / workflow / task_group_builder /
 * tasks` commit.
 *
 * Owns:
 *   - the authoritative `FlowState` (visit history / answers / probes)
 *   - a `LiveKitFlowHost` instance (the seam through which the engine
 *     reaches out to LiveKit + Mastra Agent for effects)
 *   - the `InterviewStatePublisher` (writes `merism.interviewState`)
 *   - the runtime-questions map (`questionId → InterviewRuntimeQuestion`)
 *     the publisher uses to enrich the state payload with the structured
 *     control for the UI
 *
 * Does NOT own:
 *   - LiveKit session / audio pipeline (LiveKit-provided `voice.AgentSession`)
 *   - LLM generation (Mastra `Agent.stream()` via `@mastra/livekit`)
 *   - Appwrite writes (delegated to `persistence/finalize-client.ts`)
 *
 * The LiveKit worker wires this together in `voice-worker.ts` via
 * `onSessionStart` / `onCallEnd` hooks.
 */

import type { Agent } from "@mastra/core/agent";
import type { Room } from "@livekit/rtc-node";

import type {
  InterviewAnswerPayload,
  InterviewFlowConfig,
  InterviewRuntimeQuestion,
} from "@merism/contracts";

import type { SessionLogger } from "../observability/session-logger.js";
import { InterviewStatePublisher } from "../transport/attribute-publisher.js";
import { LiveKitFlowHost } from "./livekit-flow-host.js";
import type { InterviewDriver, InterviewDriverSnapshot } from "./interview-driver.js";
import { SessionTranscriptCollector, type UserInputTranscribed } from "./transcript-collector.js";
import {
  initialFlowState,
  runFlow,
  type FlowState,
} from "./flow-engine/index.js";

// ---------------------------------------------------------------------------
// Snapshot projection
// ---------------------------------------------------------------------------

/**
 * Project `FlowState` into the persistence-friendly `collectedAnswers` map
 * the finalize Function ingests. Shape is `{ [questionId]: { text, options,
 * probeRounds? } }`, matching what the old workflow-state builder used to
 * emit so the Function boundary is unchanged.
 */
function collectedAnswersFromFlowState(state: FlowState): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [stepId, answer] of state.answers.entries()) {
    const record: Record<string, unknown> = {
      questionContent: answer.questionContent,
      respondentAnswer: answer.respondentAnswer,
    };
    if (answer.selectedOptionIds.length > 0) {
      record.selectedOptionIds = [...answer.selectedOptionIds];
    }
    // Attach probe rounds if any ProbeStep executed with `forQuestionStepId = stepId`.
    for (const probe of state.probes.values()) {
      if (probe.forQuestionStepId === stepId && probe.rounds.length > 0) {
        record.probeRounds = probe.rounds.map((r) => ({
          probeQuestion: r.probeQuestion,
          respondentAnswer: r.respondentAnswer,
        }));
        break;
      }
    }
    out[stepId] = record;
  }
  return out;
}

// ---------------------------------------------------------------------------
// FlowEngineDriver
// ---------------------------------------------------------------------------

export interface FlowEngineDriverArgs {
  room: Room;
  log: SessionLogger;
  agent: Agent;
  config: InterviewFlowConfig;
  runtimeQuestions: Map<string, InterviewRuntimeQuestion>;
}

export class FlowEngineDriver implements InterviewDriver {
  #log: SessionLogger;
  #state: FlowState;
  #publisher: InterviewStatePublisher;
  #host: LiveKitFlowHost;
  #transcript = new SessionTranscriptCollector({ startedAt: Date.now() });
  #runFlowPromise: Promise<FlowState> | null = null;
  #completed = false;

  constructor(args: FlowEngineDriverArgs) {
    this.#log = args.log;
    this.#state = initialFlowState(args.config);
    this.#publisher = new InterviewStatePublisher({
      room: args.room,
      log: args.log,
      runtimeQuestions: args.runtimeQuestions,
    });
    this.#host = new LiveKitFlowHost({
      agent: args.agent,
      room: args.room,
      log: args.log,
      publisher: this.#publisher,
      runtimeQuestions: args.runtimeQuestions,
    });
  }

  // -------------------------------------------------------------------------
  // InterviewDriver surface
  // -------------------------------------------------------------------------

  get currentQuestionId(): string | null | undefined {
    // The flow engine's cursor names the current step; the RPC gate uses
    // it verbatim. When idle (before begin / after complete), returns null.
    return this.#state.currentStepId ?? null;
  }

  get hasActiveTask(): boolean {
    return this.#host.hasPending;
  }

  get snapshot(): InterviewDriverSnapshot {
    return {
      sessionId: this.#state.sessionId,
      surveyId: this.#state.surveyId,
      currentSectionId: undefined,
      currentQuestionId: this.#state.currentStepId ?? undefined,
      isComplete: this.#completed,
      collectedAnswers: collectedAnswersFromFlowState(this.#state),
      transcript: this.#transcript.snapshot,
    };
  }

  /**
   * Publish "ready" for the first step, kick off `runFlow`. The flow runs
   * to completion (or safety guard); the returned promise is stored so
   * `shutdown` can await it during a clean drain.
   *
   * Fire-and-forget by design: `runFlow` blocks on `host.askQuestion` for
   * each QuestionStep, which itself waits for a UI-submitted answer via
   * `handleUiSubmission`. Awaiting `begin()` from `voice-worker.ts` would
   * deadlock the LiveKit worker's `onSessionStart` hook.
   */
  async begin(): Promise<void> {
    await this.#publisher.publish({
      status: "ready",
      currentQuestionId: this.#state.currentStepId ?? undefined,
    });

    // Fire runFlow; do not await here (see docstring). Handle terminal
    // completion in a .then() so `#completed` reflects the flow-engine
    // finishing naturally (as opposed to `onCallEnd` shutdown).
    this.#runFlowPromise = runFlow(this.#state, this.#host, {
      info: (event, fields) => this.#log.info(event, fields ?? {}),
      warn: (event, fields) => this.#log.warn(event, fields ?? {}),
    });
    this.#runFlowPromise
      .then(() => {
        this.#completed = true;
        void this.#publisher.publish({ status: "completed" });
        this.#log.info("interview flow completed", {
          visited: this.#state.visitedStepIds.length,
          collected: this.#state.answers.size,
        });
      })
      .catch((err) => {
        // runFlow does not throw for normal step exhaustion — this catches
        // programming errors in the host (a thrown-from-unexpected path)
        // or unhandled provider transients. Log at error so an operator
        // can trace via traceId; the finalize path still runs from
        // `onCallEnd` so no data is lost.
        this.#log.error("interview flow crashed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  handleUiSubmission(answer: InterviewAnswerPayload): boolean {
    return this.#host.handleUiSubmission(answer);
  }

  /** Accept one event from LiveKit's public AgentSession transcript stream. */
  recordUserTranscript(event: UserInputTranscribed): boolean {
    return this.#transcript.record(event);
  }

  async shutdown(terminalStatus: "completed" | "abandoned" | "failed"): Promise<void> {
    await this.#publisher.publish({
      status: terminalStatus === "completed" ? "completed" : "abandoned",
      currentQuestionId: this.#state.currentStepId ?? undefined,
    });
    this.#completed = terminalStatus === "completed";
    // We don't await #runFlowPromise here — it may be blocked on
    // host.askQuestion whose deferred will never resolve after
    // shutdown. The runtime will collect the promise on process exit.
  }
}

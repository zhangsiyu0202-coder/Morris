/**
 * The shared surface both `InterviewOrchestrator` (linear-walk driver, per
 * ADR-0013) and `FlowEngineDriver` (flow-engine driver, per this sub-spec)
 * implement, so `voice-worker.ts` can wire either one without branching on
 * the concrete type.
 *
 * Kept minimal: `voice-worker.ts` needs enough to (a) start the interview,
 * (b) forward `merism.submit_answer` RPCs, (c) shut down and finalize. Any
 * driver-specific API (probe tool loop, voice completion) is not on this
 * interface — the two drivers add their own methods for callers that know
 * which driver they hold.
 */

import type { InterviewAnswerPayload, TranscriptSegment } from "@merism/contracts";

/** Snapshot returned by `driver.snapshot` — the shape `finalize-client` consumes. */
export interface InterviewDriverSnapshot {
  sessionId: string;
  surveyId: string;
  currentSectionId?: string;
  currentQuestionId?: string;
  isComplete: boolean;
  collectedAnswers: Record<string, Record<string, unknown>>;
  transcript?: {
    language: string;
    segments: TranscriptSegment[];
  };
}

export interface InterviewDriver {
  /** Deterministic id of the question the interviewee should answer next.
   *  Used by `registerSubmitAnswerRpc` to gate UI submissions. */
  readonly currentQuestionId: string | null | undefined;

  /** Whether the driver is currently expecting an answer for the current
   *  question. Used to reject stale / duplicate submits. */
  readonly hasActiveTask: boolean;

  /** Final view of the session used by the finalize Function. */
  readonly snapshot: InterviewDriverSnapshot;

  /** Publish "ready", publish the first step's attribute, kick off the flow. */
  begin(): Promise<void>;

  /**
   * Accept a UI-submitted answer for the current question. Returns `true`
   * if accepted (first-writer-wins with any pending voice completion),
   * `false` otherwise. RPC handler bounces the return code to the client.
   */
  handleUiSubmission(answer: InterviewAnswerPayload): boolean;

  /** Publish a terminal state (completed / abandoned / failed). */
  shutdown(terminalStatus: "completed" | "abandoned" | "failed"): Promise<void>;
}

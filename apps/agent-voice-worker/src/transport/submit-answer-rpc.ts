import type { Room, RpcInvocationData } from "@livekit/rtc-node";

import {
  SUBMIT_ANSWER_RPC_METHOD,
  SubmitInterviewAnswerRpcRequestSchema,
  type InterviewAnswerPayload,
  type SubmitInterviewAnswerRpcResponse,
} from "@merism/contracts";

import type { SessionLogger } from "../observability/session-logger.js";

/**
 * Whether a UI-submitted answer may complete the current question (pure).
 *
 * A click only counts for the question the driver is currently on: there
 * must be an active question task and the submitted questionId must match
 * the live cursor. Mismatches are stale / duplicate / out-of-order submits.
 * Inlined from the removed `workflow-state.ts` per the ADR-0013 iteration 5
 * cutover (flow-engine driver replaces the linear orchestrator; the RPC
 * gate is unchanged and lives here now).
 */
function shouldAcceptUiAnswer(args: {
  submittedQuestionId: string;
  currentQuestionId: string | null | undefined;
  hasActiveTask: boolean;
}): boolean {
  return (
    args.hasActiveTask &&
    args.currentQuestionId != null &&
    args.submittedQuestionId === args.currentQuestionId
  );
}

/**
 * Registers the `merism.submit_answer` RPC handler on the local participant.
 * Ported from `apps/agent/agent/interview/supervisor.py::_handle_submit_answer`
 * per ADR-0013.
 *
 * The handler enforces the authoritative cursor: a click only counts for the
 * question the orchestrator is currently on. Mismatches are stale /
 * duplicate / out-of-order submits and are rejected. When accepted, it
 * delegates first-writer-wins to the caller's `onAcceptedAnswer` (which
 * calls `QuestionRunner.completeFromUi`, returning `false` if voice
 * already completed the question).
 */
export interface SubmitAnswerHandlerArgs {
  room: Room;
  log: SessionLogger;
  getCurrentQuestionId: () => string | null | undefined;
  hasActiveTask: () => boolean;
  onAcceptedAnswer: (answer: InterviewAnswerPayload) => boolean;
}

export function registerSubmitAnswerRpc(args: SubmitAnswerHandlerArgs): void {
  const { room, log, getCurrentQuestionId, hasActiveTask, onAcceptedAnswer } = args;

  const handler = async (data: RpcInvocationData): Promise<string> => {
    log.info("submit_answer rpc: handler invoked", {
      payloadLen: data.payload?.length ?? 0,
    });
    const reject = (accepted: boolean): string => {
      const response: SubmitInterviewAnswerRpcResponse = {
        ok: true,
        accepted,
        nextQuestionId: getCurrentQuestionId() ?? undefined,
        completed: false,
      };
      return JSON.stringify(response);
    };

    let parsed: ReturnType<typeof SubmitInterviewAnswerRpcRequestSchema.safeParse>;
    try {
      parsed = SubmitInterviewAnswerRpcRequestSchema.safeParse(JSON.parse(data.payload));
    } catch (error) {
      log.warn("submit_answer rpc: invalid JSON payload", {
        error: error instanceof Error ? error.message : String(error),
      });
      return reject(false);
    }

    if (!parsed.success) {
      log.warn("submit_answer rpc: schema mismatch", {
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}:${i.code}`).join(","),
      });
      return reject(false);
    }

    const request = parsed.data;
    const currentId = getCurrentQuestionId();
    const hasTask = hasActiveTask();
    log.info("submit_answer rpc: parsed", {
      submittedQuestionId: request.answer.questionId,
      currentQuestionId: currentId ?? null,
      hasActiveTask: hasTask,
    });
    const accept = shouldAcceptUiAnswer({
      submittedQuestionId: request.answer.questionId,
      currentQuestionId: currentId,
      hasActiveTask: hasTask,
    });

    if (!accept) {
      log.warn("interview answer rejected: questionId does not match active question", {
        submittedQuestionId: request.answer.questionId,
        currentQuestionId: currentId ?? null,
        source: request.answer.source,
      });
      return reject(false);
    }

    // First-writer-wins: onAcceptedAnswer returns false if voice already
    // completed this question. In that case we tell the client the click
    // was not accepted (the voice answer stands).
    const accepted = onAcceptedAnswer(request.answer);
    if (!accepted) return reject(false);

    log.info("interview answer accepted from ui", {
      questionId: request.answer.questionId,
      source: request.answer.source,
    });

    const response: SubmitInterviewAnswerRpcResponse = {
      ok: true,
      accepted: true,
      // The orchestrator advances the cursor and publishes the next
      // question's state right after this. The client renders from that
      // authoritative attribute, so we leave nextQuestionId unset here to
      // mirror the Python impl's contract.
      nextQuestionId: undefined,
      completed: false,
    };
    return JSON.stringify(response);
  };

  try {
    room.localParticipant?.registerRpcMethod(SUBMIT_ANSWER_RPC_METHOD, handler);
  } catch (error) {
    log.warn("failed to register submit_answer rpc", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

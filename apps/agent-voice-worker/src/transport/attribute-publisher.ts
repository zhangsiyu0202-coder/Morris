import type { Room } from "@livekit/rtc-node";

import {
  INTERVIEW_STATE_ATTRIBUTE,
  InterviewAgentStateSchema,
  type InterviewAgentState,
  type InterviewRuntimeQuestion,
  type InterviewWorkflowConfig,
} from "@merism/contracts";

import type { SessionLogger } from "../observability/session-logger.js";

/**
 * Publishes `InterviewAgentState` to `merism.interviewState` on the local
 * participant. Ported from `apps/agent/agent/interview/supervisor.py::_publish_state`
 * per ADR-0013.
 *
 * The interviewee portal (`apps/web/lib/interview/transport.ts`) subscribes
 * to `RoomEvent.ParticipantAttributesChanged` and renders the structured
 * control (single/multi/scale/ranking) from `currentQuestion`. If we do not
 * publish this attribute, the UI is stuck on "访谈员正在准备问题…" forever.
 */
export class InterviewStatePublisher {
  #room: Room;
  #log: SessionLogger;
  #config: InterviewWorkflowConfig;
  #runtimeQuestions: Map<string, InterviewRuntimeQuestion>;

  constructor(args: {
    room: Room;
    log: SessionLogger;
    config: InterviewWorkflowConfig;
    runtimeQuestions: Map<string, InterviewRuntimeQuestion>;
  }) {
    this.#room = args.room;
    this.#log = args.log;
    this.#config = args.config;
    this.#runtimeQuestions = args.runtimeQuestions;
  }

  async publish(args: {
    status: InterviewAgentState["status"];
    currentSectionId?: string;
    currentQuestionId?: string;
  }): Promise<void> {
    const runtimeQuestion = args.currentQuestionId
      ? this.#runtimeQuestions.get(args.currentQuestionId)
      : undefined;

    const payload: InterviewAgentState = {
      status: args.status,
      currentSectionId: args.currentSectionId,
      currentQuestionId: args.currentQuestionId,
      currentQuestion: runtimeQuestion,
      updatedAt: new Date().toISOString(),
    };

    // Validate before sending so a schema drift is caught here (with the
    // logger context) rather than surfacing as a UI-side parse failure that
    // leaves the interviewee stuck on the preparing screen.
    const parsed = InterviewAgentStateSchema.safeParse(payload);
    if (!parsed.success) {
      this.#log.error("interview state schema violation; refusing to publish", {
        status: args.status,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
      });
      return;
    }

    try {
      await this.#room.localParticipant?.setAttributes({
        [INTERVIEW_STATE_ATTRIBUTE]: JSON.stringify(parsed.data),
      });
    } catch (error) {
      // Best-effort publish; a failed set_attributes should not tear down
      // the whole session. Log at warn so an operator can trace via traceId.
      this.#log.warn("failed to publish agent state", {
        status: args.status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

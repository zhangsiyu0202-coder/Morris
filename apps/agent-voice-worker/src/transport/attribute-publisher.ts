import type { Room } from "@livekit/rtc-node";

import {
  INTERVIEW_STATE_ATTRIBUTE,
  InterviewAgentStateSchema,
  type InterviewAgentState,
  type InterviewRuntimeQuestion,
} from "@merism/contracts";

import type { SessionLogger } from "../observability/session-logger.js";

/**
 * Minimal typed contract of the state-publish surface that consumers depend
 * on (e.g. `LiveKitFlowHost`). Extracted so tests can substitute a spy that
 * captures call ordering without instantiating the full LiveKit-coupled
 * publisher. `InterviewStatePublisher` implements this interface implicitly
 * (structurally) — no `implements` clause is needed.
 */
export interface InterviewStateSink {
  publish(args: {
    status: InterviewAgentState["status"];
    currentSectionId?: string;
    currentQuestionId?: string;
  }): Promise<void>;
}

/**
 * Publishes `InterviewAgentState` to `merism.interviewState` on the local
 * participant. Ported from `apps/agent/agent/interview/supervisor.py::_publish_state`
 * and preserved through the ADR-0013 iteration 5 flow-engine cutover — the
 * publisher is config-agnostic (only needs the `runtimeQuestions` index to
 * enrich the payload with the structured control), so it works for both the
 * old workflow-config driver and the new flow-engine driver.
 *
 * The interviewee portal (`apps/web/lib/interview/transport.ts`) subscribes
 * to `RoomEvent.ParticipantAttributesChanged` and renders the structured
 * control (single/multi/scale/ranking) from `currentQuestion`. If we do not
 * publish this attribute, the UI is stuck on "访谈员正在准备问题…" forever.
 */
export class InterviewStatePublisher {
  #room: Room;
  #log: SessionLogger;
  #runtimeQuestions: Map<string, InterviewRuntimeQuestion>;

  constructor(args: {
    room: Room;
    log: SessionLogger;
    runtimeQuestions: Map<string, InterviewRuntimeQuestion>;
  }) {
    this.#room = args.room;
    this.#log = args.log;
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
      this.#log.info("interview state published", {
        status: args.status,
        currentSectionId: args.currentSectionId ?? null,
        currentQuestionId: args.currentQuestionId ?? null,
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

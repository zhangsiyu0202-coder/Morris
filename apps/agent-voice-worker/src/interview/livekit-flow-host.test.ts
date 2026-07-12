/**
 * Regression tests for LiveKitFlowHost — protect the two race fixes that
 * scripts/smoke-livekit-e2e.ts uncovered when it advanced through T4
 * (submit_answer RPC accepted) faster than the pending-answer slot could be
 * registered:
 *
 *   1. `askQuestion` MUST register the pending-answer slot BEFORE it
 *      publishes `status=collecting`. If the publish happens first, a client
 *      that observes the attribute change and immediately fires the
 *      `merism.submit_answer` RPC will race the worker: the RPC handler
 *      calls `host.hasPending`, sees `false`, and rejects the submission
 *      with "questionId does not match active question" even though the
 *      submitted questionId matches the current step. See the fix in
 *      `livekit-flow-host.ts::askQuestion` (git log: "eliminate race between
 *      attribute publish and pending-answer registration").
 *
 *   2. `onStepEnter` MUST NOT publish `status=collecting`. The flow engine
 *      calls `onStepEnter` for every step (question / probe / condition)
 *      before the executor runs; publishing "collecting" here would happen
 *      BEFORE `askQuestion` registers the pending slot, which is the same
 *      race as (1). The executors own their publishes: `askQuestion`
 *      publishes for QuestionStep, `runProbe`'s askAndWait will publish for
 *      probe rounds (future), ConditionStep does not publish (short-lived).
 *
 * Both invariants are behavioral properties of `LiveKitFlowHost` — the
 * flow engine itself is oblivious. The test substitutes a spy publisher
 * that captures `host.hasPending` at each publish call.
 */

// eslint-disable-next-line no-restricted-imports -- direct import of Room type only, no runtime ref
import type { Room } from "@livekit/rtc-node";
import type { Agent } from "@mastra/core/agent";
import type { InterviewAgentState, QuestionStep } from "@merism/contracts";
import { describe, expect, it } from "vitest";

import { LiveKitFlowHost } from "./livekit-flow-host.js";
import type { HostContext } from "./flow-engine/index.js";
import type { InterviewStateSink } from "../transport/attribute-publisher.js";
import type { SessionLogger } from "../observability/session-logger.js";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface PublishEvent {
  status: InterviewAgentState["status"];
  currentQuestionId?: string;
  /** Snapshot of `host.hasPending` at the moment publish() ran. */
  hasPendingAtPublish: boolean;
}

/**
 * Publisher spy that captures `hasPending` on the host at the exact moment
 * `publish()` is invoked. Uses a lazy getter for the host reference to break
 * the construction cycle (host needs publisher; publisher needs host).
 */
function makeSpyPublisher(getHost: () => LiveKitFlowHost): {
  sink: InterviewStateSink;
  events: PublishEvent[];
} {
  const events: PublishEvent[] = [];
  return {
    events,
    sink: {
      async publish(args) {
        events.push({
          status: args.status,
          currentQuestionId: args.currentQuestionId,
          hasPendingAtPublish: getHost().hasPending,
        });
      },
    },
  };
}

const NOOP_LOG: SessionLogger = {
  traceId: "test-trace",
  info: () => {},
  warn: () => {},
  error: () => {},
};

const NOOP_AGENT = {
  // askQuestion does not invoke the agent — the LLM is only used for
  // condition eval and probe. We stub `generate` so a runtime call would at
  // least be observable.
  generate: async () => {
    throw new Error("agent.generate must not be called for askQuestion / onStepEnter");
  },
} as unknown as Agent;

const FAKE_ROOM = {} as unknown as Room;

const HOST_CTX: HostContext = {
  sessionId: "test-session",
  surveyId: "test-survey",
  state: {},
};

function makeQuestionStep(stepId: string): QuestionStep {
  return {
    stepId,
    kind: "question",
    questionType: "open_ended",
    content: `Question ${stepId} content`,
    options: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LiveKitFlowHost — pending-first publish invariant", () => {
  it("askQuestion sets hasPending BEFORE publishing status=collecting", async () => {
    // ARRANGE
    let host!: LiveKitFlowHost;
    const spy = makeSpyPublisher(() => host);
    host = new LiveKitFlowHost({
      agent: NOOP_AGENT,
      room: FAKE_ROOM,
      log: NOOP_LOG,
      publisher: spy.sink,
      runtimeQuestions: new Map(),
    });

    // ACT: start askQuestion but don't await — it hangs on the pending
    // Promise until handleUiSubmission resolves it, which we do below.
    const askPromise = host.askQuestion(makeQuestionStep("q1"), HOST_CTX);

    // Yield to let the internal `await publisher.publish(...)` complete.
    await Promise.resolve();
    await Promise.resolve();

    // ASSERT: exactly one publish event, and hasPending was true at the
    // time publish() ran. This is the primary race invariant — the client
    // will only see status=collecting AFTER hasPending is true, so any
    // subsequent RPC arrives at a host that can accept it.
    expect(spy.events).toHaveLength(1);
    expect(spy.events[0]).toMatchObject({
      status: "collecting",
      currentQuestionId: "q1",
      hasPendingAtPublish: true,
    });
    expect(host.hasPending).toBe(true);
    expect(host.pendingStepId).toBe("q1");

    // CLEANUP: resolve the pending promise so the test doesn't leak.
    host.handleUiSubmission({
      questionId: "q1",
      sectionId: "s1",
      questionType: "open_ended",
      source: "ui",
      text: "cleanup",
      selectedOptions: [],
      ranking: [],
    });
    await askPromise;
  });

  it("onStepEnter does not publish (executors own publish; publishing here re-introduces the race)", async () => {
    // ARRANGE
    let host!: LiveKitFlowHost;
    const spy = makeSpyPublisher(() => host);
    host = new LiveKitFlowHost({
      agent: NOOP_AGENT,
      room: FAKE_ROOM,
      log: NOOP_LOG,
      publisher: spy.sink,
      runtimeQuestions: new Map(),
    });

    // ACT
    await host.onStepEnter("q1", HOST_CTX);
    await host.onStepEnter("c1", HOST_CTX);
    await host.onStepEnter("p1", HOST_CTX);

    // ASSERT: onStepEnter alone must not publish. It runs for every step
    // (question / condition / probe) before the executor — a publish here
    // would happen BEFORE askQuestion sets pending, which is the exact
    // race the primary fix eliminates.
    expect(spy.events).toEqual([]);
    expect(host.hasPending).toBe(false);
  });

  it("askQuestion publish carries the correct currentQuestionId", async () => {
    let host!: LiveKitFlowHost;
    const spy = makeSpyPublisher(() => host);
    host = new LiveKitFlowHost({
      agent: NOOP_AGENT,
      room: FAKE_ROOM,
      log: NOOP_LOG,
      publisher: spy.sink,
      runtimeQuestions: new Map(),
    });

    const askPromise = host.askQuestion(makeQuestionStep("q-42"), HOST_CTX);
    await Promise.resolve();
    await Promise.resolve();

    expect(spy.events).toHaveLength(1);
    expect(spy.events[0].currentQuestionId).toBe("q-42");
    expect(host.pendingStepId).toBe("q-42");

    // cleanup
    host.handleUiSubmission({
      questionId: "q-42",
      sectionId: "s1",
      questionType: "open_ended",
      source: "ui",
      text: "cleanup",
      selectedOptions: [],
      ranking: [],
    });
    await askPromise;
  });
});

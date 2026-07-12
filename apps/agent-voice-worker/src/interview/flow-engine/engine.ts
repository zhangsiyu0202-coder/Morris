/**
 * The engine main loop — `runFlow`.
 *
 * Port of `apps/agent/agent/flow_engine/engine.py` per ADR-0013 + the
 * flow-engine-ts-reimpl sub-spec.
 *
 * Corresponds to typebot's `walkFlowForward.ts` L47-91 do-while. Ours is a
 * `while` because we don't have typebot's group concept: the flow is a flat
 * list of steps connected by edges.
 *
 * The loop:
 *   1. Locate the step at `state.currentStepId`.
 *   2. Publish "entering step" to the host (so the frontend can render).
 *   3. Dispatch on `step.kind`:
 *        question  → host.askQuestion(step)  → resolveAnswerEdge
 *        probe     → host.runProbe(step)     → resolveDefaultEdge
 *        condition → per item: host.evaluateCondition(condition, answer)
 *                    first YES wins → item.outgoingEdgeId
 *                    else           → step.outgoingEdgeId
 *   4. Follow the edge to the next stepId.
 *   5. Repeat until edge resolves to `null` (or safety guard trips).
 *
 * NO LiveKit imports here. The FlowEngineHost interface (types.ts) is the
 * sole seam. This module is fully covered by unit tests with a ScriptedHost.
 */

import type {
  ConditionStep,
  FlowStep,
  ProbeStep,
  QuestionStep,
} from "@merism/contracts";

import {
  followEdge,
  locateStep,
  resolveAnswerEdge,
  resolveDefaultEdge,
} from "./edges.js";
import {
  MAX_REVISITS,
  recordStepAnswer,
  stepAnswer,
  type FlowState,
} from "./state.js";
import type { FlowEngineHost, HostContext } from "./types.js";

// ---------------------------------------------------------------------------
// Logger seam
// ---------------------------------------------------------------------------

/**
 * Minimal logger surface the engine needs. Implementations may be the
 * `agent.flow-engine.*` scoped logger from `@merism/observability` in
 * production, or a spy in tests. Optional so unit tests can omit it.
 */
export interface FlowEngineLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

/**
 * Walk the flow graph to completion (or safety guard). Returns the final
 * state so callers can persist results.
 *
 * `logger` is optional; when provided we emit one info line per step
 * transition and one warn line per safety break, matching the observability
 * contract (`.kiro/steering/errors-and-observability.md`). No provider
 * prompts / raw answers are logged — those go through the host, which
 * decides its own logging policy for LiveKit-side traffic.
 */
export async function runFlow(
  state: FlowState,
  host: FlowEngineHost,
  logger?: FlowEngineLogger,
): Promise<FlowState> {
  const visitCounter = new Map<string, number>();
  const ctx: HostContext = {
    sessionId: state.sessionId,
    surveyId: state.surveyId,
    state,
  };

  while (state.currentStepId !== null) {
    const stepId = state.currentStepId;
    const step = locateStep(state.config, stepId);
    if (step === null) {
      logger?.warn("flow.step.missing", { stepId });
      break;
    }

    const visits = (visitCounter.get(stepId) ?? 0) + 1;
    visitCounter.set(stepId, visits);
    if (visits > MAX_REVISITS) {
      logger?.warn("flow.loop.guard.tripped", { stepId, visits });
      break;
    }

    state.visitedStepIds.push(stepId);
    await host.onStepEnter(stepId, ctx);
    logger?.info("flow.step.enter", { stepId, kind: step.kind });

    const nextEdgeId = await executeStep(step, state, host, ctx, logger);

    const nextStepId = followEdge(state.config, nextEdgeId);
    state.currentStepId = nextStepId;
    logger?.info("flow.step.exit", { stepId, nextEdgeId, nextStepId });
  }

  await host.onFlowCompleted(ctx);
  logger?.info("flow.completed", { visited: state.visitedStepIds.length });
  return state;
}

/**
 * Dispatch one step to its executor. Returns the outgoing edge id (or
 * `null`) the caller uses to advance the cursor.
 *
 * Never throws for a normal "step didn't produce an edge" — that's `null`
 * and the loop terminates naturally. Provider errors from the host bubble
 * up to `runFlow`; the host is expected to catch its own transient errors
 * and translate them into `false` (for `evaluateCondition`) or empty
 * results (for `runProbe`).
 */
async function executeStep(
  step: FlowStep,
  state: FlowState,
  host: FlowEngineHost,
  ctx: HostContext,
  logger?: FlowEngineLogger,
): Promise<string | null> {
  if (step.kind === "question") {
    const q = step as QuestionStep;
    const result = await host.askQuestion(q, ctx);
    recordStepAnswer(state, {
      stepId: q.stepId,
      questionContent: q.content,
      result,
    });
    return resolveAnswerEdge(q, result);
  }

  if (step.kind === "probe") {
    const p = step as ProbeStep;
    const result = await host.runProbe(p, ctx);
    state.probes.set(p.stepId, {
      forQuestionStepId: p.forQuestionStepId,
      rounds: [...result.rounds],
    });
    return resolveDefaultEdge(p);
  }

  if (step.kind === "condition") {
    const c = step as ConditionStep;
    // Host-driven: each item's natural-language `condition` is evaluated by
    // the host's LLM against the referenced source answer. First YES wins;
    // if all NO (or source answer missing), fall to the step's default
    // outgoing edge. Matches Retell AI's "prompt condition" semantic.
    for (const item of c.items) {
      const source = stepAnswer(state, item.predicate.sourceStepId);
      if (source === null) {
        // sourceStepId points at a step whose answer hasn't been recorded
        // yet — misconfigured flow. Warn so ops can see this happened;
        // skip the item so the flow doesn't strand.
        logger?.warn("flow.condition.source_missing", {
          stepId: c.stepId,
          itemId: item.itemId,
          sourceStepId: item.predicate.sourceStepId,
        });
        continue;
      }
      const matched = await host.evaluateCondition(
        item.predicate.condition,
        source,
        ctx,
      );
      if (matched) return item.outgoingEdgeId ?? null;
    }
    return resolveDefaultEdge(c);
  }

  // Unknown step kind — the discriminated union in @merism/contracts should
  // have prevented this, but if a future kind lands without a dispatch
  // branch, terminate the flow rather than infinite-loop.
  logger?.warn("flow.step.unknown_kind", {
    stepId: (step as FlowStep).stepId,
    kind: (step as { kind: string }).kind,
  });
  return null;
}

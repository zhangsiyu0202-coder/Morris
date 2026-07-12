# ADR 0014: Declarative flow engine for realtime interview orchestration

## Status

Accepted (2026-07-12).

Supersedes the realtime-interview state-machine shape of **ADR-0013** — the
Mastra Agent + `@mastra/livekit` host stack is preserved verbatim; only the
in-process orchestration model changes from an imperative session-scoped
orchestrator (Section → Question walk + probe gate + first-writer-wins) to a
declarative graph of `QuestionStep` / `ProbeStep` / `ConditionStep` nodes
walked by a `run_flow` main loop.

This is **iteration 5** of the ADR-0013 rollout. The prior iterations moved
the process boundary (Python → TS worker) and the framework (`livekit-agents`
Python → `@mastra/livekit` TS) without changing the orchestration shape; this
iteration changes the shape.

## Context

The imperative orchestrator that shipped through ADR-0013 iteration 4 was a
direct port of the Python `Supervisor + TaskGroup + AgentTask` structure into
TypeScript classes:

- `interview/orchestrator.ts` — a session-scoped `InterviewOrchestrator`
  class that owned the section/question cursor, one `QuestionRunner` per
  configured question, an in-memory `InterviewWorkflowState`, and RPC / attribute
  publish wiring.
- `interview/question-runner.ts` — one instance per configured question. Owned
  a bounded LLM tool loop that let the model self-report probe rounds via a
  conditionally-registered `record_probe_round` tool (the shape hardened by
  `.kiro/specs/interview-probe-task-hardening/`).
- `interview/workflow-state.ts` — pure state transitions (`shouldAcceptUiAnswer`,
  `formatUiAnswer`, `findNextCursor`, `collectedAnswersMap`).

Three shortcomings compounded as the survey-editor sub-spec matured branch
rules and the researcher-authored condition surface:

1. **Section/question walk was hardcoded, but researchers wanted branch
   logic.** The survey editor grew `Survey.branchRules[]` and per-option
   `outgoingEdgeId`. Bolting conditional jumps onto a linear Section-Question
   walk meant the orchestrator had to reach into the workflow state and
   rewrite the cursor, which is the exact "let the imperative controller
   compute the next step" pattern this project has consistently rejected.
2. **The LLM's job was ambiguous.** The Python-era `record_probe_round` tool
   was one gate against LLM confabulation, but the model still saw the entire
   research goal in `supervisorInstruction` and could reorder its own turns.
   Property tests P-FLOW-01..05 kept passing because they were about the
   walker, not about the LLM.
3. **Probe / condition logic drifted from the survey editor.** ProbeConfig
   fields lived on `QuestionBlock` (`level`, `instruction`, `maxRounds`), but
   branch rules lived at the Survey level, and the two decision surfaces were
   coupled only by whoever was writing the orchestrator that day.

The Python archive branch (deleted with the Python worker per ADR-0013) had
started a `flow_engine` module — `engine.py::run_flow`, `edges.py`,
`probe.py`, `condition_eval.py`, `livekit_host.py` — that solved the same
problems by making the interview a graph and reducing the controller to a
main loop. This ADR ports that design into TypeScript.

## Decision

Replace the imperative orchestrator with a declarative flow engine:

- `apps/agent-voice-worker/src/interview/flow-engine/` is pure runtime, no
  side effects:
  - `types.ts` — `FlowEngineHost` seam + envelope types (`HostContext`,
    `QuestionRunResult`, `ProbeRunResult`).
  - `state.ts` — `FlowState` + `stepAnswer` / `readAnswerFromState` helpers.
  - `edges.ts` — `locateStep` / `followEdge` / `resolveAnswerEdge` /
    `resolveDefaultEdge` (pure lookup functions).
  - `probe.ts` — `runProbeLoop` + `parseYesNo` + `buildProbeGenerationPrompt`
    + `buildJudgePrompt`.
  - `condition-eval.ts` — `buildConditionPrompt`.
  - `engine.ts` — `runFlow` main loop.
- `apps/agent-voice-worker/src/interview/livekit-flow-host.ts` implements
  `FlowEngineHost` over Mastra `Agent` (condition eval + probe generate/judge
  go through `agent.generate`) and LiveKit (publish via `InterviewStateSink`,
  receive UI submissions via the `#pendingAnswer` deferred pattern).
- `apps/agent-voice-worker/src/interview/flow-driver.ts` is the session-scoped
  driver plugging the flow engine into the worker's `onSessionStart` /
  `onCallEnd` lifecycle. It implements the `InterviewDriver` interface
  extracted in `interview-driver.ts` so `onSessionStart` does not need to
  know the specific state-machine implementation.
- `packages/contracts/src/flow-engine.ts` defines the `QuestionStep` /
  `ProbeStep` / `ConditionStep` / `InterviewFlowConfig` shapes. The Function
  side composes flow configs via `buildInterviewFlowConfigFromDraft`
  (`packages/contracts/src/api.ts`).

The engine, not the LLM prompt, owns the cursor:

- `runFlow` starts at `entryStepId`, calls `host.askQuestion` for
  `QuestionStep`, `host.runProbe` for `ProbeStep`, `host.evaluateCondition`
  for `ConditionStep`. The LLM only produces a natural-language answer (for
  conditions and probe judgments); it never chooses the next step.
- `edges.ts` is a pure lookup function that follows explicit edges: option's
  `outgoingEdgeId` beats the step's default `outgoingEdgeId`, and a `null`
  edge terminates the flow.
- `runProbeLoop` bounds probe rounds by `probeConfig.maxRounds`; the judge's
  yes/no is parsed with a bias toward STOP (probe termination is safer than
  runaway probing).

Deleted:

- `apps/agent-voice-worker/src/interview/orchestrator.ts`
- `apps/agent-voice-worker/src/interview/question-runner.ts`
- `apps/agent-voice-worker/src/interview/workflow-state.ts`

Preserved from the imperative orchestrator:

- First-writer-wins between voice and UI submission (the `#pendingAnswer`
  deferred slot in `LiveKitFlowHost` matches on `stepId`; the RPC handler in
  `transport/submit-answer-rpc.ts` gates on `shouldAcceptUiAnswer` +
  `host.hasPending`).
- Attribute publish shape (`merism.interviewState` structure is unchanged;
  clients written for iteration 4 continue to work).
- Finalize path (`persistence/finalize-client.ts` unchanged; sessions still
  end with a single one-way append to the Appwrite Function).

## Consequences

Positive:

- Branch logic is now first-class. Researcher-authored `branchRules[]` in the
  survey editor compose to explicit edges on `QuestionStep.options[]` and
  standalone `ConditionStep` nodes; no orchestrator-side rewiring.
- LLM's job is narrow. It evaluates one natural-language condition per
  `ConditionStep` and produces / judges probes; it does not choose the next
  step. This eliminates a family of "LLM reordered the interview" defects
  that P-FLOW-01..05 could not catch because they were about the walker.
- Probe / condition semantics live in one place. `runProbeLoop` +
  `buildProbeGenerationPrompt` + `buildJudgePrompt` + `parseYesNo` + the
  `defaultBias` argument are all in `probe.ts` — one file, one review
  surface, one property test file (`tests/properties/flow-engine/probe-loop.test.ts`).
- Composer / worker byte-parity is verifiable.
  `buildInterviewFlowConfigFromDraft` reuses the same composed
  `supervisorInstruction` string that
  `buildInterviewWorkflowConfigFromDraft` produces (assigned to
  `flowConfig.moderatorInstruction`), so switching the worker to the
  flow-engine path introduces no persona drift.

Negative:

- Two composer functions (`buildInterviewWorkflowConfigFromDraft`,
  `buildInterviewFlowConfigFromDraft`) coexist in `packages/contracts`. The
  first is dead weight on the worker path but is kept as a
  backward-compatibility escape hatch in case a future ADR needs to revert
  the flow-engine cutover. This is scheduled for sunset once a full release
  cycle has passed with the flow engine in production; sunset requires a
  follow-up ADR.
- `InterviewRoomMetadata` still emits three shapes (`runtimeStudy` +
  `workflowConfig` + `flowConfig`). The worker only consumes `flowConfig`;
  the other two travel across the network for zero benefit today. Same
  sunset track as the composer.

## Room-metadata precedence (binding)

The `agent:` resolver in `apps/agent-voice-worker/src/mastra/voice-worker.ts`
consumes room-metadata in this order:

1. `ctx.job.metadata` — dispatch metadata via `AgentDispatchClient.createDispatch({ metadata })`.
   This is authoritative in the mastra/livekit lifecycle because at
   agent-resolver time, `ctx.room` is a stub (`name === null`,
   `metadata === ""`) — the room state has not yet been synced to the
   worker.
2. `ctx.room.metadata` — fallback for legacy dispatchers that only set room
   metadata.

`issueLivekitToken` and any other dispatcher MUST embed the full
`InterviewRoomMetadata` (including `flowConfig`) in the dispatch metadata
payload. If both dispatch and room metadata are absent or malformed, the
worker refuses the job (fail-closed) — post iteration 5 there is no
`runtimeStudy` → `workflowConfig` fallback compose path in the worker.

## Attribute-publish ordering (binding)

`LiveKitFlowHost.askQuestion` MUST register the pending-answer slot BEFORE
publishing `status=collecting`. Reversing the two operations re-introduces
a race between the client observing the attribute change and the RPC
handler seeing `hasPending=false` when the client's `merism.submit_answer`
arrives.

`onStepEnter` MUST NOT publish. The engine calls `onStepEnter` for every
step (question / probe / condition) before the executor runs; publishing
"collecting" here would happen BEFORE `askQuestion` registers the pending
slot, which is the same race. The executors own their publishes:
`askQuestion` publishes for `QuestionStep`, `runProbe`'s internal
`askAndWait` will publish for probe rounds when the voice-completion tool
loop lands, `ConditionStep` does not publish (short-lived LLM eval).

Guarded by
`apps/agent-voice-worker/src/interview/livekit-flow-host.test.ts` — the
regression test flips to failure if either invariant regresses.

## Alternatives considered

- **Keep the imperative orchestrator, layer branchRules on top.** Rejected —
  every branch rule would have to reach through the workflow-state cursor
  and rewrite it, which was the imperative variant of "LLM prompt drives
  the step order" but with the researcher's config playing the role of the
  prompt. Same failure mode, different actor.
- **LangGraph.** Rejected in ADR-0001 and rejected again here. LangGraph is
  a general-purpose graph runtime with node/edge callbacks and a heavy
  runtime surface; we need seven pure functions and a main loop. Adding
  LangGraph to route seven functions is 100:1 leverage the wrong way.
- **Vapi / webhook-based orchestration.** Rejected — the interview loop
  needs to react within the same round-trip as the LLM (probe judge on
  each round), which webhook orchestration cannot meet without adding
  another network hop per round. This is the same argument as ADR-0001's
  rejection of an external state machine.

## Sunset checklist for the legacy composer path

Trigger: one full sub-spec cycle (approx. one calendar month) with the flow
engine live and zero rollback events.

Actions (in this order, in one PR):

1. Delete `buildInterviewWorkflowConfigFromDraft` from
   `packages/contracts/src/api.ts` (contract-first, per
   `contracts.md::Cross-module change order`).
2. Delete `InterviewWorkflowConfigSchema` (and its transitive imports).
3. Remove `workflowConfig` from `InterviewRoomMetadataSchema` (breaking; ADR
   for schema change if any external consumer still reads it).
4. Update `buildInterviewFlowConfigFromDraft` to compose the persona
   directly (no more piggybacking on the old composer's output).
5. Update `buildInterviewRoomMetadataFromDraft` to emit only `flowConfig` +
   `runtimeStudy` (or just `flowConfig` — see step 6).
6. Consider whether `runtimeStudy` is still needed. If nothing consumes it
   (analysis Functions read from Appwrite, not room metadata), delete it
   from the metadata payload too.

The sunset PR MUST include the follow-up ADR (0015 or later) recording the
final metadata shape.

# ADR 0013: Migrate realtime interview + page assistant to Mastra + `@mastra/livekit`

## Status

The realtime-worker portion is superseded by ADR-0018. This ADR remains active
for the Morris page-assistant migration.

Accepted (2026-07-12).

Supersedes:

- **ADR-0001** *LiveKit Supervisor Workflow for Voice Interviews* — the
  realtime interview controller framework choice is replaced (workflow shape,
  ordered Section → Question with probe gating, is preserved verbatim; only
  the host framework and process boundary change).
- **ADR-0002** *Page Assistant on Vercel AI SDK 6* — the page-assistant agent
  framework choice is replaced (tool contracts, tool metadata, needs-approval
  semantics, message pruning, streaming to `@ai-sdk/react useChat` are all
  preserved; only the agent runtime library changes).

## Context

Two independent LLM chains ran on two independent stacks:

- **LiveKit Agent (interview host)** ran a Python `livekit-agents`
  `Supervisor + TaskGroup + AgentTask` workflow in `apps/agent/`.
- **Morris (page assistant)** ran a TypeScript Vercel AI SDK 6 `ToolLoopAgent`
  in `apps/web/lib/assistant/`.

Two runtimes means two logger contracts, two retry helpers, two contract
mirrors (TS `packages/contracts` + Python `apps/agent/agent/contracts.py`),
two CI matrices (`pnpm test` + `pnpm test:py`), two provider adapter surfaces
(Python `agent/providers/*.py` + TS `apps/web/lib/assistant/providers/*.ts`),
two health/drain implementations, two dispatch models, and a mirrored subset
of the same zod schemas the interview needs to consume. Every cross-module
change had to land twice.

A parallel TypeScript prototype worker (`apps/agent-voice-worker/`, based on
`@mastra/livekit`) demonstrated the interview surface can be served from
Node.js against the same `InterviewRoomMetadata`, if:

1. the interview state machine (section cursor / question cursor / probe
   maxRounds gate / confirmation-heard self-report / first-writer-wins UI
   answer) is ported faithfully;
2. the participant attribute (`merism.interviewState`) and RPC
   (`merism.submit_answer`) protocols are implemented;
3. the finalize path (transcript / recording / collected answers /
   quality flags → Appwrite Functions, one-way append-only) is implemented;
4. the observability contract (`agent.*` scope, `traceId`, retry
   classification, error boundary) is implemented on top of
   `packages/observability`;
5. dispatch is single-selector (only one worker joins each room).

Item 1 requires no architectural change — the Section/Question/Probe shape
comes from `@merism/contracts` and is framework-agnostic. Items 2–5 are
already required by the existing contracts, steering, and function boundary;
they were simply not implemented in the prototype worker.

## Decision

Adopt **Mastra + `@mastra/livekit`** as the single agent runtime across both
LLM chains:

- **LiveKit Agent (interview host):** the TypeScript worker in
  `apps/agent-voice-worker/` becomes the only production interview worker.
  It uses `createLiveKitWorker` from `@mastra/livekit/worker` for the LiveKit
  transport and turn detection, and Mastra `Agent` instances for the LLM
  loop. The workflow shape from ADR-0001 (`Supervisor → Section TaskGroup →
  QuestionTask`) is preserved as a **session-scoped orchestrator class**
  inside the worker, not delegated to the LLM prompt.
- **Morris (page assistant):** the TypeScript agent in
  `apps/web/lib/assistant/` migrates from Vercel AI SDK 6 `ToolLoopAgent` to
  Mastra `Agent`. The tool metadata registry (per `morris-tool-metadata`
  sub-spec), the `needsApproval` semantics (per ADR-0009 for HITL), the
  message pruning strategy (per ADR-0009 for `pruneMessages`), and the
  `@ai-sdk/react useChat` streaming transport are preserved by mapping onto
  the Mastra `Agent.stream()` UI-message adapter.
- **Python worker (`apps/agent/`) is deleted immediately.** User has taken
  an emergency snapshot per `docs/dev/git-backup-and-restore.md` and
  explicitly authorized destruction. The `pnpm test:py` script and the CI
  matrix step are removed.
- **`apps/agent/agent/contracts.py` Python mirror is deleted** together with
  the Python worker. `packages/contracts` (zod, TS) becomes the only
  cross-module contract file for interview shapes.

### Migration completeness bar (binding)

To land this ADR the `apps/agent-voice-worker` codebase MUST include (in the
same PR wave, per `.kiro/steering/pre-implementation.md § No MVP`):

1. **State machine parity.** A session-scoped orchestrator with:
   - ordered Section walk
   - one QuestionTask instance per configured question
   - probe `maxRounds` hard ceiling + `confirmation_heard: bool`
     self-reporting gate (identical semantics to
     `apps/agent/agent/interview/tasks/question.py` today, verified by
     porting the property test `test_probe_tool_gate.py` P-FLOW-06 /
     P-FLOW-07 to `vitest` + `fast-check`)
   - first-writer-wins between voice completion and UI RPC submission
2. **Attribute + RPC protocol.**
   - Publishes `InterviewAgentState` to `merism.interviewState` on every
     question enter and lifecycle transition
   - Registers `merism.submit_answer` RPC handler that accepts only the
     current cursor's `questionId`, returns `SubmitInterviewAnswerRpcResponse`
3. **Finalize / persistence.** On session end (completed / abandoned /
   failed), calls a new Appwrite Function `finalizeInterviewSession` (single
   append-only entry) that writes transcript segments, `collectedAnswers`,
   `qualityFlags`, and (if ParticipantEgress recorded) the recording — never
   round-trips turn-by-turn state through Appwrite.
4. **Dispatch is single-selector.** `apps/agent-voice-worker` registers under
   `agentName: "merism-mastra-voice-worker"`. `issueLivekitToken` dispatches
   this name explicitly on every token issuance. The Python worker's
   auto-dispatch is removed by deleting the process; the deleted-file
   guarantee is stronger than a per-worker `agent_name` toggle.
5. **Observability.** Uses `createLogger("agent.*")` from
   `packages/observability`; every session has a stable `traceId` derived
   from `sessionId`; provider adapters classify failures into
   `TransientProviderError` / `PermanentProviderError` for `withRetry`.
6. **Health + drain.** Standalone Node HTTP server at `/_livez` + `/_readyz`
   with SIGTERM prestop marker (mirrors
   `apps/agent/agent/health.py` shape; see `docs/dev/health-and-drain.md`).
7. **Fail closed on bad metadata.** `parseJson` and
   `InterviewRoomMetadataSchema.safeParse` failures log at `error` and refuse
   the job — no static "what would you like to test?" fallback.
8. **Test parity.** Unit + property tests co-shipped for state machine,
   probe gate, RPC accept/reject, first-writer-wins, dispatch single-worker,
   TTS/STT close-and-abort semantics, finalize idempotence.

Nothing in this ADR authorizes:

- introducing LangGraph, Temporal, or a third controller framework
- letting the LLM prompt drive section/question order (the orchestrator
  drives; the LLM only asks / probes / consolidates)
- weakening the "anonymous interviewees never write directly to Appwrite"
  boundary — the new finalize Function keeps the same shape as
  `issueLivekitToken` (pure `handler.ts` + SDK wrapper `main.ts`)
- co-mingling Morris and Interview LLM traces (`morris.*` vs `agent.*` scope
  namespaces remain physically separated)
- adding a second LLM/ASR/TTS provider (Qwen-VL primary, per ADR-0011,
  still the only cascade)

## Consequences

**Binding steering that changes with this ADR** (companion edits in this PR):

- `.kiro/steering/architecture.md` § Module map, § Realtime ↔ persistence
  boundary, § Globally forbidden — replace Python Supervisor pinning with
  Mastra Agent, keep "no LangGraph" (still true, and now general to any
  parallel controller framework), replace "second LLM provider requires
  ADR" wording (unchanged rule, keep it).
- `.kiro/steering/errors-and-observability.md` § Provider adapter rules —
  `apps/web/lib/assistant/providers/<vendor>.ts` and
  `apps/agent-voice-worker/src/mastra/providers/<vendor>.ts` are the two
  adapter surfaces; Python paths removed.
- `.kiro/steering/testing.md` § Four layers — Python row deleted; property
  tests move to `vitest + fast-check` under
  `apps/agent-voice-worker/tests/properties/` and root
  `tests/properties/ai-interview-engine/`.
- `AGENTS.md` § Two LLM Chains — the "两个可以互相替代的 worker 实现" table
  collapses to one implementation; the Python column is removed; the
  Instruction 字段链 flow is updated to end at the TS worker's orchestrator.
- `README.md` § Architecture and § Structure — Python row removed;
  `pnpm test:py` removed; `apps/agent-voice-worker` becomes the primary
  interview worker; Morris description points to Mastra Agent.

**Non-steering artifact deletions** (this PR):

- `apps/agent/` — deleted (Python LiveKit worker).
- `apps/agent/agent/contracts.py` — deleted (Python contract mirror).
- `packages/observability-py/` — deleted (Python logger/retry mirror).
- `scripts/test-py.sh` — deleted.
- `pnpm test:py` script in root `package.json` — removed.
- `.github/workflows/ci.yml` — Python job removed.
- `apps/agent/AGENTS.md`, `apps/agent/README.md`, `apps/agent/pyproject.toml`,
  `apps/agent/uv.lock` — deleted with `apps/agent`.
- Any doc / spec grep hit for `apps/agent/` becomes a fix-up in this PR
  (`docs/design/multimodal-interview-and-structured-rendering.md`,
  `.kiro/specs/ai-interview-engine/*`, `.kiro/specs/interviewee-portal/*`,
  `.kiro/specs/foundation-setup/*`, `docs/review/*`, `docs/adr/*`).

**New artifacts** (this PR or immediately following, before merge):

- `apps/agent-voice-worker/src/interview/` — new subtree hosting the ported
  orchestrator + section-task-group + question-task-manager + probe gate
  helpers. Keep files small (per `architecture.md` file splitting rule),
  each ≤ ~250 lines.
- `apps/agent-voice-worker/src/persistence/` — Appwrite finalize client
  (invokes `finalizeInterviewSession` Function; NO direct SDK writes from
  the worker process except through the Function boundary, mirroring
  `apps/agent/agent/persistence/appwrite_repository.py` responsibility split
  where the worker only assembles finalized artifacts).
- `apps/agent-voice-worker/src/health.ts` — health + drain server.
- `apps/functions/finalizeInterviewSession/` — new Function following the
  `issueLivekitToken` shape: pure `handler.ts` + SDK `main.ts`, invoked once
  per session lifecycle terminal state.
- `apps/agent-voice-worker/tests/properties/*.test.ts` — porting the six
  Python property tests currently under
  `apps/agent/tests/properties/*.py` (state machine transitions, probe
  gate, first-writer-wins, section order, secret leakage, session
  transitions).

**Rollback path.** Recorded in
`docs/dev/git-backup-and-restore.md`: the `2026-07-11` snapshot branch
contains the pre-migration Python worker as a complete tree. If Mastra
runtime shows an unforeseen production defect, the rollback is a git
revert of this PR + `git checkout <snapshot>` for `apps/agent/`. The rollback
does not require re-adding steering fragments — the Mastra ADR is superseded
in place, not replaced.

**What this ADR does not resolve** (tracked as follow-up work, not a blocker
to merge):

- Session recording via `ParticipantEgress` requires the LiveKit egress
  server to be reachable from Node the same way it was from Python. Both use
  the same LiveKit REST API, so the port is a straight rewrite — but the
  egress track selection code is ~300 lines in
  `apps/agent/agent/interview/egress_recorder.py`. Ported in the same wave
  but flagged as the most likely place for parity bugs.
- The `test-link bypass for draft surveys` code path in `issueLivekitToken`
  is unaffected (it is on the Function side, not the worker side).
- The `analyzeSessionVisual` Function (ADR-0005) is unaffected. It reads
  finalized artifacts, not live worker state.

## References

- ADR-0001 (superseded): `docs/adr/0001-livekit-supervisor-interview-workflow.md`
- ADR-0002 (superseded): `docs/adr/0002-page-assistant-vercel-ai-sdk.md`
- ADR-0009 (still governing HITL + pruneMessages): `docs/adr/0009-aisdk-native-hitl-and-prune-messages.md`
- ADR-0011 (still governing LLM cascade): `docs/adr/0011-qwen-vl-cascade-llm.md`
- Mastra LiveKit quickstart: https://mastra.ai/docs/voice/livekit
- Mastra Agent + AI SDK 6 compatibility: https://mastra.ai/docs/agents/overview
- `@mastra/livekit` worker source: https://github.com/mastra-ai/mastra/tree/main/packages/livekit
- LiveKit Agents Tool loop design (probe gate rationale, preserved):
  https://docs.livekit.io/agents/logic/tools/design/
- Pre-migration snapshot: `docs/dev/git-backup-and-restore.md`

# apps/agent

Per-module supplement for the Python LiveKit Agent Worker. Read root `AGENTS.md`, `.kiro/steering/architecture.md` (Agent realtime↔persistence boundary), `.kiro/steering/contracts.md` (TS↔Python mirror), and `.kiro/steering/errors-and-observability.md` (Python mirror of logger/retry) first. This file holds ONLY rules specific to this app.

## Reference architecture

ADR-0001 fixes the realtime controller as **LiveKit Supervisor + ordered TaskGroups + focused AgentTasks**. No LangGraph, no custom state machine, no second controller framework. The reference is `agent/interview/{workflow,supervisor,engine,tasks/}.py`.

## File map

| Path | Owns |
|---|---|
| `agent/main.py` | Worker entrypoint. Wires environment, builds repository + logger + workflow state, hands off to the Supervisor. |
| `agent/contracts.py` | Pydantic mirror of the TS contracts the agent uses. Field names byte-identical to TS. |
| `agent/logging.py` | `create_logger(scope)`. JSON logs with `traceId`. Mirrors `@merism/observability` logger shape. |
| `agent/retry.py` | `with_retry`, `TransientProviderError`, `PermanentProviderError`. Mirrors `@merism/observability` retry. |
| `agent/interview/workflow.py` | **Pure** workflow state transitions. No livekit / appwrite imports. Side-effect free. The single source of correctness for advancement / completion / collected-answers projection. |
| `agent/interview/supervisor.py` | `InterviewSupervisorAgent` — the long-lived agent that runs sections as TaskGroups, records results, publishes `InterviewAgentState` on participant attributes, persists finalized artifacts. Lazy-imports `livekit.agents`. |
| `agent/interview/engine.py` | Wires Supervisor into the LiveKit room lifecycle. Side-effect host. |
| `agent/interview/task_group_builder.py` | Builds a section TaskGroup from `SectionTaskGroupConfig` with one AgentTask per question. |
| `agent/interview/tasks/` | Reusable AgentTasks (question, probe, etc.). |
| `agent/interview/transcript.py` | In-memory transcript buffer until finalize. |
| `agent/interview/runtime_bridge.py` | Resolves `InterviewWorkflowConfig` from room metadata via `workflow_config_from_metadata`. |
| `agent/interview/egress_recorder.py` | Recording finalization (LiveKit egress). |
| `agent/persistence/appwrite_repository.py` | `InterviewRepository` Protocol-injected client; `from_env` builds the real Appwrite SDK client via lazy import. |
| `agent/persistence/serializers.py` | Pure document shapers (transcript_document, recording_document, session_*_fields). |
| `agent/providers/qwen.py` | Qwen ASR/TTS adapter. |
| `agent/providers/settings.py` | Provider env wiring. |
| `tests/` | pytest + hypothesis. `tests/properties/` for property tests. `test_workflow.py` covers the pure workflow exhaustively. |

## Module-specific rules (binding)

### Realtime extra is opt-in
- `livekit-agents` is an opt-in extra installed via `uv sync --extra realtime`. The base install (used by `pnpm test:py` in CI) MUST work without it.
- ANY file that imports from `livekit.agents`, `livekit.rtc`, or other realtime-only packages MUST keep that import lazy. Pattern: import inside a function body, or inside `if TYPE_CHECKING:` for type hints. See `agent/interview/supervisor.py` `create_supervisor_agent_class()` for the canonical pattern.
- A top-level `from livekit.agents import ...` in `agent/interview/*.py` is a defect — it breaks `pnpm test:py` in environments without the extra.

### Pure workflow vs side effects (binding)
- `agent/interview/workflow.py` is **pure**. It MUST NOT import `livekit.*`, `appwrite.*`, `os`, or anything with I/O. It only manipulates `InterviewWorkflowState` / `SectionTaskGroupConfig` / `QuestionTaskResult` instances.
- All correctness-bearing transitions (advance question, record result, completion check, collected-answers projection) live here.
- `supervisor.py` and `engine.py` are the side-effect hosts. They DELEGATE every transition to `workflow.py` — they MUST NOT mutate state directly.
- Adding a new state transition: write the pure function in `workflow.py` first with a property test in `tests/test_workflow.py`, then call it from `supervisor.py`.

### Per-session isolation (binding)
- The agent worker handles multiple concurrent sessions. Per-session state lives on the agent INSTANCE (e.g. `self._state`, `self._transcript`). NEVER on a module-level variable, NEVER on a class attribute shared across instances.
- `InterviewRepository` is the only persistence path. Tests inject a fake conforming to the `DatabasesClient` / `StorageClient` / `FunctionsClient` Protocols.

### Realtime ↔ persistence boundary (binding)
Stays in the LiveKit room (room metadata + participant attributes + RPC):
- Turn-by-turn conversation state, partial transcript, audio buffers, ephemeral variables, current section/question cursor.

Crosses into Appwrite (one-way, append-only):
- Finalized transcript (after `is_complete(state)` or on failure).
- Final recording file.
- `collected_answers_map(state)` payload (via `complete_session`).
- Triggers post-session analysis via `Functions.create_execution(analyzeSession, ...)`.

NEVER:
- Round-trip "next question" through Appwrite.
- Persist partial / streaming transcript per turn.
- Direct Appwrite writes from `supervisor.py` for in-progress state — go through `InterviewRepository`.

### Contracts mirror discipline (binding)
- `agent/contracts.py` mirrors `packages/contracts` with byte-identical field names (camelCase, NOT snake_case). See `apps/agent/tests/test_contracts.py` for round-trip tests.
- Adding a field that the agent uses: mirror it the same PR, add round-trip test.
- Adding a field the agent does not use yet: skip mirror, leave a `# NOTE: mirror when agent needs it` comment.

### Provider adapter rules
- Qwen-VL is the primary cascade LLM (per ADR-0011). Qwen is reserved for ASR/TTS. Adding another requires a new ADR.
- Adapters classify failures into `TransientProviderError` (retried by `with_retry`) and `PermanentProviderError` (never retried).
- Adapters MUST NOT log raw prompts / completions / audio at info. Debug only, gated by `MERISM_DEBUG_PROVIDERS=1`.

## Cross-module change triggers

| If you change | You MUST also update |
|---|---|
| A schema in `agent/contracts.py` | The TS source in `packages/contracts/src/{entities,api,state}.ts` first; tests in `apps/agent/tests/test_contracts.py` |
| `InterviewWorkflowState` / `InterviewWorkflowConfig` shape | `packages/contracts/src/state.ts`, the room-metadata builder in `packages/contracts/src/api.ts`, AND `apps/functions/issueLivekitToken/src/deps.ts` `createRoom` metadata building |
| Workflow transition logic | Property test in `apps/agent/tests/test_workflow.py` AND the supervisor call sites |
| Persistence document shape | `agent/persistence/serializers.py` AND the corresponding Appwrite collection in `packages/appwrite-schema/src/schema.ts` AND tests in `apps/agent/tests/test_*_persistence.py` |
| Provider adapter signature | Every call site in `agent/interview/*` AND its `with_retry` wrapping |
| `INTERVIEW_STATE_ATTRIBUTE` participant attribute schema | `packages/contracts/src/state.ts` (for `InterviewAgentState`) AND `apps/web/lib/use-live-interview.ts` consumer |

## Anti-patterns specific to this app

- `from livekit.agents import Agent` at the top of any file under `agent/interview/`. Use lazy import inside a builder function.
- Snake_case field names in `agent/contracts.py` (TS contracts are camelCase; mirror exactly).
- Calling `self._db.create_document(...)` directly from `supervisor.py` instead of going through `InterviewRepository`.
- Mutating `InterviewWorkflowState` from `supervisor.py` — call `workflow.advance_to(...)` / `workflow.record_question_result(...)`.
- Catching `Exception` to swallow it. Use `# noqa: BLE001` only when the catch is a documented best-effort cleanup with an explanatory comment (see `supervisor.py` for examples).
- Real provider keys in tests. Use `MERISM_FAKE_PROVIDERS=1` deterministic fakes.
- `print(...)` for debug output. Use `self._log.info / warn / error` with structured fields.

## Enforcement (per-module)

```bash
# From repo root:
pnpm test:py

# Or directly:
cd apps/agent && uv run pytest

# Property tests only:
cd apps/agent && uv run pytest tests/properties/

# With realtime extra (for live tests):
cd apps/agent && uv sync --extra realtime
cd apps/agent && uv run python -m agent.main dev   # local worker

# Confirm no top-level livekit imports under agent/interview:
grep -RIn '^from livekit\|^import livekit' apps/agent/agent/interview/ && echo "VIOLATION"
```

A change to `agent/interview/workflow.py` without same-PR property tests is not ready to merge.

## Known foot-guns

Concrete pitfalls observed in this codebase. Add a new entry here every time a non-trivial bug is fixed in this module — this is how the file stays useful.

### Top-level `from livekit.agents import Agent` breaks `pnpm test:py`

`livekit-agents` is an opt-in extra. CI runs `uv sync` (no `--extra realtime`). Any `agent/interview/*.py` file that imports `livekit.agents` at module top level fails to load in CI before any test runs — and pytest reports it as a collection error, not a missing-extra hint, so the symptom is "all tests fail with `ModuleNotFoundError`" rather than a clear signal.

**Symptom**: `pnpm test:py` exits with `ModuleNotFoundError: No module named 'livekit.agents'` during collection.

**Fix**: Move the import inside the function/class that needs it. The canonical pattern is `agent/interview/supervisor.py`'s `create_supervisor_agent_class()` — the `Agent` import lives inside the factory, the factory is only called by the engine when the worker actually starts.

### Appwrite Python SDK document return type is unstable across versions

`appwrite_repository.py`'s `resolve_owner_user_id` does `getattr(survey, "ownerUserId", None) or (survey.get("ownerUserId") if isinstance(survey, Mapping) else None)`. This double-access is intentional, not paranoia: depending on Appwrite SDK version the returned `Document` is either an attribute-bearing object or a `Mapping`. A `survey["ownerUserId"]` access works in one and `KeyError`s in the other.

**Fix when adding a new repository method**: copy the same `getattr → .get` fallback. If you find yourself writing this twice, lift it into `agent/persistence/serializers.py` as `_doc_field(doc, name)`.

### TaskGroup result key naming has shifted across LiveKit Agents betas

`supervisor.py`'s `_run_task_group` reads results defensively:

```python
for attr in ("results", "task_results", "output"):
    candidate = getattr(run_result, attr, None) if run_result is not None else None
    if isinstance(candidate, dict):
        return candidate
```

This is because the LiveKit Agents beta has shipped at least three different attribute names. When upgrading the realtime extra, run the live integration tests against the local stack (`MERISM_LIVE_TESTS=1` + `pnpm stack:up`) before merging — unit tests with fakes will not catch the rename.

### Forgetting the Python contracts mirror after a TS-side rename

A field rename on the TS side (`packages/contracts/src/state.ts`) without a same-PR update to `apps/agent/agent/contracts.py` produces a runtime pydantic validation failure inside the agent — but ONLY when an interview actually runs (room metadata parses), not during `pnpm test:py`. The mirror's `test_contracts.py` tests round-trip but assumes the field name is correct.

**Detection during review**: any `packages/contracts/src/*.ts` change touching a schema must show a sibling `apps/agent/agent/contracts.py` change in the same PR. If the PR description does not call this out and the file is missing, request changes.

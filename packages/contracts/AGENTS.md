# packages/contracts

Per-module supplement to root `AGENTS.md` and `.kiro/steering/contracts.md`. Read those first. This file holds ONLY rules specific to this package that do not generalize.

## File map

| File | Owns |
|---|---|
| `src/entities.ts` | Database / domain entities (`Survey`, `Project`, `InterviewLink`, `InterviewSession`, `Recording`, `AnalysisReport`, dashboards, ...). Includes `SURVEY_STATUS_TRANSITIONS` and `canTransitionSurveyStatus`. |
| `src/api.ts` | Request / response schemas + RPC payloads (`IssueLivekitTokenRequest/Response`, `AnalyzeSession*`, room-metadata builders). |
| `src/state.ts` | Runtime workflow state shared with the agent (`InterviewWorkflowState` and friends). |
| `src/notebook.ts` | Notebook + ad-hoc question shapes — kept separate per ADR-0003 D2. |
| `src/index.ts` | Public re-exports. Every new schema MUST be re-exported here. |
| `test/contracts.test.ts` | Round-trip + invariant tests. Split when it exceeds ~600 lines. |

## Module-specific rules (binding)

- This package MUST stay free of runtime side effects. No `fetch`, no `process.env`, no `node:` imports, no Appwrite/LiveKit SDK imports.
- `import { z } from "zod"` is the only non-trivial dependency allowed.
- Pure helper functions (e.g. `canTransitionSurveyStatus`, `buildInterviewRoomMetadataFromDraft`) MAY live alongside their schemas, but MUST stay pure (no I/O, no `Date.now()` outside the helper's input).
- New `*Schema` MUST come with: (a) inferred `type Foo = z.infer<typeof FooSchema>`, (b) JSDoc when the schema encodes a non-obvious invariant or owner, (c) export from `src/index.ts`, (d) at least one positive + one negative test in `test/`.
- Cross-field invariants belong in `superRefine`, not in callers (see steering `contracts.md` "Invariants belong in the schema").

## Cross-module change triggers

Touching this package implies the following same-PR changes:

| If you change | You MUST also update |
|---|---|
| Any schema the agent uses | `apps/agent/agent/contracts.py` (mirror with identical field names) and `apps/agent/tests/test_contracts.py` |
| A request/response schema for a Function | The corresponding `apps/functions/<name>/src/handler.ts` parsing call and tests |
| `SURVEY_STATUS_TRANSITIONS` or any state-machine schema | `tests/properties/` state-machine property tests |
| A field used by `apps/web` server actions / loaders | The relevant `apps/web/lib/**` consumers (LSP `find_references`, not grep) |
| The shape of `InterviewRoomMetadata` or `InterviewWorkflowState` | `apps/agent/agent/interview/workflow.py`, `engine.py`, `supervisor.py` and their tests |

## Anti-patterns specific to this module

- Defining a domain shape in TS only (no zod schema) — even a "small" type. If it crosses a module boundary, it belongs as a schema here.
- Adding a JSON bucket (`z.record(z.string(), z.unknown())`) without a JSDoc comment naming the owner and the sub-spec scheduled to type it.
- Importing something from `@merism/observability` here (this package is a dependency of observability consumers, not the other way around).
- Mutating a default value via `.default({})` then sharing the object — defaults are factories, not singletons.

## Enforcement (per-module)

```bash
pnpm -F @merism/contracts typecheck
pnpm -F @merism/contracts test
# When you change a schema mirrored to Python:
pnpm test:py
```

A change to this package that does not pass all three is not ready to merge.

## Known foot-guns

Concrete pitfalls observed in this codebase. Add a new entry here every time a non-trivial bug is fixed in this module.

### JSON buckets without an owner JSDoc become the next `Survey.questions` blob

`Survey.flowConfig`, `QuestionBlock.config`, `QuestionBlock.probingPolicy`, `QuestionBlock.skipLogic`, `InterviewSession.collectedAnswers`, `Dashboard*.config`, `AnalysisReport.themes/insights/citations` are all `z.record(z.string(), z.unknown())`. Each is a documented exit, not a license.

**Rule**: when you add or touch a JSON bucket, the JSDoc comment immediately above the field MUST name (a) the OWNER of the inner shape (which sub-spec controls what goes inside) and (b) the planned ticket/sub-spec to type it. Without that comment, the bucket drifts into a parallel `Survey.questions` blob — undocumented, untyped, and impossible to refactor.

**Detection**: `grep -B 5 'json.default' packages/contracts/src/entities.ts` should show a JSDoc on every match. Bucket without docs = defect.

### Forgetting to mirror to `apps/agent/agent/contracts.py`

A new field added to a schema the agent uses (`InterviewWorkflowState`, `SectionTaskGroupConfig`, `QuestionTaskResult`, etc.) without updating the Python mirror produces a pydantic validation failure ONLY when the agent receives a real room metadata payload — `pnpm test:py` round-trip tests pass because they use the Python-side fixtures.

**Detection during review**: any change to `packages/contracts/src/state.ts` or schemas the agent consumes (see `agent/contracts.py` for the current mirror set) MUST show a sibling change to `apps/agent/agent/contracts.py`. If missing, request changes.

### Putting an invariant in a consumer instead of `superRefine`

When a cross-field rule (e.g. "if `scope=session` then `sessionId` is required") is checked by every caller separately ("the Function's handler validates it, the agent re-validates it, the UI re-validates it"), the rule will eventually drift — one consumer adds a new code path that forgets to check.

**Rule**: cross-field invariants belong on the schema via `superRefine`. Callers do `Schema.safeParse(input)` and react to `success: false` with the issue path. Two canonical examples already in the codebase: `AnalysisReportSchema` (scope/sessionId/surveyId) and `SessionQualityFlagSchema` (mutex pairs).

### `z.string().datetime()` is strict — `new Date().toString()` does NOT parse

`z.string().datetime()` requires ISO 8601 with `Z` suffix (`2025-11-12T05:42:00.000Z`). `new Date().toString()` produces `"Wed Nov 12 2025 05:42:00 GMT+0000 (UTC)"` and fails parsing with a confusing `Invalid datetime` error path.

**Rule**: use `new Date().toISOString()` for every persisted timestamp. The Python side already does the same via the helper in `agent/persistence/serializers.py`. Tests that fail with `"Invalid datetime"` are almost always this — check the producer first.

### Renaming a field without `@deprecated` first breaks every downstream typecheck simultaneously

A direct rename (e.g. `userId` → `ownerUserId`) updates the schema but every TS file referencing the old name fails to typecheck on the same PR — turning a one-module change into a whole-workspace audit. Then the Python mirror, the Functions, the web actions, and the agent all need same-PR updates.

**Pattern**: add the new field, mark the old one `@deprecated`, migrate consumers PR by PR, then remove the deprecated field in a final cleanup PR. See `UserSchema` for a worked example. This trades one big PR for three small ones — the small ones merge faster and rebase cleaner.

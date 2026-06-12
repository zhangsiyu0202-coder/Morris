---
inclusion: always
---

# Contracts (binding)

`packages/contracts` (zod) is the single source of truth for every cross-module shape. Python mirrors a strict subset in `apps/agent/agent/contracts.py`. This file defines the schema-first workflow, the TS↔Python mirror discipline, the invariant placement rules, and the deprecation pattern. Read together with `architecture.md` Cross-module change order.

## Source-of-truth rule (binding)

- Every entity, API request/response, RPC payload, room metadata shape, and runtime workflow state MUST be defined in `packages/contracts/src/{entities,api,state,notebook}.ts` as a zod schema named `*Schema` plus its inferred `type Foo = z.infer<typeof FooSchema>`.
- A cross-module shape MUST NOT be defined twice in the codebase. UI-local prop shapes inside `apps/web/components/<feature>/` are exempt only when they do not cross any module or persistence boundary.
- Detection:

```bash
# domain entity types defined outside contracts (excluding UI Props)
grep -RIn '^export interface\|^export type' apps/web/lib apps/web/components apps/web/app apps/functions \
  | grep -v 'Props\b' | grep -v 'Type\b' | grep -v 'type [A-Z][A-Za-z]*Action ='
```

If a hit looks like a domain shape, lift it into `packages/contracts`.

## Naming and primitive choices (binding)

- camelCase field names, including in Python mirror (Python keeps camelCase; do NOT snake_case).
- Appwrite document id is `$id: z.string()` and is passed through unchanged.
- Owner of an owner-scoped collection is `ownerUserId: z.string()` (the Appwrite Account `$id`). Never `userId`, `owner`, `createdBy`, etc.
- Timestamps use `z.string().datetime()` (ISO 8601 with `Z` suffix). Persisted helper: `new Date().toISOString()`.
- Loose JSON buckets use `z.record(z.string(), z.unknown())` aliased to `json` at the top of `entities.ts`. Use sparingly — see "JSON-shaped fields are temporary".
- Enums use `z.enum([...])`. Always export both the schema and the inferred TS type so consumers can use either.
- Numeric ids/counters use `z.number().int().nonnegative()` (or `.positive()` when zero is invalid).

## Invariants belong in the schema (binding)

Cross-field invariants MUST be enforced via `superRefine` on the schema itself, not in calling code.

Canonical examples (already in the codebase):

- `AnalysisReportSchema` enforces scope/sessionId/surveyId mutual requirements (`scope=session` requires `sessionId`; `scope=survey` requires `surveyId` and forbids `sessionId`).
- `SessionQualityFlagSchema` enforces mutex pairs (`silent` vs `fluent`, `too-short` vs `deep-engagement`, etc.).

Rules:

- A new business invariant lands in the same PR as: (a) the field change that introduced it, (b) a `superRefine` clause, (c) a property test in `packages/contracts/test/contracts.test.ts` (or a sibling file once that one is split — see "File splitting" below).
- Validation logic MUST NOT live in the calling Function, the agent, or the UI. Calling code only does `Schema.safeParse(input)` and reacts to `success: false`.
- If an invariant cannot be expressed in zod (e.g. requires DB lookup), define a typed predicate in `packages/contracts` (pure function, no I/O) and have callers invoke it explicitly.

## TS → Python mirror discipline (binding)

`apps/agent/agent/contracts.py` contains pydantic models that mirror **only** the contracts the agent actually uses.

- Field names MUST be byte-identical to the TS definition. No `snake_case` conversion.
- The mirror is added in the SAME PR as the TS schema, not a follow-up.
- The mirror is allowed to be a strict subset (omitting fields the agent does not need), but every mirrored field MUST exist in TS.
- Enum values are mirrored as `Literal[...]` types or `Enum` classes with identical string values.
- Verification:

```bash
pnpm -F @merism/contracts typecheck
pnpm test:py   # contract round-trip tests in apps/agent/tests/test_contracts.py
```

Adding a new field that the agent does NOT need yet:
- Skip the Python mirror.
- Leave a comment in `contracts.py` near the related model: `# NOTE: TS schema FooSchema also has bar; mirror when agent needs it.`

Adding a new field that the agent DOES need:
- Mirror immediately. Do not split across PRs.

## JSON-shaped fields are temporary (binding)

Today the codebase has a small set of `z.record(z.string(), z.unknown())` (alias `json`) buckets — `Survey.flowConfig`, `QuestionBlock.config`, `QuestionBlock.probingPolicy`, `QuestionBlock.skipLogic`, `InterviewSession.collectedAnswers`, `InterviewSession.errorContext`, `Dashboard*.config`, `AnalysisReport.themes/insights/citations`.

Rules:
- These are documented exits, not a license. New JSON buckets require an ADR or are rejected.
- Each bucket MUST have a JSDoc comment naming the OWNER of the shape and the issue/sub-spec scheduled to type it.
- When a sub-spec touches one of these buckets, the sub-spec is responsible for converting the bucket to a typed `*Schema` in `entities.ts` (or a sibling `flow.ts` / `policy.ts` when the type is large).
- Until conversion: callers parse the bucket inline at the boundary with a *local* zod schema and never propagate `unknown` further. See `apps/functions/issueLivekitToken/src/deps.ts` `parseJson<T>(...)` pattern.

## Deprecation pattern (binding)

Removing a schema or field that has shipped MUST follow this pattern (see `UserSchema` for a worked example):

1. Add `@deprecated` JSDoc explaining: why deprecated, what replaces it, where the migration is recorded (sub-spec / ADR).
2. Keep the schema/field exported and parsed for at least one sub-spec cycle so consumers can migrate incrementally.
3. Remove only after no callers remain (`pnpm -F @merism/contracts typecheck` + `pnpm typecheck` clean).
4. Update `apps/agent/agent/contracts.py` mirror in the same PR as removal.

NEVER:
- Delete a shipped schema in the same PR that introduces its replacement.
- Reuse a deprecated name for a different shape (rename instead).

## File splitting (binding)

`packages/contracts/src/` files are organized by purpose, not size. Current layout:

- `entities.ts` — database / domain entities (Survey, Project, InterviewLink, InterviewSession, Recording, AnalysisReport, ...)
- `api.ts` — request/response and RPC payloads (IssueLivekitTokenRequest/Response, AnalyzeSession*, room-metadata builders)
- `state.ts` — runtime workflow state shared with the agent (`InterviewWorkflowState` and friends)
- `notebook.ts` — researcher Notebook + ad-hoc question shapes (kept separate per ADR-0003 D2)

When `entities.ts` exceeds ~600 lines, split by sub-domain (e.g. `dashboard.ts`, `analysis.ts`) — do not let a single file own all entities forever.

When `packages/contracts/test/contracts.test.ts` exceeds ~600 lines, split into `entities.test.ts` / `api.test.ts` / `state.test.ts` / `notebook.test.ts`.

## Enforcement commands

```bash
# typecheck contracts package only
pnpm -F @merism/contracts typecheck
# run contract tests (round-trip + invariant)
pnpm -F @merism/contracts test
# verify Python mirror parses the same payloads
pnpm test:py
# diff between schema declaration and live Appwrite stack
pnpm schema:verify
```

A contract change that does not pass all four cleanly is not ready to merge.

# Tasks: `ai-eval-suite`

> **Parent**: `.kiro/specs/ai-eval-suite/{requirements,design}.md`
> **Estimated effort**: 3-5 days. Lands as 3 sub-PRs per design.md § Phased rollout.

## Sub-PR 1 — harness scaffolding + 1 surface (~600 LOC)

> Self-contained: ships a working eval harness on `morris.tool.createStudyDraft`.
> After merge, `MERISM_EVAL_TESTS=1 pnpm test:evals` runs end-to-end on 1 surface;
> default `pnpm test:evals` (no env flag) prints "evals skipped" and exits 0.

### Phase A — directory layout + types

- **A.1** Create directory tree:
  ```
  tests/evals/
  ├── corpus/
  │   ├── tags.yaml
  │   └── morris/
  ├── surfaces/
  │   ├── OWNERS.md
  │   └── _types.ts
  ├── scorers/
  │   └── _types.ts
  ├── harness/
  │   └── __tests__/
  └── README.md
  ```

- **A.2** `tests/evals/surfaces/_types.ts` — `SurfaceAdapter<Input, Output>` interface
  + `ScenarioRow` shape (matches the `.jsonl` row).

- **A.3** `tests/evals/scorers/_types.ts` — `Scorer<Input, Output, Expected>` interface
  + `ScoringResult` union + `TokenUsage` type.

- **A.4** `tests/evals/corpus/tags.yaml` — controlled vocabulary (initial 5 tags from
  design.md § Q2).

- **A.5** `tests/evals/surfaces/OWNERS.md` — placeholder mapping; for sub-PR 1, single
  surface `createStudyDraft` owned by `@morris`.

**Acceptance**: types compile; nothing imports them yet.

### Phase B — surface adapter for `createStudyDraft`

- **B.1** `tests/evals/surfaces/createStudyDraft.ts`:
  - Import the actual `buildCreateStudyDraftTool` factory.
  - Construct a minimal `AssistantToolContext` (test-only fixture per
    `testing.md` § Test double pattern).
  - Export `createStudyDraftSurface: SurfaceAdapter<CreateStudyDraftInput, ToolResultEnvelope<SurveyDraftArtifact>>`
    with `invoke()` that calls `tool.execute(input)`.

- **B.2** Verify the adapter compiles + the contracts are wired (Morris tool ctx
  needs `ownerUserId` / `workspace` / etc.; use `getCurrentWorkspaceAccessContext`
  shape with a deterministic fake context for tests).

**Acceptance**: `createStudyDraftSurface.invoke({...})` returns a parseable
result when called from a TS test. Tests for the surface adapter live in
`tests/evals/harness/__tests__/createStudyDraft-surface.test.ts` using a
DeepSeek mock from `vi.mock`.

### Phase C — deterministic scorer

- **C.1** `tests/evals/scorers/jsonShapeMatch.ts` — implements three checks:
  - `must_match_schema`: zod schema name → parse output → pass/fail
  - `must_contain_keywords`: free-text contains all listed strings
  - `must_not_mention_keywords`: free-text contains NONE of the listed strings

  Combines into a single `ScoringResult`. The "schema name" is resolved via
  a small registry (`schemaRegistry: Record<string, ZodSchema>`) so the
  corpus row stays JSON-friendly (no embedded code).

- **C.2** Unit test in `tests/evals/scorers/__tests__/jsonShapeMatch.test.ts`
  covering: pass-when-all-match, fail-on-schema-mismatch, fail-on-missing-keyword,
  fail-on-forbidden-keyword.

**Acceptance**: scorer unit tests pass via `pnpm test tests/evals/scorers/`.

### Phase D — runner + env gate + report

- **D.1** `tests/evals/harness/runner.ts`:
  - `runEvals(surfaces, scorers, opts)` walks `tests/evals/corpus/**/*.jsonl`,
    matches each `.jsonl` to a surface, invokes scorer, accumulates results.
  - Env gate: if `MERISM_EVAL_TESTS !== "1"`, log "evals skipped" and return early.
  - Cost guard: track `tokens_so_far`; abort when > `EVAL_MAX_TOKENS_PER_RUN`
    (default 500_000).

- **D.2** `tests/evals/harness/report.ts`:
  - Write JSON report to `tests/evals/reports/<iso-date>.json` (gitignored).
  - Print human-readable summary to stdout (% pass per surface; cost total).

- **D.3** `tests/evals/harness/__tests__/runner.test.ts`:
  - Fake surface (returns deterministic output regardless of input).
  - Fake corpus (in-memory 3 rows).
  - Assert: env gate works (no execution when flag absent), cost ceiling
    aborts mid-run, report shape matches schema.

- **D.4** Add `pnpm test:evals` script to root `package.json`:
  ```json
  "test:evals": "tsx tests/evals/harness/runner.ts"
  ```

  (Use `tsx` since this is a script, not a vitest run; the harness has
  its own report-writing logic that vitest output format doesn't fit.)

- **D.5** Gitignore `tests/evals/reports/` (the run output, not the corpus).

**Acceptance**: `MERISM_EVAL_TESTS=1 pnpm test:evals` runs end-to-end on
`createStudyDraft` corpus, produces a report; `pnpm test:evals` (no flag)
prints "evals skipped" and exits 0; `pnpm test tests/evals/` unit-tests all
pass.

### Phase E — initial corpus (3 scenarios for `createStudyDraft`)

- **E.1** `tests/evals/corpus/morris/createStudyDraft.jsonl` — 3 rows:
  - `create-study-draft-basic-happy` (tag: happy-path)
  - `create-study-draft-out-of-scope` (tag: out-of-scope — researcher asks
    Morris to "draft a survey about which team should win", model should
    refuse politely)
  - `create-study-draft-boundary-empty-goal` (tag: boundary — empty research goal)

- **E.2** `tests/evals/corpus/morris/createStudyDraft.expected.json`:
  per design.md § Q2, snapshot the current `main` output for each scenario.
  This is the regression baseline.

**Acceptance**: corpus rows parse against `ScenarioRowSchema` (defined in
A.2/A.3); `MERISM_EVAL_TESTS=1 pnpm test:evals` produces a report showing
3/3 scenarios scored.

### Phase F — documentation

- **F.1** `tests/evals/README.md` — top-level harness doc:
  - what evals are for + relationship to property tests (per design.md § Q5)
  - how to run locally (`MERISM_EVAL_TESTS=1 pnpm test:evals`)
  - how to add a scenario (link to design.md § Q2 governance)
  - how to add a surface (link to design.md § Architecture + OWNERS.md)
  - how to add a scorer

- **F.2** Update `.kiro/steering/testing.md` § Four layers: add the eval
  layer as a 5th layer (gated, runs nightly, communicates via report).

- **F.3** Update `AGENTS.md` § Engineering skill lifecycle: add row to
  "Always invoke" table:
  ```
  | `tests/evals/**` | `test-driven-development` + corpus-governance |
  ```
  And update Automation hierarchy CI list to include `pnpm test:evals`
  as the new gated check (different from `pnpm semgrep` because it's
  not pre-merge-gating, but document its existence).

- **F.4** Update `README.md` sub-spec roadmap: mark `ai-eval-suite` as
  🚧 sub-PR 1/3 shipped.

**Acceptance**: docs cross-reference resolve; new contributors can find
the eval harness via README → sub-spec → testing.md.

## Sub-PR 2 — remaining 4 surfaces (~500 LOC)

> Adds `manageMemories`, `analyzeData`, `analyzeSession.text-pass`,
> `analyzeSurvey.combine` surfaces. 5 scenarios per surface.

### Per-surface tasks (×4)

For each surface in {`manageMemories`, `analyzeData`, `analyzeSession.text-pass`,
`analyzeSurvey.combine`}:

- Build the surface adapter in `tests/evals/surfaces/<surface>.ts`.
- Add 5 scenarios in `tests/evals/corpus/<area>/<surface>.jsonl`.
- Add `expected.json` snapshots from current `main`.
- Add owner mapping in `OWNERS.md`.

**Tag distribution per surface** (minimum):
- 2× happy-path
- 1× out-of-scope (refusal scenarios)
- 1× boundary (edge case)
- 1× regression-* (real bug rediscovered or anticipated)

### Phase G — schema registry expansion

- **G.1** Extend `scorers/jsonShapeMatch.ts` schema registry to include:
  `MemoryActionResultSchema`, `AnalysisReportSchema` (session + survey),
  any other contract schemas the new surfaces produce.

**Acceptance**: `MERISM_EVAL_TESTS=1 pnpm test:evals` runs 5 surfaces ×
~5 scenarios each = ~25 scenarios; all scored; report shows per-surface
pass rate.

## Sub-PR 3 — CI integration + judge model + cost guard tightening (~300 LOC)

> Wires evals into CI as a nightly + PR-comment surface.

### Phase H — CI workflow

- **H.1** `.github/workflows/evals.yml`:
  - Schedule: `0 2 * * *`
  - Manual: `workflow_dispatch:`
  - Push filtered to relevant paths
  - `timeout-minutes: 30`
  - Real `DEEPSEEK_API_KEY` from `${{ secrets.DEEPSEEK_API_KEY }}`
  - Upload `evals-report.json` artifact (90-day retention)
  - Run `MERISM_EVAL_TESTS=1 pnpm test:evals`

- **H.2** PR-comment action: read the latest report, post a comment on
  any open PR summarizing delta vs previous run (added scenarios,
  flipped scenarios, % pass per surface).

**Acceptance**: workflow YAML validates; manual dispatch produces an
artifact; the artifact is downloadable from the GHA UI.

### Phase I — judge model

- **I.1** `tests/evals/scorers/judgeRubric.ts`:
  - Accepts `judge_rubric` text from corpus row + LLM output.
  - Calls DeepSeek via `withLLMCall` (uses `function.eval.judge` scope
    per `errors-and-observability.md` § LLM call observability).
  - Returns `{ pass: boolean, reason: string }`.
  - Per design.md § Q4: caller runs 3 samples; majority vote = result.

- **I.2** Multi-sample variance check in the runner.

- **I.3** Mark `judge-flake: true` on scenarios with disagreement.

- **I.4** Add unit tests with a fake LLM (deterministic returns) verifying
  majority vote logic.

**Acceptance**: corpus rows with `judge_rubric != null` are scored;
report shows variance per scenario; flaky scenarios are flagged.

### Phase J — cost guard tightening

- **J.1** `tests/evals/harness/cost-guard.ts`:
  - Token accounting per scenario (input + output, both from `LLMCallEvent`).
  - Aborts run when global ceiling reached.
  - Per-scenario cap: 20k tokens (per design.md § Q3); fails the scenario
    on overrun.

- **J.2** Report includes per-scenario and cumulative token use.

**Acceptance**: a deliberately-blown-up scenario (corpus row that says
"output 10 thousand words") is detected and fails with `cost-exceeded`
status; the rest of the corpus still runs.

### Phase K — close-out

- **K.1** Mark `ai-eval-suite` ✅ done in `README.md` sub-spec roadmap.
- **K.2** Add a one-line note in ADR-0012 under "Wave A outcomes" /
  "Wave B outcomes" section noting the harness ships.
- **K.3** File the dependent `prompt-versioning` sub-spec design.md if
  not already filed.

## Final verification (after each sub-PR)

After each sub-PR independently:

```bash
pnpm test                              # green (no eval scenarios run by default)
pnpm typecheck                         # green
pnpm test:py                           # green
pnpm scope-guard                       # OK
pnpm semgrep                           # 0 ERROR findings
MERISM_EVAL_TESTS=1 pnpm test:evals    # gated; runs scenarios; non-zero exit on scenario fail
```

## Commit plan

One commit per sub-PR:

```
sub-PR 1:  feat(evals): harness scaffolding + createStudyDraft surface
sub-PR 2:  feat(evals): manageMemories + analyzeData + analyze* surfaces
sub-PR 3:  feat(evals): nightly CI + judge model + cost guard
```

## Out-of-PR follow-ups

- **Eval dashboard** (web UI for reports): deferred until artifact JSON
  + CLI summary is no longer enough. Today: zero need.
- **Cross-team scenario contribution**: not a goal. Scenario PRs go
  through the surface owner per OWNERS.md.
- **Tooling around prompt regression** (e.g., delta-vs-version reports):
  belongs in `prompt-versioning` sub-spec.

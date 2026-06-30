# Eval harness

> Source spec: `.kiro/specs/ai-eval-suite/{requirements,design,tasks}.md`.
> Status: sub-PR 1/3 shipped (harness scaffolding + `createStudyDraft` surface).

LLM behavior regression harness. Catches prompt + model drift on production
LLM call sites that property tests can't cover (property tests prove
"deterministic invariants hold for all generated shapes"; evals prove "the
LLM produces useful output within those invariants").

## Layout

```
tests/evals/
├── corpus/                  ← committed corpus (durable artifact)
│   ├── tags.yaml            ← controlled vocabulary
│   └── morris/
│       └── createStudyDraft.jsonl
├── surfaces/                ← adapters wrapping production code paths
│   ├── OWNERS.md
│   └── createStudyDraft.ts
├── scorers/                 ← deterministic + judge-rubric scorers
│   ├── jsonShapeMatch.ts
│   └── schemaRegistry.ts
├── harness/                 ← runner, report writer, schemas
│   └── runner.ts
└── reports/                 ← gitignored run output
```

## Commands

```bash
# Default — gated; prints "evals skipped" and exits 0 if MERISM_EVAL_TESTS != "1".
pnpm test:evals

# Run for real — requires DEEPSEEK_API_KEY in env (real provider call).
MERISM_EVAL_TESTS=1 pnpm test:evals

# Unit-test the harness itself (no LLM, no env flag).
pnpm test tests/evals/
```

The strict-literal `MERISM_EVAL_TESTS=1` gate follows the convention in
`.kiro/steering/errors-and-observability.md` § Feature flags — any other
value (`"true"`, `"yes"`, empty, unset) leaves evals off.

## Relationship to other test layers

| Layer | What it proves | Cadence | LLM call? |
|---|---|---|---|
| Unit (`*.test.ts`) | Pure-function correctness | Every PR | No |
| Property (`tests/properties/`) | Deterministic invariants on generated shapes | Every PR | No |
| Integration with fakes | Cross-component flow | Every PR | No |
| **Evals (`tests/evals/`)** | **LLM produces useful output within the invariants** | **Nightly + manual** | **Yes (real provider)** |
| Live integration (`MERISM_LIVE_TESTS=1`) | Real Appwrite + LiveKit + agent | Nightly | Sometimes |

If a scenario's only assertion is "output parses against schema X", that
belongs in a property test, not here. Evals are for "given THIS specific
input, the output ALSO contains Y and doesn't mention Z".

## Adding a scenario

1. Choose the right surface (`tests/evals/surfaces/`). One scenario file
   per surface, one row per scenario.
2. Pick a stable `id` (kebab-case, unique across the whole corpus).
3. Pick exactly one tag from `corpus/tags.yaml`.
4. Write the `input` field — the value passed to `surface.invoke(input)`.
5. Write the `expected` field — the rubric the scorer reads:
   - `must_match_schema`: schema name in `scorers/schemaRegistry.ts`
   - `schema_path`: dot-path into output before schema check (e.g. `draft`)
   - `must_contain_keywords`: array of strings; ALL must appear
   - `must_not_mention_keywords`: array of strings; NONE may appear
6. Open a PR. The PR description MUST cite the scenario's source
   (issue link, QA finding, hypothesis). PR is gated by surface owner
   in `surfaces/OWNERS.md`.

## Adding a surface

1. Decide the surface name (`<area>.<entity>.<phase>` per scope-naming
   convention in `errors-and-observability.md`).
2. Write `tests/evals/surfaces/<name>.ts` implementing `SurfaceAdapter`.
3. Add the surface owner to `surfaces/OWNERS.md`.
4. Register any new contract schemas in `scorers/schemaRegistry.ts`.
5. Register the surface in `harness/runner.ts::runEvalsCli`.
6. Add at least 2-3 scenarios in `corpus/<area>/<name>.jsonl`.

## Adding a scorer

1. Implement the `Scorer<Input, Output, Expected>` interface in
   `tests/evals/scorers/<name>.ts`.
2. Write unit tests in `scorers/__tests__/<name>.test.ts`.
3. Surface owners decide which scorers their scenarios use; the runner
   wires scorers per-surface (sub-PR 2 generalizes; sub-PR 1 uses a
   single global scorer).

## Snapshot bootstrap (sub-PR 1 known gap)

Per design.md § Q2, every scenario should have an `expected-output.json`
snapshot from `main` as the regression baseline. Sub-PR 1 ships
**without snapshots** because snapshot generation requires a real LLM
run with `MERISM_EVAL_TESTS=1` + `DEEPSEEK_API_KEY`, which the harness
itself enables.

Bootstrap workflow: on the first real run (`MERISM_EVAL_TESTS=1 pnpm
test:evals` with a real key set), the harness produces a report in
`tests/evals/reports/`. The reviewer manually inspects each scenario's
output and commits the snapshot to `corpus/morris/<surface>.expected.json`.
Sub-PR 2 mechanizes this with a `--update-snapshots` flag on the runner.

## Cost controls

The runner enforces two limits:

- **Per-run total**: 500,000 tokens (override via
  `MERISM_EVAL_MAX_TOKENS_PER_RUN`). Exceeding aborts the run; remaining
  scenarios marked `skipped`.
- **Per-scenario cap**: 20,000 tokens. Scenarios exceeding this fail
  with `cost-exceeded` status; subsequent scenarios continue.

At DeepSeek's current pricing (~$0.10 per million input tokens), a full
nightly run on the planned 25-scenario corpus is < $0.05. Future
expansion to 200 scenarios stays under $1/night.

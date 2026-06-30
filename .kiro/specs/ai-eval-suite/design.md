# Design: `ai-eval-suite`

> **Parent**: `.kiro/specs/ai-eval-suite/requirements.md`
> **Date**: 2026-06-30
> **Status**: design complete (Q1–Q5 resolved); ready for tasks.md.

## Open question resolutions

### Q1 — Judge model: **DeepSeek with strict rubric, no separate "judge model"**

**Decision**: use DeepSeek (`deepseek-chat`) as the judge for free-form
scoring scenarios. NO separate reference model (Qwen-VL, GPT-4) is
adopted.

Reasoning:
- Adding a second LLM provider for evals violates ADR-0011's "primary
  cascade LLM is Qwen-VL; DeepSeek is dormant secondary" architecture and
  would require an ADR. Not worth the architecture cost for an internal
  eval harness.
- "Risk of DeepSeek scoring its own output favorably" (requirements Q1
  fear) is real but **mitigated by rubric strictness**, not by model
  diversity. A rubric like "the output mentions X, Y, Z (each =
  required)" leaves no room for self-favorable scoring — the answer is
  pass or fail per JSON-shape check, not "good vs bad" judgment.
- For genuinely subjective scoring (where the rubric can't be
  Boolean-checked), the design forces **multi-sample variance bound**
  (see below) to detect judge instability. If the judge is unstable on
  a scenario, the scenario gets marked `judge-flake: true` and the corpus
  rebalances toward deterministic scorers.

**Concrete rubric format** (per scenario in the corpus row):

```jsonl
{
  "id": "create-study-draft-basic-happy",
  "input": { ... },
  "expected": {
    "must_match_schema": "SurveyDraftSchema",
    "must_contain_section_titles": ["Background", "Pain points", "Solution validation"],
    "must_not_mention_keywords": ["billing", "team", "workspace"]
  },
  "judge_rubric": null
}
```

The deterministic scorer reads `must_match_schema` /
`must_contain_section_titles` / `must_not_mention_keywords` and produces a
binary score. Only when `judge_rubric` is non-null does DeepSeek get
invoked. Initial corpus is 100% deterministic.

### Q2 — Corpus governance: **scenario PR template + tag taxonomy + per-scenario expected output snapshot**

**Decision**: scenarios are added by PR. Each scenario PR MUST include:

1. **Tag** (REQUIRED): a stable identifier from a controlled vocabulary
   in `tests/evals/corpus/tags.yaml`. Initial tags:
   - `happy-path` (most common; demonstrates baseline expected behavior)
   - `error-handling` (input shape valid, but content asks for something
     unsupported)
   - `out-of-scope` (model should refuse — important regression guard)
   - `boundary` (edge-case inputs — empty, max-length, unicode)
   - `regression-{issue-id}` (was reported as a defect; now pinned)

2. **Source citation** (REQUIRED): one-line rationale in the PR description
   ("found via QA session 2026-Q3", "user-reported bug #142", "synthesized
   from research goals doc").

3. **Snapshot** (REQUIRED): the scenario PR MUST include a
   `expected-output.json` file alongside the `.jsonl` row showing the
   ACTUAL output of running the scenario against the current `main` —
   establishes the baseline that future regressions are detected against.
   Reviewer can spot-check: "is this output good enough that we want to
   guard it?"

4. **Surface ownership** (REQUIRED): each surface (`tests/evals/surfaces/<surface>.ts`)
   has a CODEOWNERS-style assigned owner who approves corpus additions for
   that surface. Initial owners are listed in
   `tests/evals/surfaces/OWNERS.md`.

### Q3 — Provider mock vs real: **real providers in CI, deterministic fakes in unit tests, ceiling enforced**

**Decision**:
- **Unit tests** (existing `pnpm test`): keep using deterministic fakes
  (`fakeQueriesModule`, etc.) per `testing.md` § Test double pattern.
  Evals do NOT run.
- **Eval harness** (`pnpm test:evals`, gated): MUST call real providers.
  Deterministic mocks defeat the purpose (the whole point is testing the
  LLM's actual behavior).
- **Cost ceiling**: hard-coded `EVAL_MAX_TOKENS_PER_RUN = 500_000`
  (configurable via `MERISM_EVAL_MAX_TOKENS_PER_RUN` env var, default
  500k). At ~$0.10 per million input tokens DeepSeek pricing, a full run
  is ≤ $0.05 — affordable for nightly.
- **Per-scenario cap**: each scenario invocation MUST complete in ≤
  20k tokens (input + output). Scenarios that need more are evidence of
  prompt or input drift; fail them rather than absorb the cost.
- **Cost guard reports**: every eval run emits per-scenario token use
  to the report JSON, so cost regression is visible.

### Q4 — Fail-closed threshold: **per-scenario binary pass/fail, NO aggregate fail-closed in initial cut**

**Decision**: initial implementation gates on **zero regressions** —
i.e., if a scenario passed against `main` (per the snapshot from Q2),
it MUST continue to pass. New scenarios join at "must pass after merge"
status.

NO aggregate pass-rate threshold (e.g., "fail if < 90% pass rate"):
- Aggregate thresholds reward gaming (adding easy scenarios to dilute
  hard regressions).
- Per-scenario binary is closer to what we actually want — "did anything
  break".
- Aggregate stats ARE reported (% pass per surface) but don't gate.

**Multi-sample variance** (judge stability check, per Q1): for scenarios
with `judge_rubric != null`, run N=3 samples. If 2 of 3 pass, the
scenario passes. If they disagree (pass/fail/pass), the scenario gets
flagged `judge-flake: true` in the report, alerting the reviewer to
rebalance toward deterministic scoring. Below 2/3 = fail.

### Q5 — Property-test overlap: **keep both; different layers, different cadences**

**Decision**: existing `tests/properties/` runs on every PR with
deterministic generators (fast-check / hypothesis). It proves
"deterministic invariants hold for all generated shapes". The eval
harness runs nightly with real providers. It proves "LLM produces useful
output within those invariants".

Concrete example: `tests/properties/morris-tool-output-shape.test.ts`
asserts "every `createStudyDraft` output, regardless of input, parses
against `SurveyDraftSchema`" — runs in 200ms, every PR. The eval scenario
`create-study-draft-basic-happy` asserts "given THIS specific input, the
output ALSO contains sections X, Y, Z and doesn't mention billing" —
runs nightly, uses real DeepSeek. Both layers add signal; neither
substitutes the other.

The eval harness MUST NOT re-test what property tests cover. If a
scenario's only assertion is "output parses against schema", it doesn't
belong in evals — push it back to property tests where it's cheaper.

## Architecture

```
tests/evals/
├── corpus/
│   ├── tags.yaml                       # controlled vocabulary
│   ├── morris/
│   │   ├── createStudyDraft.jsonl
│   │   ├── createStudyDraft.expected.json   # snapshot per Q2
│   │   ├── manageMemories.jsonl
│   │   └── ...
│   ├── functions/
│   │   ├── analyzeSession.text-pass.jsonl
│   │   ├── analyzeSurvey.combine.jsonl
│   │   └── ...
│   └── README.md                       # how to add scenarios
├── surfaces/
│   ├── createStudyDraft.ts             # adapter: corpus row → invoke production code → output
│   ├── manageMemories.ts
│   ├── analyzeSession.text-pass.ts
│   ├── OWNERS.md                       # per-surface code owner for corpus additions
│   └── _types.ts                       # SurfaceAdapter interface
├── scorers/
│   ├── jsonShapeMatch.ts               # deterministic: must_match_schema check
│   ├── keywordContains.ts              # deterministic: must_contain / must_not_mention
│   ├── judgeRubric.ts                  # uses DeepSeek with the rubric
│   └── _types.ts                       # Scorer interface + ScoringResult shape
├── harness/
│   ├── runner.ts                       # orchestrator: walks corpus → invokes surface → scores
│   ├── cost-guard.ts                   # token accounting + ceiling enforcement
│   ├── report.ts                       # JSON report writer
│   └── __tests__/
│       └── runner.test.ts              # unit test on the runner with a fake surface
└── README.md                           # eval harness top-level doc
```

### Key types

```ts
// surfaces/_types.ts
export interface SurfaceAdapter<Input, Output> {
  name: string;                        // e.g., "morris.tool.createStudyDraft"
  invoke(input: Input): Promise<Output>;
}

// scorers/_types.ts
export type ScoringResult =
  | { ok: true; tokens: { input: number; output: number } }
  | { ok: false; reason: string; tokens: { input: number; output: number } };

export interface Scorer<Input, Output, Expected> {
  name: string;                        // e.g., "json-shape-match"
  score(input: Input, output: Output, expected: Expected): Promise<ScoringResult>;
}
```

### Runner flow

```
for each scenario in corpus:
  if MERISM_EVAL_TESTS != "1": skip silently
  if scenario.tokens_so_far_this_run > EVAL_MAX_TOKENS_PER_RUN:
    break with "cost ceiling reached"

  output = surface.invoke(scenario.input)
  scoring = scorer.score(scenario.input, output, scenario.expected)

  if scoring.judge_rubric:
    run 3 samples, majority vote

  report.append({ id, surface, scoring, tokens })
```

### CI

A new workflow `.github/workflows/evals.yml` with:
- `schedule: cron: "0 2 * * *"` (02:00 UTC nightly)
- `workflow_dispatch:` (manual trigger)
- `push:` filtered to `paths: tests/evals/**`,
  `apps/web/lib/assistant/**`, `apps/functions/analyze*/**`

Job:
- `timeout-minutes: 30`
- Real provider keys from GitHub secrets
- Run `MERISM_EVAL_TESTS=1 pnpm test:evals`
- Upload `evals-report.json` artifact (retention 90 days)
- On scheduled run, comment on the latest open PR (if any) with summary

NO PR-blocking gate. Evals run async, communicate via artifact + PR
comment.

## Phased rollout

Per requirements.md scheduling notes, this sub-spec lands as 3 sub-PRs
to avoid a single 5-day PR:

| Sub-PR | Scope | LOC estimate |
|---|---|---|
| **1: harness scaffolding + 1 surface** | `tests/evals/{harness,scorers,surfaces,corpus}` skeletons + `createStudyDraft` end-to-end + 2-3 scenarios + `pnpm test:evals` gated by env | ~600 |
| **2: remaining 4 surfaces** | `manageMemories`, `analyzeData`, `analyzeSession.text-pass`, `analyzeSurvey.combine` adapters + 5 scenarios each | ~500 |
| **3: CI integration + judge model + cost guard** | `.github/workflows/evals.yml`, `judgeRubric.ts` scorer, `cost-guard.ts`, PR-comment action | ~300 |

Each sub-PR is independently mergeable: sub-PR 1 ships a working harness
on 1 surface, sub-PR 2 expands coverage, sub-PR 3 closes the CI loop.

## Risks

1. **DeepSeek API rate limit during nightly runs**: at 50 scenarios × 1
   invocation = 50 calls/night, well within DeepSeek's free-tier limits.
   If a future corpus expansion crosses 200 scenarios, switch to batched
   inference or run in 2 staggered batches.

2. **Snapshot drift over time**: the `expected-output.json` snapshot
   from Q2 reflects `main` at a point in time. If `main` LLM behavior
   subtly drifts (model version, prompt tuning), the snapshot can
   become stale. Mitigation: every snapshot has a `recorded-at` field;
   warn if snapshot is > 90 days old AND `prompt-versioning` sub-spec
   hasn't bumped the version. (`prompt-versioning` depends on this
   sub-spec — when both ship, the two-way reference closes the loop.)

3. **Real provider key in CI**: requires `DEEPSEEK_API_KEY` GitHub
   secret. The secret already exists for `integration` job. Eval CI
   inherits it via standard `${{ secrets.DEEPSEEK_API_KEY }}`. Not a
   new exposure surface.

4. **Judge model self-bias** (revisit of Q1 concern): deterministic
   scorers cover the first cut. If judge-rubric usage grows beyond ~20%
   of scenarios, the bias risk warrants re-evaluation. Track judge
   usage % in the report; alert at 30%.

5. **Eval harness becomes load-bearing infrastructure**: if the team
   relies on evals as the primary regression detector, the harness
   itself MUST be reliable. Mitigation: `tests/evals/harness/__tests__/`
   unit-tests the runner with a fake surface that returns deterministic
   outputs. Harness changes need their own test pass.

## References

- Parent: `.kiro/specs/ai-eval-suite/requirements.md`
- Sister sub-spec (depends on this): `.kiro/specs/prompt-versioning/`
- Steering: `.kiro/steering/testing.md` § Four layers, `.kiro/steering/errors-and-observability.md` § LLM call observability
- ADR: `docs/adr/0012-borrow-engineering-practices-from-posthog.md` (Wave B)
- PostHog reference: `~/posthog/ee/hogai/eval/` (corpus + harness + scorer split)

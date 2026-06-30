# Sub-spec: `ai-eval-suite`

> **Status**: stub (requirements drafted; design + tasks pending scheduling).
> **Parent spec**: `.kiro/specs/robustness-hardening/` (Wave B REQ-7)
> **Created**: 2026-06-30, scheduled as Wave B during robustness-hardening planning.

## Motivation

MerismV2 ships LLM-driven behavior in production today:

- **Morris** tools (`createStudyDraft`, `manageMemories`, `analyzeData`, etc.) — researcher-facing,
  affects what gets created in Appwrite.
- **Analysis Functions** (`analyzeSession`, `analyzeSurvey`) — produces the structured
  `AnalysisReport` the researcher reads.
- **LiveKit Agent** Supervisor instructions — directs live interview behavior.

Today, regression detection on these surfaces is:
- Unit tests on the deterministic scaffolding (tool schema, deps wiring) — green.
- Property tests on contracts — green.
- LLM behavior itself — **no automated coverage**. We rely on manual spot-checks.

This is a structural gap. Any prompt change, any provider swap, any model version drift can
silently regress quality without any test failing. PostHog's `ee/hogai/eval/` is the reference
pattern: a corpus of input fixtures + expected behavior assertions, run on a deterministic
scoring harness (with judge-model graders where deterministic isn't possible), gated behind an
env flag so it doesn't run on every PR.

We borrow the SHAPE (corpus + harness + flag) but rewrite for MerismV2 stack (vitest + pytest,
DeepSeek/Qwen, our actual LLM surfaces).

## Requirements

### REQ-1: Eval harness scaffolding

**WHAT**: a `tests/evals/` directory at the workspace root with three concerns separated:

1. **Corpus** (`tests/evals/corpus/<surface>/<scenario>.jsonl`) — fixed-input scenarios. Each row
   is `{ id, input, tags: [...] }`. Corpus is committed; new scenarios are added by PR.
2. **Surfaces** (`tests/evals/surfaces/<surface>.ts` or `.py`) — adapter that runs a corpus row
   through the production code path. For Morris tools: build a tool ctx, call `tool.execute(input)`,
   return result. For Analysis Functions: invoke `handler.ts` with in-memory deps.
3. **Scorers** (`tests/evals/scorers/<scorer>.ts`) — `(output, expected) => { score, reason }`.
   Deterministic where possible (JSON shape match, regex, keyword presence). Judge-model graded
   for free-form quality.

**Acceptance**: `tests/evals/corpus/`, `tests/evals/surfaces/`, `tests/evals/scorers/` exist
with at least one scenario per surface and the harness runs end-to-end on one row.

### REQ-2: Eval runner with `MERISM_EVAL_TESTS` gate

**WHAT**: a `pnpm test:evals` (TS) and `pnpm test:py:evals` (Python) script that:

1. Runs only when `MERISM_EVAL_TESTS=1` (mirror of `MERISM_LIVE_TESTS` + `MERISM_DEBUG_PROVIDERS`
   convention — strict `"1"` literal, default off).
2. Walks each surface's corpus, invokes the surface adapter, scores the output, aggregates per-tag
   pass rates.
3. Emits a structured summary (`evals-report.json`) with `{ surface, scenario, score, reason }`
   per row plus aggregate stats.
4. Exits 0 only if every scorer's pass rate ≥ its declared threshold (default 0.9, per-scorer
   override in the corpus row).

**Acceptance**: `MERISM_EVAL_TESTS=1 pnpm test:evals` runs to completion and prints a per-surface
summary. Without the flag, the script exits 0 immediately with "evals skipped" — never breaks
default `pnpm test`.

### REQ-3: Judge model for free-form scoring

**WHAT**: a `judgeModel(rubric, output) => { score, reason }` helper that calls DeepSeek (NOT a
new provider — see `architecture.md` Globally forbidden + ADR-0011) with a structured rubric and
parses the JSON response. Rubric format = JSON Schema + few-shot examples per scenario. Includes:

1. Variance bound (`max | mean - median |` over N samples) — if the judge is unstable on a
   scenario, that's a corpus problem, not a regression.
2. Cost guard — every judge invocation logs cost estimate; total per run capped at a configured
   ceiling, default $0.50; over-budget runs print warning and continue without further judge calls.

**Acceptance**: a sample scenario with rubric "output mentions exactly one study and gives a
non-empty notebookId" is scored consistently across N=5 runs (judge agreement on pass/fail).

### REQ-4: CI integration — nightly schedule

**WHAT**: a new CI workflow `.github/workflows/evals.yml` triggered on:
- Schedule: nightly at 02:00 UTC
- Manual: `workflow_dispatch`
- Push to `main` ONLY if any file under `tests/evals/`, `apps/web/lib/assistant/`, or
  `apps/functions/analyze*/` changed (`paths:` filter)

Job MUST:
- `timeout-minutes: 30`
- Use real provider keys from GitHub secrets
- Upload `evals-report.json` as an artifact (90-day retention)
- Comment on the latest open PR (if any) with a delta vs the previous run

**Acceptance**: nightly run produces an artifact; manual dispatch with a small corpus produces
a readable report.

### REQ-5: Initial corpus per Morris surface

**WHAT**: minimum 5 scenarios per surface for the first cut:

| Surface | Scenarios |
|---|---|
| `morris.tool.createStudyDraft` | (a) basic happy path, (b) missing research goal, (c) multi-section, (d) edit existing draft, (e) refusal of out-of-scope ask |
| `morris.tool.manageMemories` | (a) create, (b) query by intent, (c) update existing, (d) delete with approval, (e) list with no matches |
| `morris.tool.analyzeData` | (a) session-scope happy, (b) survey-scope rollup, (c) empty transcript, (d) cite specific quote, (e) refuse to invent claims |
| `function.analyzeSession.text-pass` | (a)–(e) on transcript fixtures from `apps/agent/tests/fixtures/` |
| `function.analyzeSurvey.combine` | (a)–(e) on multi-session fixtures |

**Acceptance**: corpus committed, each row tagged, scorers per scenario.

## Out of scope

- LiveKit Agent supervisor behavior. Live voice evals require LiveKit + audio + a different
  harness shape (audio-in / audio-out). Belongs in a sibling `live-voice-eval-suite` sub-spec.
- Pre-merge gating on PRs. Evals run nightly because they're expensive (real API calls); blocking
  every PR on them creates intolerable feedback latency. PR comment shows delta instead.
- Replacing manual UX testing. Evals catch regression on what we've encoded; novel UX issues
  still need humans.
- A web dashboard. Artifact JSON + a simple `pnpm evals:summary` CLI is enough for the first
  ~6 months; revisit if the team grows.

## Open questions (to resolve during design)

1. **Judge model choice**: DeepSeek (consistent with stack) or a separate "reference" model
   (e.g., Qwen-VL-Max) as judge? Risk of DeepSeek scoring its own output favorably. Default:
   DeepSeek with a strict rubric; revisit if pass rates look implausibly high.
2. **Corpus governance**: how do we add scenarios without it becoming a free-for-all? Suggested:
   each scenario PR must (a) tag the surface, (b) cite a real issue or hypothesis, (c) include
   the expected score on current main.
3. **Provider mock vs real**: evals MUST call real providers (deterministic mocks defeat the
   purpose). But cost grows linearly with corpus size. Decide a corpus-size ceiling per surface
   (suggested: 50 scenarios × 5 surfaces = 250 calls/night ≈ $0.50 at current pricing).
4. **Fail-closed threshold**: if pass rate < 0.9 the job exits non-zero. But a flaky judge can
   create false alarms. Discuss whether 3-run majority voting on each scenario is necessary.
5. **Property-test overlap**: existing `tests/properties/` covers schema/permission/secret
   invariants on deterministic shapes. Where evals and property tests overlap (e.g., "Morris
   tool output always parses against schema X"), keep both — the property test runs every PR
   and proves the deterministic shape; the eval runs nightly and proves the LLM produces useful
   output within that shape.

## Scheduling notes

- **Estimated wave size**: large. Harness scaffolding + 5 surfaces × 5 scenarios = real
  multi-day work. Plan as a 2-3 sub-PR rollout: (a) harness + 1 surface, (b) remaining surfaces,
  (c) CI integration + judge model.
- **Trigger to flesh out**: when a Morris regression is shipped to production undetected by
  existing tests, or proactively when the team has time for multi-day depth work.
- **Pre-reqs**: `lint-baseline-cleanup` (clean baseline before adding new test layers).
- **Estimated effort**: 3-5 days for harness + initial corpus. Ongoing: ~1 hour/week for
  scenario curation.
- **Sequencing**: BEFORE `prompt-versioning` (REQ-9 depends on goldens, which depend on this
  harness's scorers).

## References

- Parent spec: `.kiro/specs/robustness-hardening/{requirements,design,tasks}.md` REQ-7
- Steering: `.kiro/steering/testing.md` § Four layers, `.kiro/steering/errors-and-observability.md` § LLM call observability
- ADR: `docs/adr/0012-borrow-engineering-practices-from-posthog.md`
- PostHog reference: `~/posthog/ee/hogai/eval/` (their corpus + harness + scorer split)

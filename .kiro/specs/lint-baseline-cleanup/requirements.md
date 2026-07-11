# Sub-spec: `lint-baseline-cleanup`

> **Status**: stub (requirements drafted; design + tasks pending scheduling).
> **Parent spec**: `.kiro/specs/robustness-hardening/` (Wave A REQ-1 follow-up)
> **Created**: 2026-06-30, when Wave A landed semgrep with 36 WARN-severity baseline findings.

## Motivation

Wave A introduced 4 semgrep rules in `.semgrep/rules/`. Two of them (`no-silent-catch-fallback`,
`no-bare-console-in-source`) ship at **WARNING** severity because the codebase had ~36 existing
findings the moment they were enabled. WARN findings surface in CI output but don't gate merge.
This is fine as a baseline state — it lets the rules MEAN something for new code without forcing
a 50-file mega-PR — but it's a defect to leave the baseline drifting indefinitely:

- WARN noise erodes the signal in CI output. The reviewer's eye learns to skip the section.
- Each unaddressed WARN finding is a documented violation of `errors-and-observability.md`. If
  the rule is right and the rule message links the steering doc (which it does), then either the
  finding is a real defect or the rule needs narrowing. Neither outcome is "ignore it forever".
- The promotion path (WARN → ERROR) has no exit gate. This sub-spec defines the gate and walks
  the existing findings through it.

PostHog's `.semgrep/rules/` follows the same lifecycle: rules ship at WARN, the team cleans the
baseline, then the rule is promoted to ERROR in a one-line PR. Borrowed shape; the cleanup itself
is mechanical.

## Requirements

### REQ-1: Triage every `no-silent-catch-fallback` finding

**WHAT**: every site flagged by `pnpm semgrep:warn` for rule `no-silent-catch-fallback` MUST
end in one of three states, with no exception silently left:

1. **Rewritten** to use the proper try/catch pattern from `errors-and-observability.md` —
   re-throw, log + propagate, or typed `{ ok: false, error: "..." }` result. Preferred outcome.
2. **`nosemgrep:` annotated** above the site with a reason in parentheses that a reviewer can
   verify. The reason MUST cite WHICH catch-matrix row applies (e.g., "best-effort cleanup",
   "expected 409 translates to typed false"). Acceptable for genuine best-effort cleanup paths
   inside `apps/functions/*/src/deps.ts` reclaim loops.
3. **Excluded via `paths.exclude`** in the rule YAML, with a comment explaining why the path
   should never be covered (e.g., "generated SDK adapter, no business logic").

**Acceptance**: `pnpm semgrep:warn 2>&1 | grep no-silent-catch-fallback | wc -l` returns 0.

### REQ-2: Triage every `no-bare-console-in-source` finding

**WHAT**: same three-state outcome as REQ-1, but the preferred resolution is **migrate to
`createLogger(scope)`** from `@merism/observability`. The scope name MUST follow the registry
in `errors-and-observability.md` § LLM call observability (`action.*` / `function.*` /
`morris.*` / agent module prefix). For each migration, the `traceId` MUST be threaded through —
either by accepting an existing trace from the caller or creating one at the entry point per
the logger contract.

**Acceptance**: `pnpm semgrep:warn 2>&1 | grep no-bare-console-in-source | wc -l` returns 0.

### REQ-3: Promote both rules to ERROR severity

**WHAT**: once REQ-1 and REQ-2 both pass, edit each rule YAML to:

1. Change `severity: WARNING` to `severity: ERROR`.
2. Delete the "Wave A note" paragraph from the rule's `message` field (the one that explains
   the WARN status and links this sub-spec).
3. Update `.semgrep/README.md` rule catalog table to drop both from the "Hits today" column.

**Acceptance**: `pnpm semgrep` (which uses `--severity ERROR --error`) fails iff any of the
covered patterns reappears. `pnpm semgrep:warn` returns 0 findings.

### REQ-4: Update parent ADR's "Borrow lifecycle" reference

**WHAT**: `docs/adr/0012-borrow-engineering-practices-from-posthog.md` mentions Wave A
shipping rules at mixed severity. Once REQ-3 lands, add a one-line consequence entry stating
both rules reached ERROR severity. Keeps the ADR audit trail honest.

**Acceptance**: ADR-0012 mentions the promotion date.

## Out of scope

- New semgrep rules. New rules belong in their own sub-spec or a follow-up REQ in the parent
  `robustness-hardening` spec. This sub-spec is **cleanup of an existing baseline**, not
  rule expansion.
- Refactoring catch blocks that the rule didn't flag but a human reviewer might.
- Changing the rule patterns themselves. If a finding is a false positive, the resolution is
  `paths.exclude` or `nosemgrep:` with reason — not relaxing the pattern.

## Open questions (to resolve during design)

1. **Cleanup PR cadence**: one big PR for all ~36 findings, or one PR per file/module? Trade-off
   between reviewer fatigue and bisect granularity. PostHog tends toward small PRs.
2. **Logger scope for legacy `console.warn` in `apps/web/lib/queries/`**: the existing pattern
   is "data parse failed, log + drop row". The right scope name is `queries.<entity>` per
   the registry — but we don't have `queries.*` registered yet. Either add the prefix to the
   regex in `errors-and-observability.md` § LLM call observability (it's a non-LLM logger,
   slightly different concern) or use `action.queries.<entity>`. Sub-spec design decides.
3. **`apps/functions/*/src/deps.ts` reclaim loops**: every Function has a "delete stale records"
   path with intentional silent-catch. Decide whether to wrap them in a shared
   `bestEffort(fn, logger)` helper (DRY + audit trail) or keep `nosemgrep:` annotations
   (minimal change, per-site reason).

## Scheduling notes

- **Estimated wave size**: small (~36 file edits, but each is 1-3 lines; mechanical not architectural).
- **Trigger to flesh out**: when the WARN noise interferes with reading CI output, or when a
  reviewer can't tell whether a CI failure is a new violation or part of the baseline. Realistically:
  before the next 2 sub-specs land, so baseline doesn't grow.
- **Pre-reqs**: none. Wave A semgrep infrastructure is in place.
- **Estimated effort**: 0.5 day if done in one push, 2-3 small PRs if cadence-spaced.
- **Sequencing**: should run BEFORE `dependency-cruiser-boundaries` (REQ-6 in parent), because
  that sub-spec also adds CI gates and we don't want two new lint baselines drifting
  simultaneously.

## References

- Parent spec: `.kiro/specs/robustness-hardening/{requirements,design,tasks}.md`
- Steering: `.kiro/steering/errors-and-observability.md` § try/catch matrix + Logger contract
- ADR: `docs/adr/0012-borrow-engineering-practices-from-posthog.md`
- PostHog reference: `~/posthog/.semgrep/rules/` (their WARN → ERROR promotion practice;
  no specific commit to cite — it's a documented team workflow)

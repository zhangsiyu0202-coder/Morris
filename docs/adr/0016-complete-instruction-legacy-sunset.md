# ADR 0016: Complete the instruction legacy-field sunset

## Status

Accepted for the explicitly authorized local test environment (2026-07-13).
Production rollout remains a separate release decision: it requires its own
backup, release-cycle, and monitoring evidence.

## Context

ADR-0015 introduced `Survey.instruction` as the one study-scoped operating
manual. The prior surface is `Survey.moderatorInstruction` and three keys in
`Survey.flowConfig`: `researchGoal`, `targetAudience`, and `introScript`.

Waves 1–4 added the replacement and a compatibility fallback. W5a formally
deprecates the old surface and backfills existing documents. The old fields
must remain readable for a production sub-spec cycle before deletion, per
`.kiro/steering/contracts.md`.

## Decision

For the authorized local test environment, W5b will:

1. remove legacy fields and fallback composition from contracts and consumers;
2. emit only `flowConfig` plus the question-only `runtimeStudy` projection in
   room metadata;
3. remove the legacy JSON keys from persisted surveys;
4. delete the single physical Appwrite attribute
   `surveys.moderatorInstruction` through the explicit destructive schema gate.

The worker remains flow-config-only. `runtimeStudy` is retained solely for the
browser's progress calculation and the worker's structured question publisher;
it carries no research-intent fields.

## Local acceptance evidence

- The local backfill reported 33 populated surveys and three blank test rows;
  the project owner classified the three rows as disposable test data.
- The owner explicitly authorized destructive local execution.
- A paged local cleanup scanned 36 surveys, removed the three legacy JSON keys
  from 33 `flowConfig` values, and independently verified zero remaining
  legacy-key-bearing flow configs.
- `pnpm -F @merism/appwrite-schema apply -- --allow-destructive` completed,
  followed by `pnpm schema:verify`.
- The fixed allowlist permits only `surveys.moderatorInstruction`; apply is
  non-destructive unless the explicit flag is supplied.

## Production rollout prerequisites

- Retain a production backfill dry-run and apply report with no unresolved
  non-test survey.
- Observe one production sub-spec cycle without fallback or rollback.
- Take and retain a current `surveys` collection export/backup.
- Obtain an explicit production release approval before `--allow-destructive`.

## Consequences

The instruction document becomes the only persisted research-intent source.
Historical ADRs retain old field names as documentation; production source and
schema declarations do not.

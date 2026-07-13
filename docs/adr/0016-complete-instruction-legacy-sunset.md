# ADR 0016: Complete the instruction legacy-field sunset

## Status

Proposed — this ADR must not become Accepted until the W5a production gates in
`.kiro/specs/instruction-sunset/requirements.md` are evidenced.

## Context

ADR-0015 introduced `Survey.instruction` as the one study-scoped operating
manual. The prior surface is `Survey.moderatorInstruction` and three keys in
`Survey.flowConfig`: `researchGoal`, `targetAudience`, and `introScript`.

Waves 1–4 added the replacement and a compatibility fallback. W5a formally
deprecates the old surface and backfills existing documents. The old fields
must remain readable for a production sub-spec cycle before deletion, per
`.kiro/steering/contracts.md`.

## Decision

After all W5a gates pass, W5b will:

1. remove legacy fields and fallback composition from contracts and consumers;
2. emit only `flowConfig` plus the question-only `runtimeStudy` projection in
   room metadata;
3. remove the legacy JSON keys from persisted surveys;
4. delete the single physical Appwrite attribute
   `surveys.moderatorInstruction` through the explicit destructive schema gate.

The worker remains flow-config-only. `runtimeStudy` is retained solely for the
browser's progress calculation and the worker's structured question publisher;
it carries no research-intent fields.

## Preconditions to accept

- W5a backfill dry-run and apply reports are retained with the release record.
- All resolvable surveys have a non-empty `instruction`; unresolved surveys
  are repaired by their researcher before W5b.
- One production sub-spec cycle has no fallback/rollback event.
- A collection export/backup is available before destructive execution.
- W5b test and live-stack evidence is attached to this ADR.

## Consequences

The instruction document becomes the only persisted research-intent source.
Historical ADRs retain old field names as documentation; production source and
schema declarations do not.

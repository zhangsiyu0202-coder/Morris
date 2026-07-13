# Requirements — instruction-sunset

## Objective

Complete ADR-0015's retirement of `Survey.moderatorInstruction` and
`Survey.flowConfig.{researchGoal,targetAudience,introScript}` without losing
existing researcher-authored context or breaking the LiveKit interview path.

The work is deliberately split:

- **W5a — advisory migration release:** formally deprecate the old surface,
  provide an idempotent backfill, repair the Wave-2 instruction write path and
  trace propagation, then collect one production sub-spec cycle of evidence.
- **W5b — destructive sunset:** only after W5a gates and ADR-0016 approval,
  remove the legacy contracts, consumers, JSON keys, and Appwrite attribute.

## W5a requirements

1. Every legacy contract field has `@deprecated` documentation that names
   `instruction` as its replacement and cites ADR-0015 / this spec.
2. `scripts/backfill-survey-instruction.ts` supports `--dry-run` (default) and
   `--apply`; it pages through surveys, writes only rows whose `instruction`
   is blank, derives markdown with `composeInstructionFromLegacy`, and never
   rewrites `flowConfig`.
3. Backfill is resumable and idempotent: already populated surveys and surveys
   with no legacy content are reported but not written.
4. Baseline LLM calls use an invocation-scoped trace id supplied by their
   Server Action or Morris tool; they must not reuse a module-load trace id.
5. W5a changes ship with unit and property coverage. Live Appwrite validation
   is gated by `MERISM_LIVE_TESTS=1`.

## W5b entry gates

All conditions are required before destructive execution:

1. W5a has been deployed for one full production sub-spec cycle.
2. The backfill report shows no survey with blank `instruction` and remaining
   legacy source content.
3. New-survey monitoring shows no fallback/rollback event in that cycle.
4. ADR-0016 is accepted by the project owner.
5. A current export/backup of the `surveys` collection is available.

## W5b requirements

1. Delete the four legacy fields and legacy composition helpers only after the
   gates. `buildInterviewFlowConfigFromDraft` requires non-empty
   `draft.instruction` and copies it verbatim to `moderatorInstruction`.
2. Delete `workflowConfig` and the obsolete workflow-state contract. Keep a
   narrowed `runtimeStudy` because browser progress and the voice worker's
   structured question index consume its sections/questions.
3. Remove the three legacy keys from every persisted `flowConfig`, preserving
   unrelated keys, then delete only the real Appwrite attribute
   `surveys.moderatorInstruction`.
4. Schema apply remains non-destructive by default. Attribute deletion is
   available only through `--allow-destructive` with a fixed allowlist and
   preflight confirmation.
5. No production source reference to a legacy field remains after W5b;
   historical ADR text is exempt.

## Verification

- `pnpm test`, `pnpm test:properties`, `pnpm typecheck`, `pnpm lint`,
  `pnpm scope-guard`, `pnpm semgrep`, and `pnpm deps:cruise` pass.
- `pnpm schema:verify` passes against the local stack after W5b migration.
- The live interview smoke proves the dispatch contains `flowConfig`, retains
  UI progress, and contains no `workflowConfig` after W5b.

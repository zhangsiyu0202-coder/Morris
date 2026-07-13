# Tasks — instruction-sunset

## W5a: advisory migration release

- [x] **T1: Record deprecation and the execution contract.**
  - Acceptance: requirements/design/tasks and proposed ADR-0016 describe W5a,
    W5b gates, data flow, rollback boundary, and Appwrite deletion mechanism.
  - Verify: documentation review; no destructive command is run.

- [x] **T2: Add RED tests for advisory migration behavior.**
  - Acceptance: tests fail before implementation for blank-only selection,
    legacy markdown composition, idempotency, unrelated `flowConfig`
    preservation, and invocation-scoped trace propagation.
  - Verify: targeted Vitest command fails for the expected assertions.

- [x] **T3: Implement W5a backfill and formal deprecation.**
  - Acceptance: dry-run default, explicit apply mode, cursor paging,
    idempotent updates, unresolved reporting, and `@deprecated` JSDoc.
  - Verify: targeted unit/property tests pass; contracts build/typecheck pass.

- [x] **T4: Repair Wave 2 / Wave 3 instruction trace seam.**
  - Acceptance: generator accepts a caller trace id; module-level logger no
    longer supplies LLM trace context; Server Action/Morris callers preserve it.
  - Verify: focused tests prove a supplied request trace id reaches the LLM
    observability wrapper. The legacy-input UI removal remains W5b because it
    depends on deleting the deprecated `SurveyDraft` fields.

- [x] **Checkpoint: W5a release candidate.**
  - Verify: workspace quality gates and local non-destructive schema verify.
  - Commit: `feat(instruction): add advisory sunset migration tooling`.

## W5b: destructive sunset — blocked until W5a gates

- [ ] **T5: Write RED contract/metadata tests.**
  - Acceptance: tests require no legacy fields or `workflowConfig`, preserve
    runtime question progress, and reject blank instruction for issuance.

- [ ] **T6: Remove contracts and consumers.**
  - Acceptance: contract-first removal, narrowed runtime study, direct
    instruction flow config, cleaned web/functions/Morris callers.

- [ ] **T7: Add destructive schema gate and execute only against approved target.**
  - Acceptance: fixed allowlist, explicit flag, preflight, live verify;
    remove `moderatorInstruction` and legacy JSON keys after backup approval.

- [ ] **T8: Finalize evidence and ADR-0016.**
  - Acceptance: production evidence attached, zero legacy production refs,
    full gates pass, ADR-0016 status becomes Accepted.

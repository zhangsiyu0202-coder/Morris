# Eval surface owners

Each surface in `tests/evals/surfaces/` has an owner who approves
corpus additions for that surface. The owner is responsible for:

1. Reviewing the scenario rationale + tag in PR description (per
   `.kiro/specs/ai-eval-suite/design.md` § Q2).
2. Confirming the expected-output snapshot is acceptable as a regression
   baseline (i.e., this is output we'd commit to "should never get worse
   than this").
3. Re-running the harness locally and verifying the new scenario passes
   on `main` before merge.

| Surface | Owner | Notes |
|---|---|---|
| `morris.tool.createStudyDraft` | @morris | Researcher-facing draft generation; refuses out-of-scope; produces SurveyDraft contract |

When a new surface is added, append a row to this table in the same PR.
Owner placeholders are by GitHub handle (or a `@<team>` group when the
repo grows out of solo authorship).

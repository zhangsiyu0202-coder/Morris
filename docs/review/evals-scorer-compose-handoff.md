# Handoff: eval scorer composition helper

## Status
Completed.

## Current Goal
Extract a reusable scorer composition helper for the eval suite, then add tests for the helper and switch `tests/evals/scorers/combined.ts` to use it.

## What Has Been Done
- Implemented request-scoped runtime trace propagation for Morris.
- Added `packages/observability/src/runtime-scope.ts`.
- Updated `packages/observability/src/logger.ts`, `packages/observability/src/llm-middleware.ts`, `apps/web/app/api/assistant/route.ts`, `apps/web/lib/auth/workspace.ts`, `apps/web/lib/assistant/model.ts`, `apps/web/lib/assistant/system-prompt.ts`, and `apps/web/lib/assistant/agent.ts`.
- Added a runtime-scope regression test in `packages/observability/test/observability.test.ts`.
- Verified:
  - `pnpm -F @merism/observability typecheck`
  - `pnpm -F @merism/observability test`
  - `pnpm -F @merism/observability build`
  - `pnpm -F @merism/web typecheck`
- Added `tests/evals/scorers/compose.ts`.
- Added `tests/evals/scorers/__tests__/compose.test.ts`.
- Refactored `tests/evals/scorers/combined.ts` to use the new helper.
- Verified:
  - `pnpm vitest run tests/evals/scorers/__tests__/compose.test.ts tests/evals/scorers/__tests__/judgeRubric.test.ts tests/evals/harness/__tests__/runner.test.ts`
  - `pnpm typecheck`

## Final State
The eval scorer composition slice is complete.

There is no remaining task in this handoff.

## Suggested Skills
- `test-driven-development`
- `incremental-implementation`
- `code-review-and-quality`
- `using-agent-skills`

## Relevant Files
- `tests/evals/scorers/combined.ts`
- `tests/evals/scorers/judgeRubric.ts`
- `tests/evals/scorers/jsonShapeMatch.ts`
- `tests/evals/scorers/_types.ts`
- `tests/evals/harness/runner.ts`
- `tests/evals/harness/__tests__/runner.test.ts`

## Notes for the Next Agent
- Keep the helper pure and small.
- Favor the existing scorer contract in `tests/evals/scorers/_types.ts`.
- The current repo has many unrelated modified files already; do not revert or touch them unless they are part of this slice.

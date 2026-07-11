# Implementation Plan

## Phase 1: Turn the review into governed architecture notes

- [ ] Add a runtime-only boundary note or ADR that names the allowed runtime state and the forbidden crossing points.
- [ ] Update the Mastra learnings spec so the runtime boundary is explicit in both requirements and design language.

## Phase 2: Align memory language

- [ ] Update `morris-memory` to distinguish raw history, long-term memory, derived memory, and recall sources.
- [ ] Cross-link `morris-conversation-persistence` so the raw-history path is not described as general memory.
- [ ] Confirm the new language does not imply a Mastra Observational Memory clone.

## Phase 3: Evals as reusable scorer infrastructure

- [ ] Update `ai-eval-suite` design language so scorers are reusable across nightly, replay, and targeted checks.
- [ ] Call out which scorer code can be shared and which harness parts stay gated.
- [ ] Keep the current `MERISM_EVAL_TESTS` behavior intact while broadening the scorer model.

## Phase 4: Unified observability model

- [ ] Update `morris-llm-observability` to describe a single correlation model across traces, logs, metrics, and scorer output.
- [ ] Ensure the model preserves current `traceId` propagation and secret masking rules.
- [ ] Note the relationship to `packages/observability` without moving business logic into it.

## Phase 5: Verification and handoff

- [ ] Re-read the updated spec set for contradictions with existing architecture notes.
- [ ] Confirm the resulting work still preserves the Morris / LiveKit agent / Function boundary.
- [ ] Capture any open questions as follow-up spec items instead of letting them leak into implementation.

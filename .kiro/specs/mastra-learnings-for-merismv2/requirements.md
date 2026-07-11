# Requirements Document

## Feature: Mastra Learnings For MerismV2

## Introduction

MerismV2 should borrow the parts of Mastra that solve real Merism problems, not the parts that only exist because Mastra is a framework product. The source review showed four reusable ideas with strong fit: a runtime-only boundary for non-serializable state, explicit memory layering, scorer pipelines for evals, and a unified observability model.

Official docs consulted:
- https://mastra.ai/docs/agents/overview
- https://mastra.ai/docs/workflows/overview
- https://mastra.ai/docs/memory/overview
- https://mastra.ai/docs/memory/observational-memory
- https://mastra.ai/docs/evals/overview
- https://mastra.ai/docs/observability/overview

Adopted project context:
- `docs/design/mastra-learnings-for-merismv2.md`
- `.kiro/specs/ai-eval-suite/requirements.md`
- `.kiro/specs/morris-memory/design.md`
- `.kiro/specs/morris-llm-observability/design.md`

## Requirements

### Requirement 1: Runtime-only boundary

**User Story:** As a MerismV2 maintainer, I need a named boundary for per-request, per-run, and per-session runtime state so that live handles, closures, and other non-serializable values never leak into contracts or persistence.

#### Acceptance Criteria

1. The project SHALL define a runtime-only state boundary that explicitly excludes serialized payloads and persistent stores.
2. Morris request state, Function invocation state, and agent session scratch state SHALL each have a clear place to live in that boundary.
3. Anything classified as runtime-only SHALL be treated as non-contractual and non-persistent unless a later spec promotes it.

### Requirement 2: Memory layering

**User Story:** As a MerismV2 maintainer, I need memory to be described as distinct layers so that raw history, long-term memory, derived memory, and recall sources do not collapse into one blob.

#### Acceptance Criteria

1. The spec SHALL distinguish raw conversation history from derived or compressed memory.
2. Long-term memory SHALL be documented as separate from raw transcript storage.
3. Raw recall sources SHALL remain distinct from summaries and reusable memory artifacts.
4. Existing memory-related specs SHALL reference the layered model instead of implying a single store.

### Requirement 3: Scorer pipeline

**User Story:** As a MerismV2 maintainer, I need `ai-eval-suite` to be reusable scorer infrastructure so that the same scorer logic can serve nightly regressions, trace replay, and targeted live checks.

#### Acceptance Criteria

1. The eval spec SHALL treat scorers as first-class reusable components, not only as a nightly harness detail.
2. The current eval workflow SHALL remain supported while the scorer pipeline becomes more reusable.
3. The new model SHALL preserve the existing gated behavior for expensive provider-backed runs.

### Requirement 4: Unified observability model

**User Story:** As a MerismV2 maintainer, I need traces, logs, metrics, and scorer output to share one correlation model so that a single run can be followed end-to-end.

#### Acceptance Criteria

1. The spec SHALL name a stable correlation key for observability across Morris, Functions, and evals.
2. Logs, traces, metrics, and scorer results SHALL be describable in one shared model.
3. Secret masking and current trace propagation rules SHALL remain intact.

## Non-goals

- Rebuilding MerismV2 as a generic AI framework.
- Importing Mastra Observational Memory wholesale.
- Introducing a second LLM provider or a second ASR/TTS provider.
- Adding teams, billing, quotas, or usage metering.

## Success signal

- Each of the four borrowable ideas has a named place in the MerismV2 spec set.
- The next implementation step for each area is obvious without re-reading the Mastra source tree.
- Future work can point to this spec when deciding whether a Mastra-like pattern belongs in MerismV2.

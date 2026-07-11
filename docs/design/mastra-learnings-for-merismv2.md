# Mastra Learnings For MerismV2

> Spec kernel: `.kiro/specs/mastra-learnings-for-merismv2/SPEC.md`

Date: 2026-07-02

## Objective

Review the local checkout at `/home/jia/mastra` and identify which Mastra engineering patterns MerismV2 should learn from, which ones are only appropriate for a framework product, and which ideas can be translated into concrete MerismV2 follow-up work.

This is a source-driven review. Framework-specific claims below are backed by Mastra's official documentation, and implementation-shape observations are backed by the local Mastra source tree.

## Stack Observed

From the local Mastra checkout:

- `@mastra/core`: `1.49.0-alpha.2` from `/home/jia/mastra/packages/core/package.json`
- `@mastra/memory`: `1.22.1-alpha.0` from `/home/jia/mastra/packages/memory/package.json`
- `@mastra/evals`: `1.5.1` from `/home/jia/mastra/packages/evals/package.json`
- `@mastra/observability`: `1.15.2` from `/home/jia/mastra/observability/mastra/package.json`

Implication: Mastra is no longer a small library. It is a broad platform/framework with separate packages for core runtime, memory, evals, observability, voice, auth, server adapters, and more. MerismV2 should borrow architectural ideas selectively, not attempt framework-level parity.

## Official Documentation Reviewed

- Agents overview: https://mastra.ai/docs/agents/overview
- Workflows overview: https://mastra.ai/docs/workflows/overview
- Observational Memory: https://mastra.ai/docs/memory/observational-memory
- Evals overview: https://mastra.ai/docs/evals/overview
- Observability overview: https://mastra.ai/docs/observability/overview

## Key Official Positions

### Agents vs workflows

Mastra's official split is crisp:

- Agents are for open-ended tasks where the system decides which tools to call and when to stop.
- Workflows are for predefined, multi-step execution where the developer wants explicit control over sequencing and data flow.

Source:

- https://mastra.ai/docs/agents/overview
- https://mastra.ai/docs/workflows/overview

Useful quote from the docs:

> "Use agents when the task is open-ended and the steps aren't known in advance."

> "Use workflows for tasks that are clearly defined upfront and involve multiple steps with a specific execution order."

This maps well onto MerismV2's existing split between Morris and the deterministic Function/agent pipelines.

### Observational memory is a compression system, not just storage

Mastra positions Observational Memory as a long-context compression layer, not just a store of old messages.

Source:

- https://mastra.ai/docs/memory/observational-memory

Useful quote:

> "OM solves both problems by compressing old context into dense observations."

That is more ambitious than our current memory layers, but the underlying principle is strong: older context should be transformed, not merely retained.

### Evals belong in the delivery loop

Mastra explicitly treats scorers as part of live systems and CI/CD, not just offline experiments.

Source:

- https://mastra.ai/docs/evals/overview

Useful quote:

> "Scorers can also be part of your CI/CD pipeline"

This is highly aligned with our current `ai-eval-suite` direction.

### Observability is a three-signal system

Mastra treats tracing, logging, and metrics as one correlated system.

Source:

- https://mastra.ai/docs/observability/overview

Useful quote:

> "It captures three complementary signals"

That is stronger than a plain logger-centric approach and aligns with where MerismV2 should head as more AI behavior becomes production critical.

## Source-Level Findings

### 1. Hard split between serializable state and runtime-only state

Most valuable source-level pattern in the entire review.

Mastra has a dedicated `RunScope` abstraction for non-serializable runtime values:

- `/home/jia/mastra/packages/core/src/mastra/run-scope.ts`

The file explains the invariant directly:

- step inputs/outputs may cross `JSON.stringify`
- closures, controllers, streams, and live handles must stay off the wire
- runtime-only values are keyed by `runId` and never persisted or published

Why this matters for MerismV2:

- We already have paths where persistent state and live runtime state are separate in principle but not always explicit in code.
- Morris request-time state, long-running workflow state, and agent/session-only state would all benefit from a dedicated runtime scratch-space abstraction.

Borrow:

- The principle
- The typed key pattern
- The explicit "never persisted" contract

Do not borrow:

- Framework-wide orchestration machinery around it unless we actually need cross-process workflow execution.

### 2. Memory is layered by responsibility

Mastra's memory package is not one big store. It composes several concerns:

- message history
- working memory
- observational compression
- retrieval/recall

Relevant source:

- `/home/jia/mastra/packages/memory/src/index.ts`

Particularly valuable pattern:

- the memory layer builds context from different sub-systems instead of pretending there is only one kind of memory

Also notable:

- managed working memory defaults are applied centrally
- optional observational machinery is lazily initialized
- retrieval dependencies are validated at construction time

Why this matters for MerismV2:

- We should continue separating conversation persistence, long-term memory, and future compacted memory rather than collapsing them.
- "Raw transcript/history" and "useful reusable summary/state" should remain distinct artifacts.

Borrow:

- Layered memory model
- Explicit context assembly
- Construction-time validation for optional memory subsystems

Do not borrow:

- The full Observational Memory subsystem today. It is powerful but significantly more complex than our current needs.

### 3. Evals are a scorer pipeline, not a single function

Mastra's core eval abstraction is pipeline-oriented:

- `/home/jia/mastra/packages/core/src/evals/base.ts`

The important idea is not any one method name. It is that evaluators are structured, typed, and composable, with room for:

- preprocessing
- judge configuration
- step-level scoring
- output shaping
- observability integration

Why this matters for MerismV2:

- Our current `ai-eval-suite` is already moving in the right direction.
- The next maturity step is making scorers first-class enough to attach to more than nightly harnesses: traces, live runs, and targeted regressions.

Borrow:

- scorer-as-pipeline mental model
- typed run payloads
- optional judge tools and request context

Do not borrow:

- unnecessary generality for surfaces we do not actually have.

### 4. Observability is built as a registry and bus

Mastra's observability package uses:

- a registry for multiple observability instances
- a bus for routing tracing/log/metric/score/feedback events

Relevant source:

- `/home/jia/mastra/observability/mastra/src/registry.ts`
- `/home/jia/mastra/observability/mastra/src/bus/observability-bus.ts`

Best takeaway:

- exporters and bridges are pluggable
- non-tracing events are sanitized before fan-out
- flush semantics are treated as part of the design, not an afterthought

Why this matters for MerismV2:

- Today we have good local observability primitives, but less of a unified export pipeline.
- As evals, analytics, and production diagnostics grow, a bus/registry design becomes more valuable than ad hoc sink calls.

Borrow:

- registry + bus architecture
- sanitize-before-export rule
- explicit flush/drain semantics

Do not borrow:

- vendor explosion. Start with one internal event model and a small number of sinks.

### 5. Package structure reflects product goals

Mastra's monorepo is domain-sliced and platform-shaped:

- core
- memory
- evals
- observability
- server adapters
- auth
- voice
- workspaces
- client SDKs

Why this matters for MerismV2:

- It is a good example of package boundaries when you are building a reusable framework.
- It is not evidence that MerismV2 should split into many packages immediately.

Borrow:

- clear domain boundaries
- narrow package responsibilities when a module is truly reusable

Do not borrow:

- package proliferation for its own sake
- giant public surface area while we are still primarily a product codebase

## What MerismV2 Should Borrow

### A. Runtime scratch-space for non-serializable state

Priority: high

Proposal:

- introduce a small MerismV2-specific runtime-scope abstraction for per-run/per-request ephemeral objects
- use it only for values that must not be persisted or serialized
- explicitly forbid crossing that boundary into storage/contracts

Why:

- This is the cleanest improvement we can borrow with the lowest conceptual risk.

### B. Memory layering as an explicit architecture rule

Priority: high

Proposal:

- document MerismV2 memory layers explicitly:
  - conversation history
  - long-term user memory
  - future compacted/derived memory
  - raw recall sources
- keep each layer as a separate artifact with a separate owner

Why:

- This prevents us from turning one persistence surface into a catch-all blob.

### C. Scorer pipeline thinking for AI quality

Priority: high

Proposal:

- evolve `ai-eval-suite` from "nightly corpus runner" toward a reusable scorer pipeline
- make it possible to reuse scorer logic across:
  - nightly evals
  - targeted regressions
  - trace replay
  - selected live runs

Why:

- This is exactly where our product risk is increasing.

### D. Observability as a unified event system

Priority: medium

Proposal:

- keep current structured logging primitives
- add a thin internal event bus/registry layer before adding more sinks
- make sanitization and flush semantics explicit in that layer

Why:

- It scales better than sink-specific instrumentation once AI behavior becomes harder to debug.

### E. Keep the agent/workflow split sharp

Priority: medium

Proposal:

- continue treating open-ended reasoning and deterministic orchestration as separate system responsibilities
- resist hybrid abstractions that do both poorly

Why:

- Mastra's docs are right on this distinction, and MerismV2 already benefits from keeping it sharp.

## What MerismV2 Should Not Borrow

### 1. Full Observational Memory right now

Reason:

- It brings substantial complexity: observer, reflector, buffering, retrieval mode, token-budget policy, scope policy, background agents.
- We do not yet have evidence that MerismV2 needs this full system.

### 2. Framework-scale package breadth

Reason:

- Mastra is a platform. MerismV2 is still a product.
- Product code should stay simpler until repeated reuse forces a package boundary.

### 3. Platform orchestration complexity without platform needs

Reason:

- Cross-process orchestration, broad adapters, and giant exported surfaces are expensive to maintain.
- We should only add them when our deployment/runtime topology truly requires them.

## MerismV2-Specific Recommendations

### Near-term

1. Write a small ADR or sub-spec for runtime-only run scope.
2. Add a memory architecture note describing the current and intended layers.
3. Expand `ai-eval-suite` from nightly-only toward reusable scorer primitives.

### Mid-term

1. Introduce a unified internal observability event model.
2. Define which Merism artifacts are raw history vs compressed derived memory.
3. Add trace-linked scorer execution for selected flows.

### Not now

1. Mastra-style full observational memory.
2. Dozens of framework-style packages.
3. Re-architecting MerismV2 around Mastra's runtime model wholesale.

## Bottom Line

Mastra is worth studying seriously, especially for:

- runtime-only state boundaries
- layered memory architecture
- scorer/eval system design
- unified observability pipelines
- crisp separation of agents vs workflows

The right lesson is not "Mastra has feature X, so MerismV2 should also have X."

The right lesson is:

- what problem is Mastra solving with this boundary?
- do we already have that problem?
- if yes, what is the smallest Merism-native version of the same idea?

That is the borrowing strategy most likely to improve MerismV2 without importing framework-scale complexity we do not need yet.

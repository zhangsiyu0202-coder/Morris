---
title: "Mastra Learnings For MerismV2"
companions:
  - "requirements.md"
  - "design.md"
  - "tasks.md"
  - "../../../docs/design/mastra-learnings-for-merismv2.md"
---

# Why

MerismV2 already has the same pressure points Mastra formalizes: open-ended assistant behavior vs deterministic workflows, layered memory, evaluative regression detection, and correlated observability. Mastra's official docs make the split explicit: agents for open-ended tasks, workflows for predefined sequences, memory as layered responsibilities, scorers as part of CI/CD, and observability as tracing + logging + metrics working together.

Sources:
- https://mastra.ai/docs/agents/overview
- https://mastra.ai/docs/workflows/overview
- https://mastra.ai/docs/memory/overview
- https://mastra.ai/docs/memory/observational-memory
- https://mastra.ai/docs/evals/overview
- https://mastra.ai/docs/observability/overview

# Capabilities

## C1 Runtime-only boundary

Intent: define a runtime-only boundary for per-request, per-run, and per-session non-serializable state across Morris, Functions, and the agent worker.

Success: a named runtime scope exists, callers know what belongs there, and runtime-only values are never promoted into contracts or Appwrite persistence without a later explicit spec.

## C2 Memory layering

Intent: codify distinct memory layers for raw conversation history, long-term memory, derived or compressed memory, and raw recall sources.

Success: each layer has a separate owner and persistence rule, and no new work treats memory as one undifferentiated store.

## C3 Scorer pipeline

Intent: evolve `ai-eval-suite` into reusable scorer primitives that can run nightly, on trace replay, and on selected live runs.

Success: scorers are first-class and reusable across surfaces instead of only a nightly corpus harness.

## C4 Unified observability model

Intent: standardize trace, log, metric, and scorer correlation around a stable trace id and sanitized payloads.

Success: observability events from Morris, Functions, and evals can be joined without ad hoc sinks or duplicated shape definitions.

# Constraints

- Preserve the Morris, LiveKit agent, and Function boundary.
- Do not introduce a second LLM provider, a second ASR/TTS provider, or a parallel platform framework.
- Do not add the full Mastra Observational Memory subsystem.
- Do not add framework-scale package proliferation.
- Any runtime-only state must stay out of contracts and Appwrite persistence unless a later spec explicitly promotes it.
- Observability changes must keep secret masking and current `traceId` propagation intact.
- Work must remain incrementally landable and keep the repo testable after each slice.

# Non-goals

- Rebuilding MerismV2 as a generic AI framework.
- Exposing Morris as an external MCP or server platform.
- Replacing existing LiveKit interview orchestration.
- Introducing teams, organizations, collaboration, billing, quotas, or usage metering.

# Success signal

- The four workstreams above are captured in the existing spec and doc set and can be implemented independently.
- `ai-eval-suite` can reuse scorer logic beyond nightly runs.
- Merism docs distinguish raw history from derived memory.
- Observability can correlate a trace across logs, metrics, and scorer output with one stable id.
- Future changes have a clear borrow-or-build answer for Mastra-like patterns.

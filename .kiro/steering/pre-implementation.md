---
inclusion: always
---

# Pre-Implementation (binding)

The discipline that runs **before** writing any code. Two failure modes this file exists to prevent:

1. **Blind-men-and-the-elephant**: changing one component without reading the upstream/downstream chain. Most architectural drift in this codebase has this root cause.
2. **MVP-then-polish**: shipping a "minimum working version" with the intent to fix error paths, concurrency, tests, or schema rigor in a follow-up. This is rejected — there is no follow-up culture on this project.

Read together with `scope.md` (which decides whether a thing should exist) and `architecture.md` (which decides where it goes once we agreed it should exist).

## Investigation order (binding)

Before writing the first line of code for any non-trivial feature, the agent MUST complete the following investigation. This step is not optional and cannot be done "as I go".

1. **Read the relevant sub-spec end to end**: `requirements.md`, `design.md`, `tasks.md`. If the sub-spec does not exist yet, write it first or stop and ask.
2. **Read the relevant ADRs**: at minimum 0001 (interview controller), 0002 (page assistant stack), 0003 (analysis report). Read any that apply to the touched module.
3. **Re-read the steering files relevant to the touched module**: this file, `architecture.md`, `contracts.md`, `errors-and-observability.md`, `testing.md`, `scope.md`. Note which rules apply.
4. **Enumerate every module that will change**: contracts / functions / agent / web / appwrite-schema / observability. Skipping one is the most common drift cause.
5. **Use LSP `find_references` (not grep) to find every existing caller of every contract or function you will modify**: grep misses re-exports, dynamic imports, and string-based references. Build a complete caller list.
6. **Read the existing code for each touched module**: not titles, not summaries — the actual implementation, the existing tests, the existing error codes.
7. **Trace the existing data flow**: trigger → contracts → function/agent → persistence → consumer. Write it down (in the PR description or sub-spec design) if it is non-trivial.
8. **Check for an existing artifact that already serves the use case** (`scope.md` borrow-or-build flow). If found, optimize it; do NOT create a parallel concept.
9. **If schema is changing, run `pnpm schema:verify` against local stack** to see the live diff.

## Blind-men anti-patterns (forbidden)

- Reading one component file and editing it without checking the upstream server action and the downstream schema.
- Modifying a contract without using LSP to find every consumer (grep is insufficient because it misses re-exports and string-based imports).
- Modifying a Function handler without checking that the agent does not depend on the same room metadata or RPC shape.
- Modifying a zod schema without running `pnpm -F @merism/contracts test` and `pnpm test:py`.
- Reinventing a decision because the relevant ADR was not read (canonical reinvention: proposing LangGraph as the realtime controller, which ADR-0001 explicitly rejects).
- Renaming or repurposing a field that is mirrored in `apps/agent/agent/contracts.py` without updating the mirror in the same PR.

## GitHub reference research (binding)

For every non-trivial feature or new pattern, the agent MUST consult at least one production-grade reference implementation BEFORE writing code. Reference research is not optional.

Priority order:

1. **First-choice — official examples of the active stack**:
   - LiveKit Agents: `livekit/agents` repo `examples/` — Supervisor, TaskGroup, AgentTask, RPC, room metadata patterns.
   - Vercel AI SDK 6: `vercel/ai` repo `examples/` — `ToolLoopAgent`, `prepareStep`, `stopWhen`, `useChat`, `createAgentUIStreamResponse`.
   - Appwrite: `appwrite/appwrite` and `appwrite/sdk-for-node` examples — Functions, permissions, storage, collections.
   - shadcn/ui: original component implementations (do not fork from third-party copies).

2. **Second-choice — mature products in the same domain**:
   - Qualitative research / interviews: PostHog `products/user_interviews/`, open-source parts of Dovetail.
   - Realtime voice flows: LiveKit official example apps, Vapi open-source repos.
   - Editor / spec authoring: Linear and Notion public engineering posts.

3. **Borrow judgment** (cross-references `scope.md` borrow-or-build flow):
   - Borrow **shape** (data structure, state machine, event names) — safe.
   - Borrow **design trade-offs** (why they avoid X, concurrency model, rollback ordering) — strongly encouraged.
   - Borrow **code snippets directly** — forbidden. Rewrite in Merism naming and style.
   - Borrow **a concept Merism already serves with an existing artifact** — forbidden. Optimize the existing artifact (`scope.md`).

Every non-trivial PR description SHOULD list the references consulted plus a one-liner about how Merism differs.

## No MVP (binding)

"Ship a minimum working version, polish later" is rejected on this project. Reasons:

- A sub-spec is a contract. The acceptance criteria do not get softened in the next PR.
- An unhandled error path or concurrency hole, once merged, propagates to every consumer.
- Tests-with-implementation in the same PR is the baseline. "Tests in the next PR" is rejected at review.

The first version of every feature MUST ship with all of the following at once:

- Complete happy path.
- Identified error paths with explicit error codes (per `errors-and-observability.md`).
- Concurrency safety (per `architecture.md` Concurrency contract).
- Rollback / cleanup paths for any operation with side effects.
- Schema-level invariants (per `contracts.md`). No `z.unknown()` placeholders left "for later".
- Same-PR unit + property tests (per `testing.md`).
- Necessary trace and log instrumentation.

**Forbidden phrases** (presence is grounds to reject the PR at review):

- "暂时先这样" / "MVP 先跑通" / "先这样后面再完善"
- `// TODO: handle errors`
- `// TODO: edge cases`
- `// placeholder` / `// mock for now` on production code paths
- Any `any` or `unknown` annotated "tighten later"

**Allowed deferrals** (must be anchored to an issue or ADR linked from the PR):

- Performance optimizations under a stable contract.
- Non-blocking UI polish within `design-system.md` rules.
- Explicit future work that has an ADR or issue documenting it.

## Investigation deliverable (non-trivial PRs)

Non-trivial PRs MUST include the following in the description or in the sub-spec `design.md`:

- A short data-flow sketch (ASCII or mermaid) showing the touched chain.
- The list of upstream/downstream callers found via LSP `find_references`.
- Links to the GitHub reference implementations consulted, plus a one-liner per reference describing the difference.
- The alternatives that were considered and rejected, with one-line reasons.

## Enforcement (review discipline)

This rule has no grep hook. It is enforced in code review. A reviewer MUST request changes (not nits) when:

- A PR modifies a contract but does not list the consumers.
- A PR adds a non-trivial feature but cites no reference implementation.
- A PR contains any of the forbidden phrases above.
- A PR ships a happy path only with tests deferred.

Returning the PR to investigation is the correct action; suggesting fixes inline encourages "I'll patch it next PR" culture, which is the failure mode this rule exists to prevent.

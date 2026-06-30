# ADR-0012: Borrow engineering practices from PostHog (selectively)

- Status: Accepted
- Date: 2026-06-30
- Companion spec: `.kiro/specs/robustness-hardening/`
- Related ADRs: ADR-0001 (LiveKit Supervisor), ADR-0002 (Vercel AI SDK 6 page assistant), ADR-0006 (Workspaces / billing / usage metering)

## Context

MerismV2 is approaching production readiness for the multi-tenant cloud SaaS commitment of ADR-0006. An audit of `~/posthog/` (a mature open-source AI-enabled SaaS product in the same general shape — Django + multi-product monorepo + workflow-heavy AI surfaces) surfaced several engineering practices that:

1. We have written as **prose-only rules** in `.kiro/steering/` but never mechanically enforced.
2. We have not yet built because we haven't deployed to k8s-class infrastructure (but ADR-0006 commits us to that path).
3. We have a security gap on (Morris tools vs workspaces, post-ADR-0006).
4. We need to address before LLM-quality regressions ship to researchers (we have no eval suite).

PostHog's practices are not directly importable — they run ClickHouse / Kafka / LangChain / Django ORM, none of which we use. But the **shape** of their checks (semgrep rule pattern, MaxTool access control declaration, role-aware `/_readyz`, resource limit registry) maps cleanly onto our stack.

This ADR records the strategic decision to use PostHog as a primary engineering reference for hardening work, plus the **explicit "don't borrow" list** so future borrowings stay disciplined.

## Decision

PostHog (`~/posthog/`) becomes a **primary engineering reference** for MerismV2's robustness work, alongside the framework-specific references already established (LiveKit Agents, Vercel AI SDK 6, shadcn/ui, Appwrite). The borrowing follows `scope.md` § Borrow-or-build decision flow:

- Borrow **shape** (data structures, state machines, event names, file layout).
- Borrow **design tradeoffs** (concurrency model, rollback ordering, why-they-rejected-X reasoning).
- Borrow **test ideas** (property invariants, scorer patterns, fixture shapes).
- Do NOT borrow code verbatim — rewrite in Merism naming, conventions, and stack.
- Do NOT borrow concepts where a Merism artifact already serves the use case.
- Do NOT borrow concepts that conflict with `scope.md` permanent exclusions or existing ADRs.

The `robustness-hardening` spec defines what we borrow in Wave A (the production-blocking items) and Wave B (the scale-readiness items, as sub-specs). This ADR records what we **don't** borrow, regardless of how appealing it is.

## What we borrow (Wave A)

| Pattern | PostHog source | Merism target |
|---|---|---|
| Semgrep rules + tests for pattern-level enforcement | `.semgrep/rules/{*.yaml,tests/*.py}` | `.semgrep/rules/{*.yaml,tests/*.ts}` |
| Husky pre-commit + pre-push (branch protection) | `.husky/{pre-commit,pre-push}` | `.husky/{pre-commit,pre-push}` |
| Role-aware `/_livez` + `/_readyz` + prestop marker | `posthog/health.py` | `apps/web/app/_health/*`, `apps/agent/agent/health.py` |
| Declarative tool access control (resource + object) | `ee/hogai/README.md` § Access control + `MaxTool` | `apps/web/lib/assistant/access-control.ts` + `ToolMetadata.requiredScopes` |
| Mandatory skill invocation table in AGENTS.md | `AGENTS.md` § Mandatory skill invocation | `AGENTS.md` (new section) |

## What we borrow (Wave B, in sub-specs)

| Pattern | PostHog source | Merism target |
|---|---|---|
| TS module boundary enforcement | `tach.toml` + `pyproject.toml` (import-linter) | `.dependency-cruiser.cjs` (TS analog) |
| AI eval suite (pytest + scorers, no Braintrust) | `ee/hogai/eval/{ci,scorers}/` | `tests/evals/{cases,scorers,fixtures}/` |
| Declarative resource limit registry | `posthog/resource_limits/{registry,evaluator}.py` | `packages/contracts/src/limits.ts` + `apps/web/lib/limits/check.ts` |
| Prompt versioning + golden tests | `products/ai_observability/{frontend/playground, prompts}/` | `apps/functions/<analysis>/src/prompts/v*/` + `tests/golden/` |

## What we DO NOT borrow (binding)

These are concepts that surfaced during the audit but are explicitly rejected. Future requests to lift any of these require an ADR amendment.

### Hard architectural conflicts

| Anti-borrow | Why |
|---|---|
| **ClickHouse / Kafka / event ingestion stack** | We measure interview sessions in tens-to-hundreds per workspace per month, not billions of events. Appwrite + LiveKit are the correct stack. ADR-0006 reaffirms Appwrite as the only backend. |
| **`tach` for Python module boundaries** | `apps/agent` is a single process. The setup cost of tach exceeds the benefit; `architecture.md` + steering + `import` rules are sufficient at this scale. We adopt dependency-cruiser for TS (REQ-6 Wave B) where the surface is large enough to matter. |
| **LangChain / LangGraph** | ADR-0001 explicitly rejected LangGraph as the realtime interview controller. ADR-0002 explicitly rejected LangChain as the page-assistant runtime. Borrowing the *policy* shape (e.g., access control declaration) does not pull in the framework. |
| **Self-hosted (license keys, "hobby" deploy)** | ADR-0006 § Alternatives rejected: cloud-only deployment. |
| **`ai_events` ClickHouse table for LLM observability** | We already have `withLLMCall` + `llmObservabilityMiddleware` emitting to `createLogger`. PostHog's separate ClickHouse table exists because they have a separate **product** built on LLM events; we have an internal observability concern. Per `errors-and-observability.md` § Sink rule, no external POST sinks. |

### Scope-guard conflicts (per `scope.md`)

| Anti-borrow | `scope.md` clause |
|---|---|
| **Marketplace / template gallery** | "Public marketplace / template gallery of surveys" is permanently excluded. PostHog has shareable dashboards / notebooks; we don't. |
| **Cross-team / cross-workspace sharing** | ADR-0006 D3: read-shared inside a workspace, never cross-workspace. PostHog's sharing model is not lifted. |
| **Per-resource RBAC + custom roles** | `scope.md` § In-scope-governed-by-ADR-0006: three coarse roles only. PostHog's per-resource ACL via `posthog/rbac/user_access_control.py` is the kind of system we explicitly rejected. |
| **Multi-user collaborative editing of a single document** | Permanently excluded. PostHog's collaborative dashboards / notebooks are not lifted. |
| **Persistent interviewee accounts** | Interviewees are accountless. PostHog has end-user surveys; we have anonymous interview links via `InterviewLink`. |

### Infrastructure / scale not (yet) justified

| Anti-borrow | Triggering condition for revisit |
|---|---|
| **Selective testing via Turbo contract-file inputs** | Test suite exceeds 300 tests OR CI > 8 minutes |
| **`.test_durations`-based test sharding** | Test suite exceeds 1000 tests |
| **Dagster Cloud for offline AI eval orchestration** | Eval suite exceeds 50 cases AND nightly CI > 2 hours |
| **Braintrust / LangSmith integration** | Never — conflicts with `errors-and-observability.md` § Sink rule (no external POST sinks) |
| **Per-product facade (`backend/facade/{api,contracts}.py`) full isolation** | `apps/web/lib/` exceeds 50 files AND modules cross-import each other's internals |
| **Sandboxed subprocess runner for evals** | Eval suite exceeds 100 cases AND parallelism becomes a bottleneck |

### Behaviors we explicitly chose against

| Anti-borrow | Why we chose differently |
|---|---|
| **Block on resource limit hit** | PostHog only emits events on soft limits. We follow PostHog's "notify but don't block" for soft limits (REQ-8) and add hard-throw only for abuse vectors (e.g. 10k links/hour). Documented in `resource-limits-registry` sub-spec. |
| **Allow `try { } catch { return null }` defensively** | We reject silently-swallowed errors per `errors-and-observability.md`. PostHog has more lenient legacy patterns; we don't inherit them. |
| **Allow inline `vi.mock(path, factory)` in multiple files** | We require fixture-centralized fakes per `testing.md` § Test double pattern. Promoted to a semgrep rule (`no-inline-vi-mock-duplicate`). |
| **Allow `console.log` / `print` in app/lib source** | Forbidden per `errors-and-observability.md` § Logger contract. PostHog has stricter `structlog` in core but lenient in `tools/`. We hold the line everywhere except `scripts/`. |
| **AGENTS.md-only enforcement (without CI checks)** | The whole point of `Automation hierarchy` (in AGENTS.md) is that prose-only rules rot. We promote violations to semgrep where mechanically catchable. |
| **Husky / lint-staged for pre-commit + pre-push hooks** (PostHog `.husky/`) | Husky is a developer-experience tool, not a robustness tool. The user's original ask was "make the project robust"; local hooks don't change runtime behavior. CI is the canonical guard for typecheck / test / scope-guard; pre-commit just fails 30 seconds earlier on the laptop, which doesn't move the needle for a solo + agent-driven workflow. Pre-push main-protection is better served by **GitHub Settings → Branches → Branch protection rules** (server-side; cannot be bypassed by `--no-verify`). Net cost of husky (new dev dep, `prepare` script side-effect, new failure surface) > benefit at our scale. Decision recorded 2026-06-30. |

## Consequences

**Positive.**

- Steering rules become enforceable instead of aspirational.
- Cloud SaaS deploy gains liveness/readiness/drain semantics.
- Morris tool layer aligns with workspaces / billing security model (no more inherent member-can-do-anything gap).
- Future engineers / agents have a clear "look here for shape, here's what we explicitly didn't borrow" map.
- AI quality regression is detectable before it ships (Wave B).

**Negative.**

- One additional CI job (`semgrep`, ~3 min). One additional local hook (`pre-commit` lint-staged, ~5 sec on average commit). Acceptable per `AGENTS.md` § CI guardrails.
- A new dev-only dependency (`dependency-cruiser` in Wave B, `husky` in Wave A). Both are mature, low-risk packages.
- Two new Docker dependencies on developer machines (semgrep image, already-have LiveKit / Appwrite stack). semgrep CI mode is Docker-via-GHA, no local install required.
- `WorkspaceScope` enum becomes a public contract; expansion requires a contract change PR per `contracts.md`.

**Neutral.**

- We are now "officially" coupled to PostHog as a reference, not just a one-off mention in steering. Maintenance cost: zero (we read; they don't know we exist). Drift risk: low (we cite the file path so we can re-verify on any borrow).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Use Linear / Notion / Dovetail as primary references instead | PostHog is closer in shape (multi-product monorepo, AI-heavy, Django+TS+Python), open-source so we can read it, and uses similar engineering rigor (property tests, AGENTS.md, skills/, semgrep). |
| Build all enforcement bespoke (custom AST tooling) | Semgrep / dependency-cruiser / husky are mature; reinventing them violates the "use mature ecosystem patterns" rule in `AGENTS.md` § Coding Standards. |
| Defer all hardening until production launch | Half of `scope.md` hardening rules have already been violated locally at least once. The gap will widen, not close, with deferral. |
| Only borrow Wave A; skip Wave B entirely | Wave B addresses risks (LLM regression, module boundary drift, runaway resource creation) that grow with usage. Sub-specs deferred but not cancelled. |

## References

- Audit findings: original chat transcript that produced this ADR.
- Spec: `.kiro/specs/robustness-hardening/{requirements,design,tasks}.md`.
- Borrow-or-build governance: `.kiro/steering/scope.md` § Borrow-or-build decision flow.
- Pre-implementation discipline: `.kiro/steering/pre-implementation.md` § GitHub reference research.
- Multi-tenant context: ADR-0006.
- Realtime controller commitment: ADR-0001.
- Page assistant runtime commitment: ADR-0002.
- LLM cascade: ADR-0011.

## Review cadence

This ADR is reviewed:

- When a new pattern from PostHog (or another reference) is proposed for adoption. The "Do not borrow" list is the gate.
- When a Wave B sub-spec ships — confirm the borrow stayed within the shape declared above.
- After the first cloud production deploy — verify health/drain assumptions matched reality.

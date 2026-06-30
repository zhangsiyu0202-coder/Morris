# Sub-spec: `resource-limits-registry`

> **Status**: stub (requirements drafted; design + tasks pending scheduling).
> **Parent spec**: `.kiro/specs/robustness-hardening/` (Wave B REQ-8)
> **Created**: 2026-06-30, scheduled as Wave B during robustness-hardening planning.

## Motivation

Numeric and duration limits are scattered through the codebase as inline literals:

- `TOKEN_TTL_SECONDS = 60` (issueLivekitToken)
- `effectiveMax` derived from slot loops
- `MAX_LINK_USES = 50` (somewhere in entities or default)
- `STORAGE_BUCKET_MAX_SIZE_MB` per bucket
- LLM `maxTokens`, retry `maxAttempts`, `baseDelayMs`
- `MERISM_LLM_MAX_CONCURRENT = 8` (env-overridable, in `packages/observability`)
- prestop drain wait time, health check timeouts
- per-tier seat / interview-session quotas (workspaces-billing Wave 2)

Each lives in its declaring file with a JSDoc comment. This works for now but:

- **Audit**: there's no single place to ask "what are all the limits?". The answer is
  `grep -RIn ...` against a moving target.
- **Tuning**: changing the JWT TTL means finding every consumer (token signer, room ttl,
  participant attribute expiry). Today this is a manual grep.
- **Documentation**: customer-facing docs ("how long is an interview link valid?") must hand-copy
  from source. Drift is inevitable.
- **Testing**: tests often hardcode the same limit a second time. When the limit changes, both
  source and test must update.

PostHog's approach (`posthog/constants.py` + `posthog/models/feature_flag/feature_flag.py`'s
`get_flag_quota`) centralizes limits in one or two modules, with typed accessors. We borrow
the SHAPE — a single typed registry — but adapt naming for MerismV2 stack (TypeScript +
zod where the limit has a runtime shape; plain `as const` for pure scalars).

## Requirements

### REQ-1: Registry module

**WHAT**: a new file `packages/contracts/src/limits.ts` exporting every limit currently in
source as a typed `as const` value with JSDoc explaining (a) what it limits, (b) who consumes it,
(c) the rationale for the value, (d) the change procedure (e.g., "lower-bound is 30s; lower
breaks interviewee resume flow").

Categorization (initial cut):

```ts
export const TIME_LIMITS = {
  jwtTokenTtlSeconds: 60,              // issueLivekitToken
  interviewLinkDefaultExpiryDays: 30,
  livekitRoomEmptyTimeoutSeconds: 300,
  prestopDrainSeconds: 30,
  healthCheckTimeoutMs: 3000,
  workerShutdownGracePeriodSeconds: 60,
} as const;

export const SIZE_LIMITS = {
  maxRecordingMb: 500,
  maxTranscriptCharsPerSession: 200_000,
  maxNotebookMarkdownChars: 100_000,
  maxMemoryContentChars: 2000,
  maxMorrisMessageChars: 20_000,
} as const;

export const RATE_LIMITS = {
  llmMaxConcurrent: 8,                 // overridable by MERISM_LLM_MAX_CONCURRENT
  retryMaxAttempts: 3,
  retryBaseDelayMs: 250,
} as const;

export const COUNT_LIMITS = {
  morrisMaxToolsPerTurn: 3,
  notebookMaxQuestionsPerCreate: 10,
  surveyMaxSections: 50,
  surveyMaxQuestionsPerSection: 30,
} as const;
```

The categorization is editorial — what matters is every limit appears here once and only once.

**Acceptance**: `pnpm -F @merism/contracts typecheck` passes; the registry is exported through
`packages/contracts/src/index.ts`.

### REQ-2: Migrate every inline literal

**WHAT**: replace each inline numeric/duration literal in `apps/` and `packages/` with an
import from the registry. Tests are exempt only when they're testing a SPECIFIC limit value
(in which case they import the registry too — never duplicate the number).

**Acceptance**: a semgrep rule `no-magic-limits.yaml` (added in this sub-spec) detects new
inline numeric literals over a threshold (e.g., > 10) that should be registry constants.
This is a soft rule with WARN severity initially.

### REQ-3: Tier-band entitlements wiring

**WHAT**: workspaces-billing Wave 2 introduces plan-tier-specific quotas (Plus / Pro have
different `seatsIncluded`, `interviewSessionsPerMonth`, etc., per
`products/workspaces-billing/spec/prd-pricing.md`). Extend the registry with a `TIER_LIMITS`
shape:

```ts
export const TIER_LIMITS = {
  plus: {
    seatsIncluded: 1,
    interviewSessionsPerMonth: 30,
    maxRecordingHoursPerMonth: 10,
  },
  pro: {
    seatsIncluded: 3,
    interviewSessionsPerMonth: 200,
    maxRecordingHoursPerMonth: 50,
  },
} as const satisfies Record<PlanTier, TierLimitShape>;
```

`changePlan` / `aggregateWorkspaceUsage` / `issueLivekitToken` (entry-gate) consume this.

**Acceptance**: every consumer in `apps/functions/{changePlan,aggregateWorkspaceUsage,
issueLivekitToken}/` imports from the registry; no plan-tier numbers exist outside.

### REQ-4: Documentation generation

**WHAT**: a `pnpm docs:limits` script that reads `packages/contracts/src/limits.ts` and emits
`docs/dev/resource-limits.md` listing every limit with its JSDoc rationale, grouped by category.
This doc IS the canonical limit reference for product / support / customer-facing docs.

**Acceptance**: `pnpm docs:limits` produces a Markdown file; running it twice produces
identical output (deterministic); the generated file is committed.

### REQ-5: Python mirror

**WHAT**: `apps/agent/agent/contracts.py` mirrors the agent-needed subset (per
`contracts.md` § TS → Python mirror discipline). Agent needs at minimum:

- `LLM_MAX_CONCURRENT` (already env-driven)
- `MAX_TRANSCRIPT_CHARS_PER_SESSION`
- `WORKER_SHUTDOWN_GRACE_PERIOD_SECONDS`

Mirror as `TIME_LIMITS_*` / `SIZE_LIMITS_*` module-level constants with identical names. NO
runtime parsing — these are compile-time constants.

**Acceptance**: `pnpm test:py` passes; agent code uses `TIME_LIMITS_WORKER_SHUTDOWN_GRACE_PERIOD_SECONDS`
not `60`.

## Out of scope

- Runtime override mechanism (e.g., reading limits from Appwrite at startup, or a feature flag
  service). Today every limit is a compile-time constant or env var, and that's the right scope
  for the next 6 months. Runtime tunability needs a separate ADR.
- Per-workspace limit override. Tier limits are per-plan, not per-workspace. Custom limits per
  customer = sales-led feature = future.
- A11y limit declarations (e.g., "minimum tap target size 44px") — those belong in
  `design-system.md`, not here.

## Open questions (to resolve during design)

1. **Categorization**: TIME / SIZE / RATE / COUNT / TIER feels OK but might end up arbitrary.
   Alternative: group by surface (`TOKEN_*`, `RECORDING_*`, `LLM_*`). Decide during design;
   both work, pick the one fewer people will second-guess.
2. **Inline number threshold for the semgrep rule**: `> 10` filters out `0`/`1`/`-1`/etc. but
   also `404`/`200`/`5000`. Tighten with allow-list of common HTTP/HTTP-status/time-unit numbers,
   or just accept some false positives.
3. **Env var precedence**: today some limits (LLM_MAX_CONCURRENT) are env-overridable. Decide
   the convention: registry value = default; env var of same name = override. Make this uniform.
4. **Workspaces-billing PRD coupling**: this sub-spec partially depends on the workspaces-billing
   Wave 2 PRD landing tier values. Sequence accordingly or commit placeholder values that the
   PRD updates later.

## Scheduling notes

- **Estimated wave size**: medium. Mostly mechanical migration + JSDoc writing. ~30-50 limits
  to catalog.
- **Trigger to flesh out**: when workspaces-billing Wave 2 needs tier-band limits, or when a
  customer-facing limit doc is requested.
- **Pre-reqs**:
  - `lint-baseline-cleanup` (clean baseline; doesn't add inline-number warnings on top of
    existing WARN noise).
  - workspaces-billing Wave 2 PRD pinning tier-band values (or accept placeholder values).
- **Estimated effort**: 1-2 days for catalog + migration. 0.5 day for tier-band wiring.
- **Sequencing**: AFTER `lint-baseline-cleanup`; can run in parallel with `dependency-cruiser-boundaries`
  and `ai-eval-suite`.

## References

- Parent spec: `.kiro/specs/robustness-hardening/{requirements,design,tasks}.md` REQ-8
- Steering: `.kiro/steering/contracts.md` § Source-of-truth rule, `.kiro/steering/architecture.md` § Module map
- ADR: `docs/adr/0006-workspaces-billing.md`, `docs/adr/0012-borrow-engineering-practices-from-posthog.md`
- PostHog reference: `~/posthog/posthog/constants.py` (their centralized limit module)
- Related PRD: `products/workspaces-billing/spec/prd-pricing.md` (tier values)

# Design: `resource-limits-registry`

> **Parent**: `.kiro/specs/resource-limits-registry/requirements.md`
> **Date**: 2026-06-30
> **Status**: design complete; ready for tasks.md.

## Open question resolutions

### Q1 — Categorization: **`TIME` / `SIZE` / `COUNT` / `RATE` (not per-surface)**

Pros of category-first: alphabetical search by limit name within a category is fast; consumers can `import { TIME_LIMITS } from "@merism/contracts"` and the autocomplete shows every time-related limit at once.

Pros of per-surface (rejected): `TOKEN_*`, `RECORDING_*`, etc. would scatter related concerns across many groups; "what's the JWT TTL" needs knowing it's a TOKEN limit.

**Decision**: 4 buckets — `TIME_LIMITS`, `SIZE_LIMITS`, `COUNT_LIMITS`, `RATE_LIMITS`. Each is a `as const` object. The bucket name is editorial — what matters is every limit appears once.

`TIER_LIMITS` deferred per Q2.

### Q2 — workspaces-billing tier values: **out of scope for this sub-spec**

`TIER_LIMITS` (per-plan entitlements like `seatsIncluded`, `interviewSessionsPerMonth`) requires the workspaces-billing Wave 2 PRD to pin actual values, AND the existing `apps/functions/changePlan/`, `aggregateWorkspaceUsage/` already encode tier values in their own deps modules. Re-centralizing them touches a different blast radius than the time/size/count/rate cleanup this sub-spec covers.

**Decision**: ship REQ-1 + REQ-2 (partial migration) + REQ-5 (Python mirror). Defer REQ-3 (tier) to a follow-up sub-spec `tier-entitlements-registry` that lands after workspaces-billing Wave 2.

### Q3 — Env var precedence: **registry value = compile-time default; env var of same name = runtime override; both registered**

Today `MERISM_LLM_MAX_CONCURRENT` overrides `DEFAULT_MAX = 8`. The pattern is good — explicit + auditable. Generalize:

For every limit that supports env override, the limit's JSDoc states the env var name. The registry function-form (`getLlmMaxConcurrent()` not `LLM_MAX_CONCURRENT`) reads env at call site, falls back to compile-time default. This stays uniform with how `MERISM_DEBUG_PROVIDERS` etc. work.

**Convention**: limits that are compile-time constants → exported as `as const` directly. Limits that accept env overrides → exported as a `get<Name>()` function + a `DEFAULT_<NAME>` constant. The JSDoc on the function names the env var.

### Q4 — Semgrep rule for new inline literals: **out of scope for this sub-spec**

The requirements.md REQ-2 mentions a `no-magic-limits.yaml` semgrep rule. In practice, distinguishing "magic limit number" from "ordinary number" (HTTP status codes, time-unit constants, retry indices) is hard. A rule with too many false positives erodes signal.

**Decision**: skip the rule. The PR review process catches it: when a PR introduces a numeric literal that looks like a limit, the reviewer asks "registry?". Skip wave-after-wave until we accumulate enough drift to make it worth a focused rule.

### Q5 — Default migration depth: **clear time/size/count literals only; skip "happens to be a number" ones**

Migrate when:
- The literal IS a documented business limit (TTL, max size, default cap).
- Multiple call sites use the same value, or could in the future.
- The value should be reviewable in one place (compliance / SRE / sales-facing).

Don't migrate:
- HTTP status codes (`200`, `400`, `500`).
- Time-unit constants in computation (`60 * 1000` inside `parseDate`).
- Test-only values (test fixtures keep their own constants).
- Indices, lengths-of-arrays-being-iterated, math constants.

## Initial registry (Phase A)

```ts
// packages/contracts/src/limits.ts
export const TIME_LIMITS = {
  /** LiveKit JWT TTL for interviewee tokens. Req 3.6: <= 30 min. */
  jwtTokenTtlSeconds: 30 * 60,

  /** Time before an unjoined interview session is reclaimable as orphan.
   * MUST exceed jwtTokenTtlSeconds so the original token has expired. */
  reclaimGraceSeconds: 30 * 60 + 60,

  /** Workspace trial duration (14-day Plus/Pro trial, per prd-pricing.md). */
  workspaceTrialMs: 14 * 24 * 60 * 60 * 1000,

  /** Health probe upstream-check timeout. Configurable via MERISM_HEALTH_TIMEOUT_MS. */
  healthCheckTimeoutMs: 3_000,

  /** OTP code lifetime in researcher auth. */
  otpTtlMs: 15 * 60 * 1000,

  /** Page-assistant title generation retry delay on transient failure. */
  conversationTitleRetryDelayMs: 5_000,

  /** Browser-side interview-token request timeout. */
  interviewTokenRequestTimeoutMs: 15_000,
} as const;

export const SIZE_LIMITS = {
  /** Gemini Files API single-upload byte ceiling (2 GB). */
  geminiUploadMaxBytes: 2 * 1024 * 1024 * 1024,

  /** Per-field truncation length on page-assistant context summarization. */
  agentContextFieldMaxChars: 200,
} as const;

export const COUNT_LIMITS = {
  /** Max segments produced per analyzeSessionVisual job. */
  geminiVisualMaxSegments: 30,

  /** Parallelism per analyzeSessionVisual job (concurrent Gemini calls). */
  geminiVisualSegmentParallelism: 4,
} as const;

export const RATE_LIMITS = {
  /** Default LLM concurrent-call cap (per-process). Override via MERISM_LLM_MAX_CONCURRENT. */
  llmMaxConcurrentDefault: 8,
} as const;

// Env-aware getter for the one limit with a runtime override.
export function getLlmMaxConcurrent(): number {
  const raw = process.env.MERISM_LLM_MAX_CONCURRENT;
  if (!raw) return RATE_LIMITS.llmMaxConcurrentDefault;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : RATE_LIMITS.llmMaxConcurrentDefault;
}
```

Total: 12 limits in the initial registry. Each has JSDoc + ownership reference.

## Migration target sites (Phase B)

Sites listed in `requirements.md` § Motivation that move to the registry:

| Current site | Current literal | New import |
|---|---|---|
| `apps/functions/issueLivekitToken/src/handler.ts::TOKEN_TTL_SECONDS` | `30 * 60` | `TIME_LIMITS.jwtTokenTtlSeconds` |
| `apps/functions/issueLivekitToken/src/handler.ts::RECLAIM_GRACE_SECONDS` | `TOKEN_TTL_SECONDS + 60` | `TIME_LIMITS.reclaimGraceSeconds` |
| `apps/functions/createWorkspace/src/deps.ts::TRIAL_MS` | inline | `TIME_LIMITS.workspaceTrialMs` |
| `scripts/migrate-default-workspaces.ts::TRIAL_MS` | inline | `TIME_LIMITS.workspaceTrialMs` |
| `apps/web/lib/health/checks.ts::DEFAULT_TIMEOUT_MS` | `3_000` | `TIME_LIMITS.healthCheckTimeoutMs` |
| `apps/web/lib/auth/actions.ts::OTP_TTL_MS` | inline | `TIME_LIMITS.otpTtlMs` |
| `apps/web/lib/conversations/title.ts::TITLE_RETRY_DELAY_MS` | `5_000` | `TIME_LIMITS.conversationTitleRetryDelayMs` |
| `apps/web/lib/interview/issue-token.ts::TOKEN_TIMEOUT_MS` | `15_000` | `TIME_LIMITS.interviewTokenRequestTimeoutMs` |
| `apps/functions/analyzeSessionVisual/src/gemini-visual-analyzer.ts::DEFAULT_MAX_BYTES` | `2 * 1024**3` | `SIZE_LIMITS.geminiUploadMaxBytes` |
| `apps/functions/analyzeSessionVisual/src/video-segments.ts::DEFAULT_MAX_SEGMENTS` | `30` | `COUNT_LIMITS.geminiVisualMaxSegments` |
| `apps/functions/analyzeSessionVisual/src/gemini-visual-analyzer.ts::DEFAULT_SEGMENT_PARALLELISM` | `4` | `COUNT_LIMITS.geminiVisualSegmentParallelism` |
| `apps/web/lib/assistant/agent-context.ts::MAX_FIELD_LENGTH` | `200` | `SIZE_LIMITS.agentContextFieldMaxChars` |
| `packages/observability/src/concurrency.ts::DEFAULT_MAX` | `8` | `RATE_LIMITS.llmMaxConcurrentDefault` + `getLlmMaxConcurrent()` |

13 sites migrated. After migration, each file's local constant goes away (replaced by registry import); the registry IS the single source of truth.

## Python mirror (Phase C)

Per `contracts.md` § TS → Python mirror discipline, the Python mirror in `apps/agent/agent/contracts.py` carries ONLY the limits the agent uses today:

```python
# Module-level constants mirroring packages/contracts/src/limits.ts.
# Names match TS camelCase to avoid drift; field names are byte-identical
# per the mirror contract.

TIME_LIMITS_jwt_token_ttl_seconds = 30 * 60      # mirrors TIME_LIMITS.jwtTokenTtlSeconds
TIME_LIMITS_reclaim_grace_seconds = 30 * 60 + 60 # mirrors TIME_LIMITS.reclaimGraceSeconds

# NOTE: workspaceTrialMs / otpTtlMs / health* / agentContext* / gemini* /
# llmMaxConcurrent are TS-only; the agent does not use these surfaces.
# Mirror when needed.
```

Note: Python uses snake_case **within the variable name** because Python convention demands it. The field IDENTIFIER is what's mirrored (`jwtTokenTtlSeconds`), not the variable name. This is a deliberate exception to "byte-identical mirror" — the alternative ("don't have Python access at all") is worse.

Actually re-reading `contracts.md`: "Field names are identical, no snake_case rename." The constants here aren't fields of a model; they're module-level constants. Convention is less strict. Use Python-natural names that include the registry path in a comment.

## Out of scope (per Q2 / Q4)

- `TIER_LIMITS` per-plan entitlements (workspaces-billing Wave 2 dep)
- Semgrep `no-magic-limits.yaml` rule
- Doc generation script (manual `JSDoc` in limits.ts is enough for now)

## Risks

1. **Tree-shaking impact**: importing `TIME_LIMITS` brings the whole object. For Node-side / SSR code this is fine. For client bundles, modern bundlers tree-shake `as const` object accessors well, but worth verifying once with `pnpm build` after migration.

2. **Magic-number false positives**: if I later add a semgrep rule for inline numbers > 10 (rejected per Q4), `HTTP 200/400/500` would trip it. Skip.

3. **JSDoc drift**: limits.ts is the canonical reference, but if a consumer's JSDoc says "TTL is 5 min" inline and the registry says 30 min, the inline doc lies silently. Mitigation: forbid duplicating limit values in consumer JSDoc; reference the registry name instead.

4. **Python mirror drift**: same drift risk as every TS→Python mirror. The mirror has a comment block listing TS limits not yet mirrored; add to the mirror when the agent code grows to need them.

## References

- Parent: `.kiro/specs/resource-limits-registry/requirements.md`
- Steering: `.kiro/steering/contracts.md` § Source-of-truth + TS → Python mirror discipline
- ADR: `docs/adr/0006-workspaces-billing.md` (tier values stay there for now)
- PostHog reference: `~/posthog/posthog/constants.py` (centralized constants module)

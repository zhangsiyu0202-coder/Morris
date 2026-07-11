# Tasks: `resource-limits-registry`

> **Parent**: `.kiro/specs/resource-limits-registry/{requirements,design}.md`
> Single PR (~1.5 days). Tier limits (REQ-3) + doc-gen (REQ-4) + semgrep
> rule deferred per design.md § Q2/Q4.

## Phase A — registry module + tests

- **A.1** Create `packages/contracts/src/limits.ts` with the 4-bucket
  registry shape (TIME / SIZE / COUNT / RATE). Use `as const` for each
  bucket. Each limit has JSDoc explaining (a) purpose, (b) origin, (c)
  env override if any.

- **A.2** Add `getLlmMaxConcurrent()` env-aware getter alongside
  `RATE_LIMITS.llmMaxConcurrentDefault`. Document the env var
  (`MERISM_LLM_MAX_CONCURRENT`) in JSDoc + add to
  `errors-and-observability.md` § Feature flags / env toggles table.

- **A.3** Export everything via `packages/contracts/src/index.ts` so
  consumers can `import { TIME_LIMITS } from "@merism/contracts"`.

- **A.4** Property test in `packages/contracts/test/limits.test.ts`:
  - Every numeric value is `> 0`.
  - Every "ttl"/"timeout"-named limit is in milliseconds OR seconds
    (validate naming convention: `*Seconds` ends in seconds, `*Ms` in
    milliseconds — units in the name, no ambiguity).
  - `getLlmMaxConcurrent()` parses env correctly: returns default for
    unset/invalid; returns parsed int for valid positive; rejects
    `"0"`, `"-1"`, `"abc"`.

**Acceptance**: `pnpm -F @merism/contracts test` passes; `pnpm -F @merism/contracts build` regenerates dist with the new module.

## Phase B — migrate 13 inline literals

> Each task = one file. Tasks B.1 – B.13 are independent and can be done in any order.

- **B.1** `apps/functions/issueLivekitToken/src/handler.ts` —
  `TOKEN_TTL_SECONDS` + `RECLAIM_GRACE_SECONDS` → registry imports.
  Keep the local re-export name so downstream code reading these from
  the handler module doesn't break.
- **B.2** `apps/functions/createWorkspace/src/deps.ts` —
  `TRIAL_MS` → `TIME_LIMITS.workspaceTrialMs`.
- **B.3** `scripts/migrate-default-workspaces.ts` — same.
- **B.4** `apps/web/lib/health/checks.ts` —
  `DEFAULT_TIMEOUT_MS` → `TIME_LIMITS.healthCheckTimeoutMs`.
- **B.5** `apps/web/lib/auth/actions.ts` —
  `OTP_TTL_MS` → `TIME_LIMITS.otpTtlMs`.
- **B.6** `apps/web/lib/conversations/title.ts` —
  `TITLE_RETRY_DELAY_MS` → `TIME_LIMITS.conversationTitleRetryDelayMs`.
- **B.7** `apps/web/lib/interview/issue-token.ts` —
  `TOKEN_TIMEOUT_MS` → `TIME_LIMITS.interviewTokenRequestTimeoutMs`.
- **B.8** `apps/functions/analyzeSessionVisual/src/gemini-visual-analyzer.ts` —
  `DEFAULT_MAX_BYTES` → `SIZE_LIMITS.geminiUploadMaxBytes`;
  `DEFAULT_SEGMENT_PARALLELISM` → `COUNT_LIMITS.geminiVisualSegmentParallelism`.
- **B.9** `apps/functions/analyzeSessionVisual/src/video-segments.ts` —
  `DEFAULT_MAX_SEGMENTS` → `COUNT_LIMITS.geminiVisualMaxSegments`.
- **B.10** `apps/web/lib/assistant/agent-context.ts` —
  `MAX_FIELD_LENGTH` → `SIZE_LIMITS.agentContextFieldMaxChars`.
- **B.11** `packages/observability/src/concurrency.ts` —
  `DEFAULT_MAX` → `RATE_LIMITS.llmMaxConcurrentDefault`; replace env
  parsing with `getLlmMaxConcurrent()`.

**Acceptance**: `pnpm typecheck && pnpm test` green; grep for the old
constant names in the migrated files returns no hits (constants
deleted in their old homes).

## Phase C — Python mirror

- **C.1** `apps/agent/agent/contracts.py` — add module-level constants
  for the limits the agent uses. Per design.md § Phase C: today only
  `jwt_token_ttl_seconds` and `reclaim_grace_seconds`. Add a comment
  block listing TS-only limits the agent doesn't yet consume.

- **C.2** Grep `apps/agent/agent/` for inline literals matching the
  mirrored TS values (e.g. `30 * 60` in a TTL context). Replace with
  the mirror constant.

**Acceptance**: `pnpm test:py` green; the mirror comment block lists
every TS-only limit explicitly.

## Phase D — docs + steering

- **D.1** Update `.kiro/steering/errors-and-observability.md` § Feature
  flags / env toggles table: add `MERISM_LLM_MAX_CONCURRENT` cross-ref
  to the limits registry (it's documented in both places — registry is
  authoritative for value, env table is authoritative for flag presence).

- **D.2** Update `README.md` sub-spec roadmap: mark
  `resource-limits-registry` ✅ done.

- **D.3** Update ADR-0012 "Wave A outcomes" / "Wave B outcomes" section
  with a one-line entry: "2026-06-30: resource-limits-registry shipped;
  13 inline literals consolidated to `packages/contracts/src/limits.ts`;
  TIER_LIMITS deferred to a follow-up sub-spec post-workspaces-billing
  Wave 2."

**Acceptance**: docs cross-reference resolve; ADR-0012 audit trail
extends one line.

## Final verification

```bash
pnpm -F @merism/contracts test    # registry property tests
pnpm test                          # green
pnpm typecheck                     # green
pnpm test:py                       # green (Python mirror in use)
pnpm scope-guard                   # OK
pnpm semgrep                       # 0 ERROR findings
pnpm deps:cruise                   # 0 violations (cruiser still happy)
```

## Commit plan

Single commit:

```
feat(contracts): centralize 13 limits in TIME/SIZE/COUNT/RATE registry
```

Body: spec link + Phase A/B/C/D counts + deferred items.

## Out-of-PR follow-ups

- **`tier-entitlements-registry`** sub-spec: post-workspaces-billing
  Wave 2. Encodes per-plan quotas (seats included, sessions/month,
  recording hours).
- **Doc-gen script**: if customer-facing docs need the limits, write
  a separate `scripts/docs/limits.ts` that emits markdown. Not needed
  while limits.ts JSDoc is the canonical reference.
- **`no-magic-limits.yaml` semgrep rule**: defer; revisit when the
  registry gets a 3rd round of additions and we have enough drift
  pattern to make the rule cheap.

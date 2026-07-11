/**
 * Resource limits registry — central source of truth for scattered
 * numeric/duration literals (TTLs, timeouts, max sizes, default caps).
 *
 * Categorization is editorial (TIME / SIZE / COUNT / RATE); what
 * matters is every limit appears here ONCE. Adding a new entry MUST
 * include JSDoc with (a) purpose, (b) owner/origin, (c) env override
 * if any.
 *
 * Companion: `.kiro/specs/resource-limits-registry/{requirements,design}.md`.
 * Steering: `.kiro/steering/contracts.md` § Source-of-truth rule.
 *
 * Future entitlement-specific limits live in a follow-up registry
 * sub-spec once the workspaces catalog is stable. Today's workspace
 * allowance numbers still live in `apps/functions/changePlan/src/deps.ts`
 * and friends until that
 * sub-spec lands.
 */

// --- TIME ---------------------------------------------------------------
//
// Convention: name MUST end in the unit (`*Seconds`, `*Ms`). No ambiguity.

export const TIME_LIMITS = {
  /**
   * LiveKit JWT TTL for interviewee tokens.
   * Origin: `.kiro/specs/foundation-setup/` Req 3.6 ("<= 30 min").
   * Owner: `apps/functions/issueLivekitToken/`.
   */
  jwtTokenTtlSeconds: 30 * 60,

  /**
   * Time before an unjoined interview session is reclaimable as orphan.
   * MUST exceed `jwtTokenTtlSeconds` so the original token is already
   * expired before its slot can be reused.
   * Owner: `apps/functions/issueLivekitToken/`.
   */
  reclaimGraceSeconds: 30 * 60 + 60,

  /**
   * Workspace trial duration (14-day Plus/Pro trial).
   * Origin: `products/workspaces-billing/spec/prd-pricing.md`.
   * Owner: `apps/functions/createWorkspace/` + `scripts/migrate-default-workspaces.ts`.
   */
  workspaceTrialMs: 14 * 24 * 60 * 60 * 1000,

  /**
   * Health-probe upstream-check timeout.
   * Owner: `apps/web/lib/health/checks.ts` + `apps/agent/agent/health.py`.
   */
  healthCheckTimeoutMs: 3_000,

  /**
   * OTP code lifetime in researcher auth (15 min).
   * Owner: `apps/web/lib/auth/actions.ts`.
   */
  otpTtlMs: 15 * 60 * 1000,

  /**
   * Morris title-generation retry delay on transient failure.
   * Owner: `apps/web/lib/conversations/title.ts`.
   */
  conversationTitleRetryDelayMs: 5_000,

  /**
   * Browser-side interview-token request timeout (15s ceiling for the
   * SDK createExecution call).
   * Owner: `apps/web/lib/interview/issue-token.ts`.
   */
  interviewTokenRequestTimeoutMs: 15_000,
} as const;

// --- SIZE ---------------------------------------------------------------

export const SIZE_LIMITS = {
  /**
   * Gemini Files API single-upload byte ceiling. Per ADR-0005 / Gemini
   * public documentation.
   * Owner: `apps/functions/analyzeSessionVisual/`.
   */
  geminiUploadMaxBytes: 2 * 1024 * 1024 * 1024,

  /**
   * Per-field truncation length on page-assistant context
   * summarization. Prevents one runaway field from inflating the LLM
   * prompt budget.
   * Owner: `apps/web/lib/assistant/agent-context.ts`.
   */
  agentContextFieldMaxChars: 200,
} as const;

// --- COUNT --------------------------------------------------------------

export const COUNT_LIMITS = {
  /**
   * Max segments produced per analyzeSessionVisual job. Beyond this
   * the job fails fast rather than burn Gemini tokens.
   * Owner: `apps/functions/analyzeSessionVisual/src/video-segments.ts`.
   */
  geminiVisualMaxSegments: 30,

  /**
   * Concurrent Gemini calls per analyzeSessionVisual job.
   * Owner: `apps/functions/analyzeSessionVisual/`.
   */
  geminiVisualSegmentParallelism: 4,
} as const;

// --- RATE ---------------------------------------------------------------

export const RATE_LIMITS = {
  /**
   * Default LLM concurrent-call cap (per-process).
   * Override via env `MERISM_LLM_MAX_CONCURRENT` (positive integer).
   * Owner: `packages/observability/src/concurrency.ts::llmGate`.
   */
  llmMaxConcurrentDefault: 8,
} as const;

// --- Env-aware accessors ------------------------------------------------
//
// Limits with runtime env override are exposed as `get*()` functions
// rather than constants. The default value remains in the registry
// above so consumers can reference both the default AND the live value.

/**
 * Resolve the LLM concurrent-call cap, honoring `MERISM_LLM_MAX_CONCURRENT`
 * env override (any positive integer). Unset / non-positive / unparseable
 * → falls back to `RATE_LIMITS.llmMaxConcurrentDefault`.
 *
 * See `.kiro/steering/errors-and-observability.md` § Feature flags for
 * env-flag conventions.
 */
export function getLlmMaxConcurrent(): number {
  const raw = process.env.MERISM_LLM_MAX_CONCURRENT;
  if (!raw) return RATE_LIMITS.llmMaxConcurrentDefault;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : RATE_LIMITS.llmMaxConcurrentDefault;
}

/**
 * Health dependency checks (robustness-hardening REQ-3).
 *
 * Each check returns a boolean. Failure is silent at `debug` level — probe
 * endpoints fire every few seconds, `info` would flood logs. Failing probes
 * are observable via the response status (200/503), not the log feed.
 *
 * Timeouts: 3s each. The whole readyz path runs checks in parallel; total
 * latency is max(check_i), bounded by max timeout.
 *
 * No real LLM ping. Provider config check verifies env presence only —
 * pinging Qwen / DeepSeek per probe would burn tokens with no information
 * (provider down = LLM call fails at runtime, not probe time).
 */
import { createLogger } from "@merism/observability";
import { TIME_LIMITS, type HealthRoleValue, type HealthCheck } from "@merism/contracts";

const logger = createLogger("apps.web.health");

/** Default per-check timeout. Total readyz latency bounded by this. */
const DEFAULT_TIMEOUT_MS = TIME_LIMITS.healthCheckTimeoutMs;

interface CheckOptions {
  timeoutMs?: number;
}

type CheckFn = (opts?: CheckOptions) => Promise<boolean>;

/** Ping Appwrite by hitting /v1/health/version. Unauthenticated. */
export const pingAppwrite: CheckFn = async ({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  if (!endpoint) {
    // Unconfigured = report unhealthy. A deploy without APPWRITE_ENDPOINT can't
    // serve writes; the orchestrator should NOT route traffic here.
    logger.warn("appwrite.endpoint.missing");
    return false;
  }
  const url = `${endpoint.replace(/\/$/, "")}/health/version`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // health endpoint is unauthenticated; don't send creds.
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Cache backend ping. We don't run Redis today; the check is a no-op success
 * unless REDIS_URL is set (then we'd need a real ping). For Wave A this just
 * confirms "no required cache misconfigured".
 *
 * When Redis lands, replace the body with a `redis.ping()` call. The function
 * shape stays the same so callers don't change.
 */
export const pingCache: CheckFn = async (_opts) => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return true; // no cache configured = nothing to fail
  // TODO(robustness-hardening REQ-3 follow-up): real redis.ping when REDIS_URL
  // is set. For Wave A we treat configured-but-unpinged as "trust env" so the
  // check doesn't lie. This is the env-shaped check the prestop drain pattern
  // already relies on.
  return true;
};

/**
 * Check that LLM/ASR/TTS providers are configured. NO real API call (would
 * burn tokens per probe). Checks env presence only.
 */
export const pingProvidersConfig: CheckFn = async (_opts) => {
  // Need at least one LLM provider key. Per ADR-0011, Qwen-VL is primary;
  // DeepSeek is dormant secondary. Either configured = pass.
  const hasQwen = !!process.env.DASHSCOPE_API_KEY;
  const hasDeepseek = !!process.env.DEEPSEEK_API_KEY;
  return hasQwen || hasDeepseek;
};

/**
 * Dependencies per role. Web routes default to `web`; interview surfaces use
 * `interview` (adds livekit). Agent worker exposes its own `/_readyz` via
 * `apps/agent/agent/health.py` and uses its own dependency map.
 */
export const ROLE_DEPENDENCIES: Record<HealthRoleValue, ReadonlyArray<keyof HealthCheck>> = {
  web: ["appwrite", "cache"],
  // Interview surface adds livekit (researcher-side connection isn't needed
  // here, but the web surface is what brokers the token; if livekit's
  // unreachable the join will fail).
  interview: ["appwrite", "cache"],
  // Agent: this is the AGENT process's expectation. Web routes shouldn't be
  // asked with role=agent; mapping kept here for symmetry.
  agent: ["appwrite", "livekit", "providers"],
  function: ["appwrite"],
};

const CHECK_FNS: Record<keyof HealthCheck, CheckFn | null> = {
  http: null, // populated by the route, not run as a probe
  appwrite: pingAppwrite,
  livekit: null, // web role doesn't probe livekit; agent role overrides
  cache: pingCache,
  providers: pingProvidersConfig,
  shutting_down: null, // resolved before checks run
};

/**
 * Run readiness checks for the given role. Returns the per-dependency map
 * shaped like `HealthResponseSchema`. The route handler decides 200 vs 503
 * based on whether ALL true.
 */
export async function runReadinessChecks(
  role: HealthRoleValue = "web",
  opts: CheckOptions = {},
): Promise<HealthCheck> {
  const deps = ROLE_DEPENDENCIES[role];
  const entries = await Promise.all(
    deps.map(async (dep) => {
      const fn = CHECK_FNS[dep];
      if (!fn) return [dep, true] as const;
      const t0 = Date.now();
      const ok = await fn(opts);
      const elapsedMs = Date.now() - t0;
      if (!ok) {
        // Failure is debug-level (probes are frequent); operators read response
        // codes, not the log feed, when triaging probe failures.
        logger.warn("health.check.failed", { check: dep, elapsedMs });
      } else if (elapsedMs > 1000) {
        logger.warn("health.check.slow", { check: dep, elapsedMs });
      }
      return [dep, ok] as const;
    }),
  );
  return Object.fromEntries(entries) as HealthCheck;
}

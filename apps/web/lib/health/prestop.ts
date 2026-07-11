/**
 * Prestop marker reader (robustness-hardening REQ-3).
 *
 * k8s `preStop` hook writes a marker file (default `/tmp/merism.prestop`).
 * When present, `/_health/readyz` returns 503 immediately so the orchestrator
 * stops routing traffic. Already in-flight requests continue (drain window).
 *
 * Env flag `MERISM_PRESTOP_MARKER_FILE` (registered in
 * `.kiro/steering/errors-and-observability.md` § Feature flags). Unset =
 * disable the check (safe default per the env-flag rule).
 *
 * Uses `fs.existsSync` because Next.js route handlers can be sync-friendly for
 * very fast paths, and the probe budget is < 10ms total per call.
 */
import { existsSync } from "node:fs";

/** Default marker location; matches the k8s manifest sample in design.md. */
export const DEFAULT_PRESTOP_MARKER = "/tmp/merism.prestop";

/**
 * True iff the configured prestop marker file currently exists. Returns false
 * unconditionally when no env is set (no marker → no drain → normal probe).
 */
export function isShuttingDown(): boolean {
  const path = process.env.MERISM_PRESTOP_MARKER_FILE;
  if (path === undefined || path === "") return false;
  try {
    return existsSync(path);
  } catch {
    // EACCES or similar — fail safe (treat as NOT shutting down so an
    // unreadable marker doesn't accidentally drain all pods).
    return false;
  }
}

/**
 * Exported for tests. Returns the resolved path the check would inspect.
 * Useful for the tasks.md verify step ("touch $path then curl readyz").
 */
export function getPrestopMarkerPath(): string | null {
  const path = process.env.MERISM_PRESTOP_MARKER_FILE;
  if (path === undefined || path === "") return null;
  return path;
}

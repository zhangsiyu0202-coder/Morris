import { z } from "zod";

/**
 * Health endpoint contracts (robustness-hardening REQ-3).
 *
 * Both Web (`apps/web/app/_health/*`) and Agent
 * (`apps/agent/agent/health.py`) emit responses in this shape so a single
 * k8s manifest can probe either with the same expectations.
 *
 * Design notes (binding):
 *  - NO `traceId` field. Probe endpoints fire every few seconds; leaking a
 *    server identifier on every probe is an info-leak per
 *    `errors-and-observability.md` § Logger contract. Failing probes already
 *    have the failure cause in the server log keyed by request time.
 *  - Booleans only. No counts, no error messages, no env values. Probes are
 *    a binary signal — orchestrator routes on 200/503, not on body content.
 *  - One field per backing dependency that the probe actually checked. A
 *    missing field means "the role didn't ask me to check this".
 *  - `shutting_down` short-circuits all other checks (k8s preStop drain).
 */

/** Allowed `?role=` values on the readyz endpoint. */
export const HealthRoleSchema = z.enum(["web", "interview", "agent", "function"]);
export type HealthRoleValue = z.infer<typeof HealthRoleSchema>;

/**
 * Per-dependency check result, plus the drain flag. All fields are optional
 * because the set actually populated depends on the role: `web` checks
 * Appwrite + cache, `agent` checks LiveKit + Appwrite, etc. Absent = not
 * asked for; never "unknown".
 */
export const HealthCheckSchema = z.object({
  /** Always true on `/_livez`. Optional on `/_readyz` (some readyz roles don't include http). */
  http: z.boolean().optional(),
  /** Appwrite connectivity ping. */
  appwrite: z.boolean().optional(),
  /** LiveKit websocket connectivity (agent + web/interview roles). */
  livekit: z.boolean().optional(),
  /** Cache backend (Redis when configured). */
  cache: z.boolean().optional(),
  /** Provider config loaded — checks env presence, NOT real API calls. */
  providers: z.boolean().optional(),
  /**
   * Set when the prestop marker file exists. Other check fields are NOT
   * populated when shutting_down=true; the orchestrator should pull the pod
   * out of rotation regardless of other dependency state.
   */
  shutting_down: z.boolean().optional(),
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;

/** Wire shape returned by both /_livez and /_readyz. */
export const HealthResponseSchema = HealthCheckSchema;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

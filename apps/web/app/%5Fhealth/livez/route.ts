/**
 * Liveness probe (robustness-hardening REQ-3 Task 2.2).
 *
 * Returns 200 unconditionally as long as the JS runtime is responsive. NO
 * dependency checks, NO traceId, NO secrets in the body. k8s `livenessProbe`
 * hits this; if it ever returns non-200 the pod is restarted.
 *
 * Distinct from `/_health/readyz`: livez says "process is up", readyz says
 * "process can serve traffic right now".
 */
import { NextResponse } from "next/server";
import type { HealthResponse } from "@merism/contracts";

// Force dynamic so this is never statically optimized into a 200-with-cached-body.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse<HealthResponse>> {
  return NextResponse.json({ http: true }, { status: 200 });
}

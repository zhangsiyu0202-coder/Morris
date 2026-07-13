/**
 * Readiness probe (robustness-hardening REQ-3 Task 2.2).
 *
 * Returns:
 *  - 200 + per-dependency boolean map when ALL checked deps are healthy.
 *  - 503 + `{ shutting_down: true }` when the prestop marker exists
 *    (k8s preStop drain). Other checks are short-circuited.
 *  - 503 + per-dependency map when ANY check failed.
 *
 * Accepts `?role=web|interview` to scope the dependency set. Defaults to
 * `web`. Unknown roles → 400 (so a typo'd manifest is loud, not silent).
 *
 * Response body shape is `HealthResponseSchema` (packages/contracts/src/
 * health.ts). NO `traceId` field — probe responses must not leak server
 * identifiers per `errors-and-observability.md` § Logger contract.
 */
import { NextRequest, NextResponse } from "next/server";

import {
  HealthRoleSchema,
  type HealthResponse,
  type HealthRoleValue,
} from "@merism/contracts";

import { isShuttingDown } from "@/lib/health/prestop";
import { runReadinessChecks } from "@/lib/health/checks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse<HealthResponse | { error: string }>> {
  // 1. Drain takes precedence over every other check.
  if (isShuttingDown()) {
    return NextResponse.json({ shutting_down: true }, { status: 503 });
  }

  // 2. Parse role, default to web. Unknown role = 400.
  const roleParam = req.nextUrl.searchParams.get("role");
  let role: HealthRoleValue = "web";
  if (roleParam !== null) {
    const parsed = HealthRoleSchema.safeParse(roleParam);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_role" }, { status: 400 });
    }
    role = parsed.data;
  }

  // 3. Run dependency checks in parallel.
  const results = await runReadinessChecks(role);
  const allOk = Object.values(results).every(Boolean);

  return NextResponse.json(results, { status: allOk ? 200 : 503 });
}

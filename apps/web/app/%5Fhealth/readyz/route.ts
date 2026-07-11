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
  if (isShuttingDown()) {
    return NextResponse.json({ shutting_down: true }, { status: 503 });
  }

  const roleParam = req.nextUrl.searchParams.get("role");
  let role: HealthRoleValue = "web";
  if (roleParam !== null) {
    const parsed = HealthRoleSchema.safeParse(roleParam);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_role" }, { status: 400 });
    }
    role = parsed.data;
  }

  const results = await runReadinessChecks(role);
  const allOk = Object.values(results).every(Boolean);
  return NextResponse.json(results, { status: allOk ? 200 : 503 });
}

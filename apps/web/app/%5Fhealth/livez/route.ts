import { NextResponse } from "next/server";
import type { HealthResponse } from "@merism/contracts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse<HealthResponse>> {
  return NextResponse.json({ http: true }, { status: 200 });
}

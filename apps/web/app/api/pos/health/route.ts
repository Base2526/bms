import { NextResponse } from "next/server";
import { checkPosRuntimeHealth } from "@/lib/bms/posRuntimeHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await checkPosRuntimeHealth();
  return NextResponse.json(health, {
    status: health.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}

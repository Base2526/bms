import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { listRetailLocalInstallations } from "@/lib/bms/retailLocalInstallations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const auth = await authorizePlatformAdminRoute();
  const headers = { "Cache-Control": "no-store" };
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status, headers });
  try { return NextResponse.json(await listRetailLocalInstallations(request.nextUrl.searchParams), { headers }); }
  catch { return NextResponse.json({ error: "installation_registry_unavailable" }, { status: 503, headers }); }
}

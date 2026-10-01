import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { listInstallerReports } from "@/lib/bms/installerReports";
import { InstallerReportError } from "@/lib/bms/installerReportFormat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const auth = await authorizePlatformAdminRoute();
  const headers = { "Cache-Control": "no-store" };
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status, headers });
  try { return NextResponse.json(await listInstallerReports(request.nextUrl.searchParams), { headers }); }
  catch (error) {
    if (error instanceof InstallerReportError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    return NextResponse.json({ error: "reports_unavailable" }, { status: 503, headers });
  }
}

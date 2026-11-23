import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { getInstallerReport, updateInstallerReport } from "@/lib/bms/installerReports";
import { InstallerReportError, readInstallerReportBody } from "@/lib/bms/installerReportFormat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function isSameOrigin(request: NextRequest): boolean {
  const firstHeader = (value: string | null) => (value || "").split(",", 1)[0].trim();
  const origin = firstHeader(request.headers.get("origin"));
  const host = firstHeader(request.headers.get("x-forwarded-host")) || firstHeader(request.headers.get("host"));
  const protocol = firstHeader(request.headers.get("x-forwarded-proto"))
    || new URL(request.url).protocol.slice(0, -1);
  return Boolean(origin && host && ["http", "https"].includes(protocol)
    && origin === `${protocol}://${host}`);
}
async function handle(request: NextRequest, { params }: { params: Promise<{ id: string }> }, update: boolean) {
  const auth = await authorizePlatformAdminRoute();
  const headers = { "Cache-Control": "no-store" };
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status, headers });
  if (update && !isSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers });
  try {
    const result = update ? await updateInstallerReport((await params).id, JSON.parse((await readInstallerReportBody(request)).toString("utf8")), String(auth.adminId))
      : await getInstallerReport((await params).id);
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof InstallerReportError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "invalid_report" }, { status: 400, headers });
    return NextResponse.json({ error: "reports_unavailable" }, { status: 503, headers });
  }
}
export const GET = (request: NextRequest, context: { params: Promise<{ id: string }> }) => handle(request, context, false);
export const PATCH = (request: NextRequest, context: { params: Promise<{ id: string }> }) => handle(request, context, true);

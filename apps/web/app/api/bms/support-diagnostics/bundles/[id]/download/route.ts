import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { readSupportBundleForPlatform } from "@/lib/bms/supportDiagnostics";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  const bundleId = String(params.id ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bundleId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const owner = await query<{ tenant_id: string }>(
    `SELECT tenant_id FROM support_tickets
      WHERE diagnostic_bundle_id = $1 AND tenant_id IS NOT NULL LIMIT 1`,
    [bundleId]
  );
  const tenantId = owner.rows[0]?.tenant_id;
  if (!tenantId) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bundle = await readSupportBundleForPlatform({
    tenantId,
    bundleId,
    actorId: String(auth.adminId),
  });
  if (!bundle) return NextResponse.json({ error: "not found" }, { status: 404 });
  const filename = bundle.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new NextResponse(new Uint8Array(bundle.buffer), {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-content-sha256": bundle.checksum,
      "cache-control": "private, no-store",
    },
  });
}

export const GET = withRouteErrorLog(
  "GET /api/bms/support-diagnostics/bundles/[id]/download",
  handleGET
);

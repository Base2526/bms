import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { buildSupportBundle, recordSupportBundleExport } from "@/lib/bms/supportDiagnostics";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("support.logs.export");
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  const limit = await rateLimit(`support-export:${auth.tenantId}:${auth.adminId}`, 5, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many diagnostic exports", retryAfter: limit.retryAfter },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } }
    );
  }
  const url = new URL(req.url);
  const bundle = await buildSupportBundle({
    tenantId: auth.tenantId,
    actorId: String(auth.adminId),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  const bundleId = await recordSupportBundleExport({
    tenantId: auth.tenantId,
    actorId: String(auth.adminId),
    bundle,
  });
  const truncatedSources = Object.entries(bundle.manifest.truncated)
    .filter(([, truncated]) => truncated)
    .map(([source]) => source)
    .join(",");
  return new NextResponse(bundle.buffer, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="support-diagnostics-${bundleId}.ndjson.gz"`,
      "x-support-bundle-id": bundleId,
      "x-content-sha256": bundle.checksum,
      "x-support-truncated": truncatedSources,
      "cache-control": "no-store",
    },
  });
}

export const GET = withRouteErrorLog("GET /api/bms/support-diagnostics/export", handleGET);

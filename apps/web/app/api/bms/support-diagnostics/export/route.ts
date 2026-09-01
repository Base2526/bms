import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  buildSupportBundle,
  recordSupportBundleExport,
  SupportDiagnosticsInputError,
} from "@/lib/bms/supportDiagnostics";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("support.logs.export");
  // Name the permission: this is a back-office page, and "unauthorized" alone leaves the
  // shop with nothing to act on. The counter is the surface where a raw permission code
  // would be meaningless to the reader, not here.
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden", requiredPermission: "support.logs.export" },
      { status: auth.status }
    );
  }
  const limit = await rateLimit(`support-export:${auth.tenantId}:${auth.adminId}`, 5, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many diagnostic exports", retryAfter: limit.retryAfter },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } }
    );
  }
  const url = new URL(req.url);
  let bundle: Awaited<ReturnType<typeof buildSupportBundle>>;
  try {
    bundle = await buildSupportBundle({
      tenantId: auth.tenantId,
      actorId: String(auth.adminId),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
  } catch (error) {
    if (error instanceof SupportDiagnosticsInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
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

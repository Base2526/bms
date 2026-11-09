import { NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { openRetailLocalReleaseDownload, RetailLocalReleaseError } from "@/lib/bms/retailLocalReleases";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

function safeFilename(name: string) {
  return (name || "bms-retail-local-installer")
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

async function handleGET(req: Request, { params }: { params: { id: string } }) {
  // Public installer download streams a large file through this server, so a per-IP ceiling
  // bounds bandwidth abuse. 30 per 10 minutes still covers a shop installing several machines.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")?.trim()
    || "unknown";
  const limited = await rateLimit(`retail-local-download:${ip.slice(0, 128)}`, 30, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  try {
    const auth = await authorizePlatformAdminRoute();
    const download = await openRetailLocalReleaseDownload(params.id, { includeTrialLocked: auth.ok });
    const filename = safeFilename(download.filename);
    return new NextResponse(download.stream, {
      status: 200,
      headers: {
        "Content-Type": download.mime,
        "Content-Length": String(download.size),
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "X-Checksum-SHA256": download.sha256,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    if (error instanceof RetailLocalReleaseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const GET = withRouteErrorLog("GET /api/retail-local/download/[id]", handleGET);

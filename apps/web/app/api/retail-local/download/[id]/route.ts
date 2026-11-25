import { NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { openRetailLocalReleaseDownload, RetailLocalReleaseError } from "@/lib/bms/retailLocalReleases";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { buildRetailLocalDownloadResponse } from "@/lib/bms/retailLocalReleaseDownloadResponse";
import { publicErrorMessage } from "@/lib/publicErrorMessage";

export const dynamic = "force-dynamic";

async function handleGET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const download = await openRetailLocalReleaseDownload((await params).id, { includeTrialLocked: auth.ok });
    return buildRetailLocalDownloadResponse(download);
  } catch (error) {
    if (error instanceof RetailLocalReleaseError) {
      return NextResponse.json(
        { error: publicErrorMessage(error, "Retail Local installer is unavailable") },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}

export const GET = withRouteErrorLog("GET /api/retail-local/download/[id]", handleGET);

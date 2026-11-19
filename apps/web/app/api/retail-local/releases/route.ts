import { NextResponse } from "next/server";
import { getPublicRetailLocalDownloads } from "@/lib/bms/retailLocalReleases";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  // Public list read from the release table on every uncached call — bound it per IP like the
  // other public routes (same ceiling as /api/public/app-downloads).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")?.trim()
    || "unknown";
  const limited = await rateLimit(`retail-local-releases:${ip.slice(0, 128)}`, 120, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  const releases = await getPublicRetailLocalDownloads();
  return NextResponse.json(releases, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}

export const GET = withRouteErrorLog("GET /api/retail-local/releases", handleGET);

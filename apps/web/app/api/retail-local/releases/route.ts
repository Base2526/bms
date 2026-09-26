import { NextResponse } from "next/server";
import { getPublicRetailLocalDownloads } from "@/lib/bms/retailLocalReleases";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handleGET() {
  const releases = await getPublicRetailLocalDownloads();
  return NextResponse.json(releases, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}

export const GET = withRouteErrorLog("GET /api/retail-local/releases", handleGET);

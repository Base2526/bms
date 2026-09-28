import { NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  listRetailLocalReleaseAssets,
} from "@/lib/bms/retailLocalReleases";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handleGET() {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });

  const releases = await listRetailLocalReleaseAssets({ includeHidden: true });
  return NextResponse.json({ releases }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withRouteErrorLog("GET /api/admin/retail-local/releases", handleGET);
// Old cached admin bundles may still POST here. Refuse immediately without
// touching the body so a stale client cannot trigger Next 14's request buffer.
export const POST = () => NextResponse.json(
  { error: "reload the page before uploading this release" },
  { status: 410, headers: { "Cache-Control": "no-store" } }
);

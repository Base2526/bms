import { NextResponse } from "next/server";

import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { listManagedRuntimeReleases, managedRuntimeReleaseBaseUrl } from "@/lib/bms/managedRuntimeReleases";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handleGET() {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  const releases = await listManagedRuntimeReleases();
  return NextResponse.json({ releases, baseUrl: managedRuntimeReleaseBaseUrl() }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export const GET = withRouteErrorLog("GET /api/admin/retail-local/runtime-releases", handleGET);

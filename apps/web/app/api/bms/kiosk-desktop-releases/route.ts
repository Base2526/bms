import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { userCanAccessLocation } from "@/lib/bms/locations";
import { kioskDesktopReleaseSummary, KIOSK_RELEASE_UUID } from "@/lib/bms/kioskDesktopReleases";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("restaurant.floor.manage");
  if (!auth.ok) return NextResponse.json({ code: auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status: auth.status });
  const locationId = req.nextUrl.searchParams.get("locationId") ?? "";
  if (!KIOSK_RELEASE_UUID.test(locationId)
    || !await userCanAccessLocation(auth.tenantId, String(auth.adminId), locationId)) {
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  }
  try {
    return NextResponse.json({ release: await kioskDesktopReleaseSummary({ tenantId: auth.tenantId, locationId }),
      canPublish: auth.admin.is_platform_admin === true },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ code: "RELEASE_UNAVAILABLE" }, { status: 503 });
  }
}

export const GET = withRouteErrorLog("GET /api/bms/kiosk-desktop-releases", handleGET);

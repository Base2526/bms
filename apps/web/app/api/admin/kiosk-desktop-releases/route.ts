import { NextResponse, type NextRequest } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { userCanAccessLocation } from "@/lib/bms/locations";
import { readRestaurantKioskJson } from "@/lib/bms/restaurantKioskRequestBody";
import {
  hideKioskDesktopRelease, KIOSK_RELEASE_UUID, KioskDesktopReleaseError,
  listKioskDesktopReleasesForPublisher, publishKioskDesktopReleaseForBranch,
} from "@/lib/bms/kioskDesktopReleases";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET() {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ code: auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status: auth.status });
  try {
    return NextResponse.json({ releases: await listKioskDesktopReleasesForPublisher() },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ code: "RELEASE_UNAVAILABLE" }, { status: 503 }); }
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ code: auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status: auth.status });
  let body: Record<string, unknown>;
  try { body = await readRestaurantKioskJson(req); }
  catch { return NextResponse.json({ code: "INVALID_BODY" }, { status: 400 }); }
  if (body.confirmed !== true || !KIOSK_RELEASE_UUID.test(String(body.releaseId ?? ""))) {
    return NextResponse.json({ code: "INVALID_BODY" }, { status: 400 });
  }
  try {
    if (body.action === "hide") {
      return NextResponse.json({ release: await hideKioskDesktopRelease({
        releaseId: String(body.releaseId), tenantId: auth.tenantId, adminId: auth.adminId,
      }) });
    }
    if (body.action !== "publish" || !KIOSK_RELEASE_UUID.test(String(body.locationId ?? ""))) {
      return NextResponse.json({ code: "INVALID_BODY" }, { status: 400 });
    }
    const locationId = String(body.locationId);
    if (!await userCanAccessLocation(auth.tenantId, String(auth.adminId), locationId)) {
      return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
    }
    return NextResponse.json({ release: await publishKioskDesktopReleaseForBranch({
      releaseId: String(body.releaseId), tenantId: auth.tenantId, locationId, adminId: auth.adminId,
    }) });
  } catch (error) {
    const status = error instanceof KioskDesktopReleaseError ? error.status : 503;
    return NextResponse.json({ code: error instanceof KioskDesktopReleaseError ? error.code : "RELEASE_UNAVAILABLE" },
      { status });
  }
}

export const GET = withRouteErrorLog("GET /api/admin/kiosk-desktop-releases", handleGET);
export const POST = withRouteErrorLog("POST /api/admin/kiosk-desktop-releases", handlePOST);

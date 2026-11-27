import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { userCanAccessLocation } from "@/lib/bms/locations";
import { listRestaurantKioskTrace } from "@/lib/bms/restaurantKioskTrace";
import { normalizeKioskRequestCode } from "@/lib/bms/restaurantKioskReview";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("restaurant.floor.manage");
  if (!auth.ok) return NextResponse.json({ code: auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status: auth.status });
  const locationId = req.nextUrl.searchParams.get("locationId") ?? "";
  const inputCode = req.nextUrl.searchParams.get("requestCode") ?? "";
  if (!UUID.test(locationId)) return NextResponse.json({ code: "INVALID_BRANCH" }, { status: 400 });
  let requestCode: string;
  try { requestCode = normalizeKioskRequestCode(inputCode); }
  catch { return NextResponse.json({ code: "INVALID_REQUEST_CODE" }, { status: 400 }); }
  if (!await userCanAccessLocation(auth.tenantId, String(auth.adminId), locationId)) {
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  }
  try {
    return NextResponse.json({ submissions: await listRestaurantKioskTrace(auth.tenantId, locationId, requestCode) },
      { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ code: "TRACE_UNAVAILABLE" }, { status: 503 });
  }
}

export const GET = withRouteErrorLog("GET /api/bms/restaurant-kiosk-trace", handleGET);

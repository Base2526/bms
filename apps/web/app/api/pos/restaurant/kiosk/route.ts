import { NextResponse, type NextRequest } from "next/server";
import { acceptRestaurantKioskSubmission } from "@/lib/bms/restaurantPos";
import {
  issueRestaurantKiosk, listRestaurantKioskSubmissions, previewRestaurantKioskSubmission,
  rejectRestaurantKioskSubmission, restaurantKioskState,
} from "@/lib/bms/restaurantKiosk";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { authenticateRestaurantMutation, authenticateRestaurantRead } from "../routeAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authenticateRestaurantRead(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const [kiosk, submissions] = await Promise.all([
    restaurantKioskState(auth.device.tenantId, auth.device.locationId),
    listRestaurantKioskSubmissions(auth.device.tenantId, auth.device.locationId,
      req.nextUrl.searchParams.get("requestCode") ?? undefined),
  ]);
  return NextResponse.json({ kiosk, submissions });
}

async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const management = action === "issue" || action === "rotate" || action === "disable";
  const auth = await authenticateRestaurantMutation(req, body,
    management ? "restaurant.floor.manage" : "pos.sell");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (management) {
    return NextResponse.json(await issueRestaurantKiosk({
      tenantId: auth.device.tenantId, locationId: auth.device.locationId,
      actorUserId: auth.actor.userId, rotate: action === "rotate", disable: action === "disable",
    }));
  }
  const submissionId = typeof body.submissionId === "string" ? body.submissionId.trim() : "";
  if (!submissionId) return NextResponse.json({ error: "ต้องระบุคำขอ" }, { status: 400 });
  if (action === "preview") {
    return NextResponse.json(await previewRestaurantKioskSubmission({
      tenantId: auth.device.tenantId, locationId: auth.device.locationId,
      submissionId, checkId: typeof body.checkId === "string" ? body.checkId : null,
    }));
  }
  if (action === "accept") {
    const result = await acceptRestaurantKioskSubmission({
      tenantId: auth.device.tenantId, locationId: auth.device.locationId,
      deviceId: auth.device.id, shiftId: auth.shift.id,
      submissionId, checkId: typeof body.checkId === "string" ? body.checkId : null,
      actorUserId: auth.actor.userId,
      quoteFingerprint: typeof body.quoteFingerprint === "string" ? body.quoteFingerprint : "",
      confirmedPriceChange: body.confirmedPriceChange === true,
      confirmedTable: body.confirmedTable === true,
      expectedCheckVersion: typeof body.expectedCheckVersion === "number" ? body.expectedCheckVersion : undefined,
      expectedTableId: typeof body.expectedTableId === "string" ? body.expectedTableId : null,
      expectedCheckOpenedAt: typeof body.expectedCheckOpenedAt === "string" ? body.expectedCheckOpenedAt : null,
    });
    return NextResponse.json(result, { status: result.status === "ACCEPTED" ? 200 : 409 });
  }
  if (action === "reject") {
    return NextResponse.json(await rejectRestaurantKioskSubmission({
      tenantId: auth.device.tenantId, locationId: auth.device.locationId,
      submissionId, actorUserId: auth.actor.userId,
      reason: typeof body.reason === "string" ? body.reason : "",
    }));
  }
  return NextResponse.json({ error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });
}

export const GET = withRouteErrorLog("GET /api/pos/restaurant/kiosk", handleGET);
export const POST = withRouteErrorLog("POST /api/pos/restaurant/kiosk", handlePOST);

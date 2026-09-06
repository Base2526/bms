import { NextResponse, type NextRequest } from "next/server";
import { acceptRestaurantQrSubmission } from "@/lib/bms/restaurantPos";
import {
  listRestaurantQrSubmissions,
  rejectRestaurantQrSubmission,
} from "@/lib/bms/restaurantQrOrdering";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { authenticateRestaurantMutation, authenticateRestaurantRead } from "../routeAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authenticateRestaurantRead(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({
    submissions: await listRestaurantQrSubmissions(auth.device.tenantId, auth.device.locationId),
  });
}

async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await authenticateRestaurantMutation(req, body, "pos.sell");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const action = typeof body.action === "string" ? body.action : "";
  const submissionId = typeof body.submissionId === "string" ? body.submissionId.trim() : "";
  if (!submissionId) return NextResponse.json({ error: "ต้องระบุออร์เดอร์ QR" }, { status: 400 });

  if (action === "accept") {
    const result = await acceptRestaurantQrSubmission({
      tenantId: auth.device.tenantId,
      locationId: auth.device.locationId,
      deviceId: auth.device.id,
      shiftId: auth.shift.id,
      submissionId,
      actorUserId: auth.actor.userId,
    });
    return NextResponse.json(result, { status: result.status === "ACCEPTED" ? 200 : 409 });
  }
  if (action === "reject") {
    const reason = typeof body.reason === "string" ? body.reason : "";
    return NextResponse.json(await rejectRestaurantQrSubmission({
      tenantId: auth.device.tenantId,
      locationId: auth.device.locationId,
      submissionId,
      actorUserId: auth.actor.userId,
      reason,
    }));
  }
  return NextResponse.json({ error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });
}

export const GET = withRouteErrorLog("GET /api/pos/restaurant/qr-orders", handleGET);
export const POST = withRouteErrorLog("POST /api/pos/restaurant/qr-orders", handlePOST);

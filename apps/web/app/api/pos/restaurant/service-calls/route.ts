import { NextResponse, type NextRequest } from "next/server";
import {
  listRestaurantServiceCalls,
  updateRestaurantServiceCall,
} from "@/lib/bms/restaurantServiceCalls";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { authenticateRestaurantMutation, authenticateRestaurantRead } from "../routeAuth";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authenticateRestaurantRead(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({
    calls: await listRestaurantServiceCalls(auth.device.tenantId, auth.device.locationId),
  });
}

async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await authenticateRestaurantMutation(req, body, "pos.sell");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const action = body.action === "acknowledge" || body.action === "complete" ? body.action : null;
  const callId = typeof body.callId === "string" ? body.callId.trim() : "";
  if (!action || !callId) return NextResponse.json({ error: "คำขอหรือการทำงานไม่ถูกต้อง" }, { status: 400 });
  try {
    return NextResponse.json(await updateRestaurantServiceCall({
      tenantId: auth.device.tenantId,
      locationId: auth.device.locationId,
      actorUserId: auth.actor.userId,
      callId,
      action,
    }));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    return NextResponse.json({ error: error instanceof Error ? error.message : "อัปเดตคำขอไม่สำเร็จ" }, { status: 409 });
  }
}

export const GET = withRouteErrorLog("GET /api/pos/restaurant/service-calls", handleGET);
export const POST = withRouteErrorLog("POST /api/pos/restaurant/service-calls", handlePOST);

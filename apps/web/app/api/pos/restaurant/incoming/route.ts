import { NextResponse, type NextRequest } from "next/server";
import {
  acceptIncomingRestaurantOrder,
  getRestaurantOrderingConfig,
  listIncomingRestaurantOrders,
  setRestaurantOrderingPaused,
} from "@/lib/bms/restaurantOrdering";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { authenticateRestaurantMutation, authenticateRestaurantRead } from "../routeAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authenticateRestaurantRead(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const [orders, config] = await Promise.all([
    listIncomingRestaurantOrders(auth.device.tenantId, auth.device.locationId),
    getRestaurantOrderingConfig(auth.device.tenantId),
  ]);
  return NextResponse.json({ orders, config });
}

async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const permission = action === "pause" ? "restaurant.floor.manage" : "restaurant.kitchen.update";
  const auth = await authenticateRestaurantMutation(req, body, permission);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (action === "accept") {
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    if (!orderId) return NextResponse.json({ error: "ต้องระบุออร์เดอร์" }, { status: 400 });
    const result = await acceptIncomingRestaurantOrder({
      tenantId: auth.device.tenantId,
      locationId: auth.device.locationId,
      orderId,
      actorUserId: auth.actor.userId,
    });
    return NextResponse.json(result, { status: result.status === "ACCEPTED" ? 200 : 409 });
  }
  if (action === "pause" && typeof body.paused === "boolean") {
    return NextResponse.json(await setRestaurantOrderingPaused({
      tenantId: auth.device.tenantId,
      paused: body.paused,
      actorUserId: auth.actor.userId,
    }));
  }
  return NextResponse.json({ error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });
}

export const GET = withRouteErrorLog("GET /api/pos/restaurant/incoming", handleGET);
export const POST = withRouteErrorLog("POST /api/pos/restaurant/incoming", handlePOST);

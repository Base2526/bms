import { NextResponse, type NextRequest } from "next/server";
import { createDefaultRestaurantFloor, listRestaurantFloor } from "@/lib/bms/restaurantPos";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { authenticateRestaurantMutation, authenticateRestaurantRead } from "../routeAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authenticateRestaurantRead(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(await listRestaurantFloor(auth.device.tenantId, auth.device.locationId));
}

async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await authenticateRestaurantMutation(req, body, "pos.device.manage");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const floor = await createDefaultRestaurantFloor({
    tenantId: auth.device.tenantId,
    locationId: auth.device.locationId,
    actorUserId: auth.actor.userId,
    tableCount: Number(body.tableCount ?? 12),
  });
  return NextResponse.json(floor);
}

export const GET = withRouteErrorLog("GET /api/pos/restaurant/floor", handleGET);
export const POST = withRouteErrorLog("POST /api/pos/restaurant/floor", handlePOST);

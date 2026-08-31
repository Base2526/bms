import { NextResponse, type NextRequest } from "next/server";
import { openRestaurantCheck } from "@/lib/bms/restaurantPos";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { authenticateRestaurantMutation } from "../routeAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await authenticateRestaurantMutation(req, body, "pos.sell");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const tableId = typeof body.tableId === "string" ? body.tableId.trim() : "";
  if (!tableId) return NextResponse.json({ error: "ต้องระบุโต๊ะ" }, { status: 400 });
  const check = await openRestaurantCheck({
    tenantId: auth.device.tenantId,
    locationId: auth.device.locationId,
    deviceId: auth.device.id,
    shiftId: auth.shift.id,
    tableId,
    guestCount: Number(body.guestCount ?? 1),
    note: typeof body.note === "string" ? body.note : null,
    actorUserId: auth.actor.userId,
  });
  return NextResponse.json({ check }, { status: 201 });
}

export const POST = withRouteErrorLog("POST /api/pos/restaurant/checks", handlePOST);

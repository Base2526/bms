import { NextResponse, type NextRequest } from "next/server";
import {
  addRestaurantCheckItem,
  cancelRestaurantCheck,
  getRestaurantCheck,
  moveRestaurantCheck,
  removeRestaurantCheckItem,
  sendRestaurantKitchenRound,
  settleRestaurantCheck,
} from "@/lib/bms/restaurantPos";
import { parsePosPayments } from "@/lib/bms/posRouteHelpers";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { authenticateRestaurantMutation, authenticateRestaurantRead } from "../../routeAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

async function handleGET(req: NextRequest, { params }: RouteContext) {
  const auth = await authenticateRestaurantRead(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const check = await getRestaurantCheck(auth.device.tenantId, params.id, auth.device.locationId);
  if (!check) return NextResponse.json({ error: "ไม่พบบิลโต๊ะ" }, { status: 404 });
  return NextResponse.json({ check });
}

async function handlePOST(req: NextRequest, { params }: RouteContext) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "").trim().toLowerCase();
  const permission = action === "cancel" ? "restaurant.check.cancel" : "pos.sell";
  const auth = await authenticateRestaurantMutation(req, body, permission);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const common = {
    tenantId: auth.device.tenantId,
    locationId: auth.device.locationId,
    checkId: params.id,
    actorUserId: auth.actor.userId,
  };

  if (action === "add_item") {
    const check = await addRestaurantCheckItem({
      ...common,
      sku: String(body.sku ?? "").trim(),
      size: typeof body.size === "string" ? body.size : null,
      packCode: typeof body.packCode === "string" ? body.packCode : null,
      packQty: Number(body.packQty ?? 1),
      modifierCodes: Array.isArray(body.modifierCodes) ? body.modifierCodes.map(String) : [],
      kitchenNote: typeof body.kitchenNote === "string" ? body.kitchenNote : null,
    });
    return NextResponse.json({ check });
  }
  if (action === "remove_item") {
    const check = await removeRestaurantCheckItem({
      ...common,
      itemId: String(body.itemId ?? "").trim(),
    });
    return NextResponse.json({ check });
  }
  if (action === "send_kitchen") {
    const result = await sendRestaurantKitchenRound({
      ...common,
      deviceId: auth.device.id,
      shiftId: auth.shift.id,
    });
    const status = result.status === "SENT" ? 200 : 409;
    return NextResponse.json(result, { status });
  }
  if (action === "move") {
    const check = await moveRestaurantCheck({
      ...common,
      targetTableId: String(body.targetTableId ?? "").trim(),
    });
    return NextResponse.json({ check });
  }
  if (action === "cancel") {
    const reason = String(body.reason ?? "").trim();
    if (!reason) return NextResponse.json({ error: "ต้องระบุเหตุผลที่ยกเลิกบิล" }, { status: 400 });
    return NextResponse.json(await cancelRestaurantCheck({ ...common, reason }));
  }
  if (action === "settle") {
    const parsed = parsePosPayments(body.payments);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const result = await settleRestaurantCheck({
      ...common,
      deviceId: auth.device.id,
      shiftId: auth.shift.id,
      payments: parsed.payments,
    });
    return NextResponse.json(result, { status: result.status === "SOLD" ? 200 : 409 });
  }
  return NextResponse.json({ error: "action ไม่ถูกต้อง" }, { status: 400 });
}

export const GET = withRouteErrorLog("GET /api/pos/restaurant/checks/[id]", handleGET);
export const POST = withRouteErrorLog("POST /api/pos/restaurant/checks/[id]", handlePOST);

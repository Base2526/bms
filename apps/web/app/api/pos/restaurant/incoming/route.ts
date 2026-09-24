import { NextResponse, type NextRequest } from "next/server";
import {
  acceptIncomingRestaurantOrder,
  getRestaurantOrderingConfig,
  listIncomingRestaurantOrders,
  listPendingRestaurantRefunds,
  setRestaurantOrderingPaused,
} from "@/lib/bms/restaurantOrdering";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { authenticateRestaurantMutation, authenticateRestaurantRead } from "../routeAuth";
import { cancelRestaurantOrderLines, cashierHasPermission, verifyCashierPin } from "@/lib/bms/pos";
import { listDeliveryIntakeControls, setDeliveryIntakeForBranch } from "@/lib/bms/deliveryPlatforms/intake";
import { handoffDeliveryOrder, markDeliveryOrderReady } from "@/lib/bms/deliveryPlatforms/orderOperations";
import { RESTAURANT_CANCELLATION_CAUSES } from "@/lib/bms/restaurantCancellationPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authenticateRestaurantRead(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const [orders, refunds, config, deliveryIntakeControls] = await Promise.all([
    listIncomingRestaurantOrders(auth.device.tenantId, auth.device.locationId),
    listPendingRestaurantRefunds(auth.device.tenantId, auth.device.locationId),
    getRestaurantOrderingConfig(auth.device.tenantId),
    listDeliveryIntakeControls(auth.device.tenantId, auth.device.locationId),
  ]);
  return NextResponse.json({ orders, refunds, config: { ...config, deliveryIntakeControls } });
}

async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const permission = action === "pause" ? "restaurant.floor.manage"
    : action === "delivery_pause" ? "restaurant.order_intake.manage"
    : action === "delivery_handoff" ? "restaurant.delivery.handoff"
    : action === "delivery_ready" ? "restaurant.kitchen.update"
    : action === "cancel_lines" ? "order.line.cancel"
    : action === "accept" ? ["restaurant.kitchen.update", "restaurant.delivery.review"]
    : "restaurant.kitchen.update";
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
      deviceId: auth.device.id,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : null,
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
  if (action === "delivery_pause" && typeof body.paused === "boolean") {
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const integrationId = typeof body.integrationId === "string" ? body.integrationId.trim() : null;
    if (!idempotencyKey || !reason) {
      return NextResponse.json({ error: "ต้องระบุเหตุผลและ idempotencyKey" }, { status: 400 });
    }
    const result = await setDeliveryIntakeForBranch({
      tenantId: auth.device.tenantId,
      locationId: auth.device.locationId,
      integrationId,
      paused: body.paused,
      pausedUntil: typeof body.pausedUntil === "string" ? body.pausedUntil : null,
      reason,
      actorUserId: auth.actor.userId,
      deviceId: auth.device.id,
      idempotencyKey,
    });
    return NextResponse.json(result, { status: result.status === "UPDATED" ? 200 : 409 });
  }
  if (action === "delivery_ready") {
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    if (!orderId || !idempotencyKey) {
      return NextResponse.json({ error: "ต้องระบุออร์เดอร์และ idempotencyKey" }, { status: 400 });
    }
    const result = await markDeliveryOrderReady({
      tenantId: auth.device.tenantId,
      locationId: auth.device.locationId,
      orderId,
      actorUserId: auth.actor.userId,
      deviceId: auth.device.id,
      idempotencyKey,
    });
    return NextResponse.json(result, { status: result.status === "READY" ? 200 : 409 });
  }
  if (action === "delivery_handoff") {
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const checklist = body.checklist && typeof body.checklist === "object" && !Array.isArray(body.checklist)
      ? body.checklist as Record<string, unknown> : {};
    if (!orderId || !idempotencyKey) {
      return NextResponse.json({ error: "ต้องระบุออร์เดอร์และ idempotencyKey" }, { status: 400 });
    }
    const result = await handoffDeliveryOrder({
      tenantId: auth.device.tenantId,
      locationId: auth.device.locationId,
      orderId,
      actorUserId: auth.actor.userId,
      deviceId: auth.device.id,
      idempotencyKey,
      pickupCode: typeof body.pickupCode === "string" ? body.pickupCode : null,
      riderReference: typeof body.riderReference === "string" ? body.riderReference : null,
      bagCount: Number(body.bagCount),
      checklist,
    });
    return NextResponse.json(result, { status: result.status === "HANDED_OVER" ? 200 : 409 });
  }
  if (action === "cancel_lines") {
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const requestedLines = Array.isArray(body.lines) ? body.lines : [];
    const lines = requestedLines.map((line: any) => ({
      orderItemId: Number(line?.orderItemId),
      packQty: Number(line?.packQty),
      cause: String(line?.cause ?? ""),
    })).filter((line) => Number.isInteger(line.orderItemId) && Number.isInteger(line.packQty) && line.packQty > 0
      && (RESTAURANT_CANCELLATION_CAUSES as readonly string[]).includes(line.cause));
    if (!orderId || !idempotencyKey || lines.length === 0) {
      return NextResponse.json({ error: "ต้องระบุออร์เดอร์ รายการ ต้นเหตุ และ idempotencyKey" }, { status: 400 });
    }
    // Reject the whole request when any line is malformed. Cancelling the readable subset would
    // take food off a customer's order and refund a different amount than the register asked for,
    // with nothing anywhere saying a line was dropped.
    if (lines.length !== requestedLines.length) {
      return NextResponse.json({
        error: "รายการที่ส่งมาไม่ถูกต้องบางบรรทัด — ต้องระบุ orderItemId จำนวน และต้นเหตุให้ครบทุกบรรทัด",
      }, { status: 400 });
    }
    let managerApprovedByUserId: string | null = null;
    const managerId = typeof body.managerUserId === "string" ? body.managerUserId.trim() : "";
    const managerPin = typeof body.managerPin === "string" ? body.managerPin : "";
    if (managerId && managerPin) {
      const manager = await verifyCashierPin(auth.device.tenantId, managerId, managerPin);
      if (!manager.ok || manager.userId === auth.actor.userId
          || !(await cashierHasPermission(auth.device.tenantId, manager.userId, "restaurant.floor.manage"))) {
        return NextResponse.json({ error: "ผู้ยืนยันต้องเป็นผู้จัดการคนอื่นและ PIN ถูกต้อง" }, { status: 403 });
      }
      managerApprovedByUserId = manager.userId;
    }
    const result = await cancelRestaurantOrderLines({
      tenantId: auth.device.tenantId,
      locationId: auth.device.locationId,
      orderId,
      actorUserId: auth.actor.userId,
      lines: lines as any,
      idempotencyKey,
      managerApprovedByUserId,
      note: typeof body.note === "string" ? body.note.trim() : null,
    });
    return NextResponse.json(result, { status: result.status === "PARTIAL_RETURNED" ? 200 : 409 });
  }
  return NextResponse.json({ error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });
}

export const GET = withRouteErrorLog("GET /api/pos/restaurant/incoming", handleGET);
export const POST = withRouteErrorLog("POST /api/pos/restaurant/incoming", handlePOST);

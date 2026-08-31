// =============================================================
// POST /api/pos/purchase — POS PO queue/detail/receive
// -------------------------------------------------------------
// All actions verify the device-derived tenant plus cashier PIN and
// purchase.receive.  The receive action reuses purchase.ts and writes its
// inventory movement, audit row, and retry receipt atomically.
// =============================================================

import { NextResponse } from "next/server";
import { posPermissionDeniedMessage } from "@/lib/bms/posApprovals";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  verifyCashierPin,
} from "@/lib/bms/pos";
import {
  getPurchaseOrder,
  listReceivablePurchaseOrders,
  receivePurchaseOrder,
  type ReceiveInput,
} from "@/lib/bms/purchase";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function handlePOST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const cashierUserId = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!UUID_RE.test(cashierUserId) || !pin || pin.length > 32) {
    return NextResponse.json({ error: "ต้องระบุพนักงานและ PIN" }, { status: 400 });
  }
  const auth = await verifyCashierPin(device.tenantId, cashierUserId, pin);
  if (!auth.ok) return NextResponse.json({ error: "PIN ไม่ถูกต้อง", reason: auth.reason }, { status: 403 });
  if (!(await cashierHasPermission(device.tenantId, auth.userId, "purchase.receive"))) {
    return NextResponse.json({ error: await posPermissionDeniedMessage(device.tenantId, "purchase.receive") }, { status: 403 });
  }

  if (action === "list") {
    return NextResponse.json({ orders: await listReceivablePurchaseOrders(device.tenantId, 50) });
  }

  const poId = typeof body.poId === "string" ? body.poId.trim() : "";
  if (!UUID_RE.test(poId)) return NextResponse.json({ error: "ใบสั่งซื้อไม่ถูกต้อง" }, { status: 400 });

  if (action === "detail") {
    const order = await getPurchaseOrder(device.tenantId, poId);
    if (!order) return NextResponse.json({ error: "ไม่พบใบสั่งซื้อ" }, { status: 404 });
    if (order.status !== "OPEN" && order.status !== "PARTIAL") {
      return NextResponse.json({ error: `ใบสั่งซื้อนี้รับต่อไม่ได้ (สถานะ ${order.status})` }, { status: 409 });
    }
    return NextResponse.json({ order });
  }

  if (action !== "receive") return NextResponse.json({ error: "action ไม่ถูกต้อง" }, { status: 400 });

  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json({ error: "idempotencyKey จำเป็นและต้องไม่เกิน 200 ตัวอักษร" }, { status: 400 });
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length > 200) return NextResponse.json({ error: "รับสินค้าได้ไม่เกิน 200 รายการต่อครั้ง" }, { status: 400 });
  if (rawItems.some((raw: any) =>
    (typeof raw?.sku === "string" && raw.sku.trim().length > 200)
    || (typeof raw?.size === "string" && raw.size.trim().length > 100)
    || (typeof raw?.lotNo === "string" && raw.lotNo.trim().length > 100)
    || (typeof raw?.expiryDate === "string" && raw.expiryDate !== "" && !isIsoDate(raw.expiryDate))
  )) {
    return NextResponse.json({ error: "lot หรือวันหมดอายุไม่ถูกต้อง" }, { status: 400 });
  }
  const items: ReceiveInput[] = rawItems.map((raw: any) => ({
    sku: typeof raw?.sku === "string" ? raw.sku.trim() : "",
    size: typeof raw?.size === "string" ? raw.size.trim() : "",
    qty: Number(raw?.qty),
    lotNo: typeof raw?.lotNo === "string" ? raw.lotNo.trim() || null : null,
    expiryDate: typeof raw?.expiryDate === "string" && isIsoDate(raw.expiryDate)
      ? raw.expiryDate
      : null,
  }));
  if (!items.length || items.some((item) =>
    !item.sku || item.sku.length > 200
    || !item.size || item.size.length > 100
    || !Number.isInteger(item.qty) || item.qty <= 0
    || (item.expiryDate != null && !item.lotNo)
  )) {
    return NextResponse.json({ error: "รายการรับสินค้าไม่ถูกต้อง" }, { status: 400 });
  }

  const result = await receivePurchaseOrder(
    device.tenantId,
    poId,
    items,
    auth.userId,
    auth.userId,
    {
      locationId: device.locationId,
      idempotency: { deviceId: device.id, actorUserId: auth.userId, key: idempotencyKey },
      audit: { actor: auth.userId, action: "purchase.receive", meta: { surface: "pos", deviceId: device.id } },
    }
  );
  const status = result.status === "RECEIVED" || result.status === "PARTIAL"
    ? 200
    : result.status === "PO_NOT_FOUND" || result.status === "LINE_NOT_FOUND" || result.status === "LOCATION_NOT_FOUND"
      ? 404
      : result.status === "INVALID_STATE" || result.status === "OVER_RECEIVE" || result.status === "IDEMPOTENCY_CONFLICT"
        ? 409
        : 400;
  return NextResponse.json(result, { status });
}

export const POST = withRouteErrorLog("POST /api/pos/purchase", handlePOST);

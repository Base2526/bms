// =============================================================
// POST /api/pos/kitchen/tickets/status — ขยับสถานะ "ทั้งใบ" จากจอครัว
// -------------------------------------------------------------
// auth: header `x-pos-device-token` + cashier PIN (เหมือน route ทีละใบทุกประการ)
//
// จอครัวรวมตั๋วของ (โต๊ะ + รอบ + สถานี) เป็นใบเดียว ปุ่มเดียวจึงต้องเลื่อนหลายแถว ·
// ยิงทีละใบจากเบราว์เซอร์ทำไม่ได้ เพราะใบที่ล้มกลางชุดจะทิ้งงานเดียวกันคาไว้สองช่อง
// service เลื่อนให้ทั้งชุดในทรานแซกชันเดียว (ล้มใบไหน rollback ทั้งชุด)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { posPermissionDeniedMessage } from "@/lib/bms/posApprovals";
import {
  authenticatePosDevice,
  cashierHasPermission,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { updateKitchenTicketsStatus } from "@/lib/bms/kitchen";
import { dropKitchenCancelledLineInTx } from "@/lib/bms/restaurantPos";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  const status = typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
  const ticketIds = Array.isArray(body.ticketIds)
    ? body.ticketIds.map((id) => String(id ?? "").trim()).filter(Boolean)
    : [];
  if (!userId || !pin || !status || ticketIds.length === 0) {
    return NextResponse.json({ error: "ต้องระบุ userId, pin, status และ ticketIds" }, { status: 400 });
  }

  const auth = await verifyCashierPin(device.tenantId, userId, pin);
  if (!auth.ok) {
    const message =
      auth.reason === "NO_PIN" ? "พนักงานคนนี้ยังไม่ได้ตั้ง PIN — ตั้งจากหน้าแอดมินก่อน"
      : auth.reason === "LOCKED" ? "ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว"
      : "PIN ไม่ถูกต้อง";
    return NextResponse.json({ error: message, reason: auth.reason, lockedUntil: auth.lockedUntil }, { status: 403 });
  }

  if (!(await cashierHasPermission(device.tenantId, auth.userId, "restaurant.kitchen.update"))) {
    return NextResponse.json(
      { error: await posPermissionDeniedMessage(device.tenantId, "restaurant.kitchen.update") },
      { status: 403 }
    );
  }

  const tickets = await updateKitchenTicketsStatus({
    tenantId: device.tenantId,
    ticketIds,
    status,
    actorUserId: auth.userId,
    expectedLocationId: device.locationId,
    onRestaurantCheckLineCancelled: dropKitchenCancelledLineInTx,
  });
  return NextResponse.json({ tickets });
}

export const POST = withRouteErrorLog("POST /api/pos/kitchen/tickets/status", handlePOST);

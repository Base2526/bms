// =============================================================
// POST /api/pos/kitchen/tickets/[id]/status — ขยับสถานะตั๋วครัวจาก POS
// -------------------------------------------------------------
// auth: header `x-pos-device-token` + cashier PIN
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { posPermissionDeniedMessage } from "@/lib/bms/posApprovals";
import {
  authenticatePosDevice,
  cashierHasPermission,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { updateKitchenTicketStatus } from "@/lib/bms/kitchen";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const ticketId = params.id;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  const status = typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
  if (!userId || !pin || !status) {
    return NextResponse.json({ error: "ต้องระบุ userId, pin และ status" }, { status: 400 });
  }

  const auth = await verifyCashierPin(device.tenantId, userId, pin);
  if (!auth.ok) {
    const message =
      auth.reason === "NO_PIN" ? "พนักงานคนนี้ยังไม่ได้ตั้ง PIN — ตั้งจากหน้าแอดมินก่อน"
      : auth.reason === "LOCKED" ? "ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว"
      : "PIN ไม่ถูกต้อง";
    return NextResponse.json({ error: message, reason: auth.reason, lockedUntil: auth.lockedUntil }, { status: 403 });
  }

  if (!(await cashierHasPermission(device.tenantId, auth.userId, "order.ship"))) {
    return NextResponse.json({ error: await posPermissionDeniedMessage(device.tenantId, "order.ship") }, { status: 403 });
  }

  const ticket = await updateKitchenTicketStatus({
    tenantId: device.tenantId,
    ticketId,
    status,
    actorUserId: auth.userId,
    expectedLocationId: device.locationId,
  });
  return NextResponse.json({ ticket });
}

export const POST = withRouteErrorLog("POST /api/pos/kitchen/tickets/[id]/status", handlePOST);

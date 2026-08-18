// =============================================================
// POST /api/pos/send-receipt — ส่งสำเนาใบเสร็จทางอีเมล/LINE (8.6)
// -------------------------------------------------------------
// ต้องมี PIN คนขาย แต่ไม่ต้องมีผู้อนุมัติ — การส่งสำเนาไม่แตะเงิน ไม่แตะสต็อก
// และไม่สร้างเอกสารภาษีใบใหม่ (อ่านตัวเลขจากใบที่ออกไปแล้ว)
//
// บิลต้องเป็นของเครื่องนี้: เครื่องหน้าร้านส่งใบเสร็จของบิลที่ตัวเองไม่ได้ขายไม่ได้
// ไม่งั้น device token ที่รั่วออกไปกลายเป็นช่องดึงข้อมูลลูกค้าทั้งร้าน
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticatePosDevice, verifyCashierPin } from "@/lib/bms/pos";
import { sendReceipt } from "@/lib/bms/receiptDelivery";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const channel = body.channel === "line" ? "line" : "email";
  const cashierUserId = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";

  if (!orderId) return NextResponse.json({ error: "ต้องระบุบิล" }, { status: 400 });
  if (!cashierUserId || !pin) return NextResponse.json({ error: "ต้องระบุพนักงานและ PIN" }, { status: 400 });

  const auth = await verifyCashierPin(device.tenantId, cashierUserId, pin);
  if (!auth.ok) return NextResponse.json({ error: "PIN ไม่ถูกต้อง", reason: auth.reason }, { status: 403 });

  const owned = await query(
    `SELECT 1 FROM bms_orders WHERE tenant_id = $1 AND id = $2 AND pos_device_id = $3`,
    [device.tenantId, orderId, device.id]
  );
  if (!owned.rowCount) return NextResponse.json({ error: "ไม่พบบิลนี้ของเครื่องนี้" }, { status: 404 });

  const result = await sendReceipt({
    tenantId: device.tenantId,
    orderId,
    channel,
    to: typeof body.to === "string" ? body.to : null,
  });

  const status = result.status === "SENT" ? 200
    : result.status === "NOT_FOUND" ? 404
    : result.status === "NO_RECIPIENT" ? 400
    : 502;
  return NextResponse.json(result, { status });
}

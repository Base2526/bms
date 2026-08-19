// =============================================================
// GET /api/pos/shift-report — สรุปกะ (X ระหว่างกะ / Z หลังปิด)
// -------------------------------------------------------------
// ?shiftId= ระบุกะ หรือเว้นไว้ = กะที่เปิดอยู่ของเครื่องนี้
//
// นี่คือกระดาษที่ผู้จัดการเซ็นรับเงิน ต้องกดดูได้จากหน้าเคาน์เตอร์เอง
// ไม่ใช่ต้องเปิดหลังบ้านอีกเครื่อง (เหตุผลเดียวกับที่ย้ายการเปิดกะมาที่นี่)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  getOpenPosShift,
  getPosShiftReport,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });

  // ยอดขายรายคนเป็นข้อมูลที่ใช้ประเมินพนักงานได้ จึงต้องรู้ว่าใครขอดู
  // — device token อย่างเดียวไม่พอ เพราะเครื่องเปิดค้างทั้งวันบนเคาน์เตอร์
  const userId = req.nextUrl.searchParams.get("cashierUserId") ?? "";
  const pin = req.nextUrl.searchParams.get("pin") ?? "";
  if (!userId || !pin) return NextResponse.json({ error: "ต้องระบุพนักงานและ PIN" }, { status: 400 });
  const auth = await verifyCashierPin(device.tenantId, userId, pin);
  if (!auth.ok) return NextResponse.json({ error: "PIN ไม่ถูกต้อง", reason: auth.reason }, { status: 403 });
  if (!(await cashierHasPermission(device.tenantId, auth.userId, "pos.shift.report"))) {
    return NextResponse.json({ error: "พนักงานคนนี้ไม่มีสิทธิ์ดูสรุปกะ" }, { status: 403 });
  }

  const requested = req.nextUrl.searchParams.get("shiftId");
  const shiftId = requested ?? (await getOpenPosShift(device.tenantId, device.id))?.id ?? null;
  if (!shiftId) return NextResponse.json({ error: "ไม่พบกะ" }, { status: 404 });

  const report = await getPosShiftReport(device.tenantId, shiftId);
  if (!report) return NextResponse.json({ error: "ไม่พบกะ" }, { status: 404 });
  return NextResponse.json({ report });
}

export const GET = withRouteErrorLog("GET /api/pos/shift-report", handleGET);

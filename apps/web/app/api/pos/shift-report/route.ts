// =============================================================
// GET /api/pos/shift-report — สรุปกะ (X ระหว่างกะ / Z หลังปิด)
// -------------------------------------------------------------
// ?shiftId= ระบุกะ หรือเว้นไว้ = กะที่เปิดอยู่ของเครื่องนี้
//
// นี่คือกระดาษที่ผู้จัดการเซ็นรับเงิน ต้องกดดูได้จากหน้าเคาน์เตอร์เอง
// ไม่ใช่ต้องเปิดหลังบ้านอีกเครื่อง (เหตุผลเดียวกับที่ย้ายการเปิดกะมาที่นี่)
// =============================================================

import { NextResponse } from "next/server";
import { posPermissionDeniedMessage } from "@/lib/bms/posApprovals";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  getOpenPosShift,
  getPosShiftReport,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { getArShiftSummary } from "@/lib/bms/ar";
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
    return NextResponse.json({ error: await posPermissionDeniedMessage(device.tenantId, "pos.shift.report") }, { status: 403 });
  }

  const requested = req.nextUrl.searchParams.get("shiftId");
  const shiftId = requested ?? (await getOpenPosShift(device.tenantId, device.id))?.id ?? null;
  if (!shiftId) return NextResponse.json({ error: "ไม่พบกะ" }, { status: 404 });

  // เครื่องอ่านได้เฉพาะกะของตัวเอง แม้ผู้ใช้จะรู้ UUID ของกะเครื่องอื่นในร้าน
  const report = await getPosShiftReport(device.tenantId, shiftId, device.id);
  if (!report) return NextResponse.json({ error: "ไม่พบกะ" }, { status: 404 });

  // ขายเชื่อ/รับชำระหนี้ของกะนี้ (9.30) — แยกก้อนจาก report โดยตั้งใจ
  //
  // ไม่รวมเข้า salesTotal เพราะมันรวมอยู่แล้ว (บิลเชื่อเป็นบิลที่ขายสำเร็จ) และ
  // ไม่รวมเข้าเงินสดเพราะเงินยังไม่เข้า · ที่กระดาษเซ็นรับเงินต้องบอกคือ "ยอดขายวันนี้
  // มีส่วนที่ยังไม่ได้เงินเท่าไร" ไม่งั้นผู้จัดการจะนับเงินแล้วสงสัยว่าหายไปไหน
  //
  // ยอดรับชำระที่เป็นเงินสด **อยู่ในลิ้นชักแล้ว** ผ่าน bms_pos_cash_movements
  // (นับใน cashIn ของสูตรเดิม) — ที่นี่แสดงเพื่ออธิบายที่มาของเงินก้อนนั้น ไม่ใช่บวกซ้ำ
  const receivables = await getArShiftSummary(device.tenantId, shiftId);
  return NextResponse.json({ report, receivables });
}

export const GET = withRouteErrorLog("GET /api/pos/shift-report", handleGET);

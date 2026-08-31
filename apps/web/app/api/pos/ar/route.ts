// =============================================================
// GET /api/pos/ar — ดูบัญชีเครดิตของลูกค้าจากหน้าเคาน์เตอร์ (9.30)
// -------------------------------------------------------------
// auth: header `x-pos-device-token` + PIN พนักงาน · tenant มาจากตัวเครื่อง
//
// อ่านอย่างเดียว · การตั้งหนี้จริงเกิดในทรานแซกชันของ /api/pos/sale และการรับชำระ
// เกิดที่ /api/pos/ar/collect — ที่นี่ตอบแค่ "ค้างเท่าไร วงเงินเหลือเท่าไร และมี
// เครดิตคืนสินค้าคงเหลือไหม" ซึ่งเป็นสิ่งที่พนักงานต้องเห็นก่อนตัดสินใจ
// ไม่ใช่หลังจากบิลถูกปฏิเสธไปแล้ว
// =============================================================

import { NextResponse } from "next/server";
import { posPermissionDeniedMessage } from "@/lib/bms/posApprovals";
import type { NextRequest } from "next/server";
import { authenticatePosDevice, cashierHasPermission, verifyCashierPin } from "@/lib/bms/pos";
import { getArAccountByCustomer, listArInvoices } from "@/lib/bms/ar";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });

  const userId = req.nextUrl.searchParams.get("cashierUserId") ?? "";
  const pin = req.nextUrl.searchParams.get("pin") ?? "";
  const customerId = (req.nextUrl.searchParams.get("customerId") ?? "").trim();
  if (!userId || !pin) return NextResponse.json({ error: "ต้องระบุพนักงานและ PIN" }, { status: 400 });
  if (!customerId) return NextResponse.json({ error: "ต้องระบุลูกค้า" }, { status: 400 });

  const auth = await verifyCashierPin(device.tenantId, userId, pin);
  if (!auth.ok) return NextResponse.json({ error: "PIN ไม่ถูกต้อง", reason: auth.reason }, { status: 403 });
  if (!(await cashierHasPermission(device.tenantId, auth.userId, "ar.view"))) {
    return NextResponse.json({ error: await posPermissionDeniedMessage(device.tenantId, "ar.view") }, { status: 403 });
  }

  // ไม่พบบัญชี = ตอบ 200 พร้อม account: null ไม่ใช่ 404 — "ลูกค้ารายนี้ยังไม่มี
  // บัญชีเครดิต" เป็นคำตอบที่ถูกต้องของคำถามนี้ ไม่ใช่ข้อผิดพลาด
  const account = await getArAccountByCustomer(device.tenantId, customerId);
  if (!account) return NextResponse.json({ account: null, invoices: [] });

  const invoices = await listArInvoices(device.tenantId, {
    accountId: account.id,
    openOnly: true,
    limit: 50,
  });
  return NextResponse.json({ account, invoices });
}

export const GET = withRouteErrorLog("GET /api/pos/ar", handleGET);

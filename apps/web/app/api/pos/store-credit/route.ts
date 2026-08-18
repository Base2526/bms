// =============================================================
// GET /api/pos/store-credit?code= — เช็คยอดบัตรจากหน้าเคาน์เตอร์ (8.9)
// -------------------------------------------------------------
// อ่านอย่างเดียว · การหักยอดจริงเกิดตอนกดรับเงินที่ /api/pos/sale ในทรานแซกชัน
// เดียวกับการขาย ไม่ใช่ที่นี่ — ถ้าหักที่นี่แล้วบิลล้มทีหลัง เงินบนบัตรจะหายไปเปล่า ๆ
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticatePosDevice, cashierHasPermission, verifyCashierPin } from "@/lib/bms/pos";
import { findStoreCredit } from "@/lib/bms/storeCredit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });

  const userId = req.nextUrl.searchParams.get("cashierUserId") ?? "";
  const pin = req.nextUrl.searchParams.get("pin") ?? "";
  const code = req.nextUrl.searchParams.get("code") ?? "";
  if (!userId || !pin) return NextResponse.json({ error: "ต้องระบุพนักงานและ PIN" }, { status: 400 });
  if (!code.trim()) return NextResponse.json({ error: "ต้องระบุโค้ดบัตร" }, { status: 400 });

  const auth = await verifyCashierPin(device.tenantId, userId, pin);
  if (!auth.ok) return NextResponse.json({ error: "PIN ไม่ถูกต้อง", reason: auth.reason }, { status: 403 });
  if (!(await cashierHasPermission(device.tenantId, auth.userId, "storecredit.redeem"))) {
    return NextResponse.json({ error: "พนักงานคนนี้ไม่มีสิทธิ์รับบัตร" }, { status: 403 });
  }

  const credit = await findStoreCredit(device.tenantId, code);
  if (!credit) return NextResponse.json({ error: "ไม่พบบัตรนี้" }, { status: 404 });
  // ไม่ส่งข้อมูลลูกค้าที่ผูกกับบัตรออกไปมากกว่าชื่อ — จอเคาน์เตอร์ต้องรู้แค่ว่าใช้ได้ไหม
  return NextResponse.json({
    credit: {
      code: credit.code, balance: credit.balance, status: credit.status,
      expiresAt: credit.expiresAt, customerName: credit.customerName,
    },
  });
}

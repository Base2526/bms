// =============================================================
// POST /api/pos/member/preview — คิดส่วนลดสมาชิก + แลกแต้ม ก่อนกดขาย
// -------------------------------------------------------------
// จอ POS ต้องแสดงยอดสุทธิให้ลูกค้าเห็นก่อนรับเงิน แต่ห้ามคิดเองที่ client
// เพราะเลขต้องตรงกับที่ createOrder จะคิดตอน commit เป๊ะ ๆ (ฐาน VAT ใช้ค่านั้น)
//
// route นี้อ่านอย่างเดียว ไม่แตะแต้ม ไม่สร้างบิล — ตัวเลขจริงเกิดตอน /api/pos/sale
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticatePosDevice } from "@/lib/bms/pos";
import { previewMemberDiscount } from "@/lib/bms/membership";
import { previewCouponForCustomer } from "@/lib/bms/coupons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const subtotal = Number(body.subtotal);
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    return NextResponse.json({ error: "subtotal ไม่ถูกต้อง" }, { status: 400 });
  }
  const customerId = typeof body.customerId === "string" && body.customerId.trim() ? body.customerId.trim() : null;
  const pointsRequested = Number.isFinite(Number(body.pointsToRedeem)) ? Number(body.pointsToRedeem) : 0;
  const couponCode = typeof body.couponCode === "string" ? body.couponCode.trim() : "";

  // คูปองต้องตรวจด้วยกฎเดิมของมัน (ยอดขั้นต่ำ/จำนวนครั้ง/ต่อคน) ไม่ใช่คิด % เอง
  let couponDiscount = 0;
  let couponError: string | null = null;
  if (couponCode) {
    const check = await previewCouponForCustomer(device.tenantId, couponCode, customerId, subtotal);
    if (check.ok) couponDiscount = check.discount;
    else couponError = check.reason;
  }

  const preview = await previewMemberDiscount({
    tenantId: device.tenantId,
    customerId,
    subtotal,
    pointsRequested,
    couponDiscount,
  });

  return NextResponse.json({ ...preview, couponError }, { status: 200 });
}

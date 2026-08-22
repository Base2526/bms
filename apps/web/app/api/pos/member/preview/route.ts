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
import { getLoyaltySettings, previewMemberDiscount } from "@/lib/bms/membership";
import { previewCouponForCustomer } from "@/lib/bms/coupons";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
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
  // พรีวิวรวมส่วนลดมือด้วย ไม่งั้นยอดบนจอกับยอดที่ createOrder คิดจะต่างกัน แล้วบิลถูก
  // ตีตก PAYMENT_MISMATCH ตอนกดรับเงิน · จุดนี้ไม่ตรวจสิทธิ์ผู้อนุมัติ เพราะเป็นการอ่าน
  // อย่างเดียว การอนุมัติจริงเกิดที่ /api/pos/sale
  const manualRaw = Number(body.manualDiscount);
  const manualDiscount = Number.isFinite(manualRaw) && manualRaw > 0 ? Math.round(manualRaw * 100) / 100 : 0;

  // คูปองต้องตรวจด้วยกฎเดิมของมัน (ยอดขั้นต่ำ/จำนวนครั้ง/ต่อคน) ไม่ใช่คิด % เอง
  let couponDiscount = 0;
  let couponError: string | null = null;
  if (couponCode) {
    const check = await previewCouponForCustomer(device.tenantId, couponCode, customerId, subtotal);
    if (check.ok) couponDiscount = check.discount;
    else couponError = check.reason;
  }

  const [preview, settings] = await Promise.all([
    previewMemberDiscount({
      tenantId: device.tenantId,
      customerId,
      subtotal,
      pointsRequested,
      couponDiscount,
      manualDiscount,
    }),
    getLoyaltySettings(device.tenantId),
  ]);

  // ส่งอัตราแลกไปด้วย จอจึงบอกได้ว่า "แต้ม 320 = ลดได้ ฿32" และปรับจำนวนเป็น
  // ก้าวละ 1 หน่วยแลก (ไม่เหลือเศษแต้มที่ไม่ได้แปลงเป็นส่วนลด)
  return NextResponse.json({
    ...preview,
    couponError,
    redeemPointsPerUnit: settings.redeemPointsPerUnit,
    redeemBahtPerUnit: settings.redeemBahtPerUnit,
    redeemMinPoints: settings.redeemMinPoints,
  }, { status: 200 });
}

export const POST = withRouteErrorLog("POST /api/pos/member/preview", handlePOST);

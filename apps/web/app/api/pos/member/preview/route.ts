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
import { previewMemberDiscount, toPosMemberSummary } from "@/lib/bms/membership";
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
    const check = await previewCouponForCustomer(device.tenantId, couponCode, customerId, subtotal, device.locationId);
    if (check.ok) couponDiscount = check.discount;
    else couponError = check.reason;
  }

  const preview = await previewMemberDiscount({
    tenantId: device.tenantId,
    customerId,
    subtotal,
    pointsRequested,
    couponDiscount,
    manualDiscount,
  });

  // อัตราแลกทำให้จอบอกได้ว่า "แต้ม 320 = ลดได้ ฿32" และปรับจำนวนเป็นก้าวละ 1 หน่วยแลก
  // (ไม่เหลือเศษแต้มที่ไม่ได้แปลงเป็นส่วนลด) · loyaltyEnabled/pointsWillEarn ทำให้จอ
  // เตือนได้ก่อนรับเงินว่าบิลนี้จะไม่ได้แต้มและเพราะอะไร
  //
  // ทั้งชุดมาจาก previewMemberDiscount ตัวเดียว — เดิม route อ่าน settings ซ้ำอีกรอบ
  // ซึ่งเป็นสอง query ต่อการพิมพ์หนึ่งครั้ง และเปิดช่องให้สองที่อ่านค่าคนละรอบกัน
  return NextResponse.json({
    ...preview,
    member: preview.member ? toPosMemberSummary(preview.member) : null,
    couponError,
  }, { status: 200 });
}

export const POST = withRouteErrorLog("POST /api/pos/member/preview", handlePOST);

// =============================================================
// GET /api/pos/scan?code=... — ยิงบาร์โค้ด/QR แล้วได้สินค้า + หน่วยขาย + ราคา
// -------------------------------------------------------------
// auth: header `x-pos-device-token`
// เครื่องสแกนทำตัวเป็นคีย์บอร์ด (HID) → จอขายแค่จับ Enter แล้วเรียกที่นี่
//
// เครื่องหน้าร้าน "ห้ามคิดราคาเอง" ทุกครั้งที่ยิงต้องถามระบบ ไม่งั้นวันหนึ่ง
// ยอดหน้าร้านกับ Dashboard จะไม่ตรงกันแล้วหาสาเหตุไม่เจอ
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticatePosDevice, resolvePosScan } from "@/lib/bms/pos";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const code = (req.nextUrl.searchParams.get("code") ?? "").trim();
  if (!code) return NextResponse.json({ error: "ต้องระบุ code" }, { status: 400 });

  const hit = await resolvePosScan(device.tenantId, code);
  if (!hit) return NextResponse.json({ error: "ไม่พบสินค้าจากรหัสนี้", code }, { status: 404 });

  // ของคงเหลือของสาขานี้ — จอขายต้องเห็นก่อนกดเพิ่มลงตะกร้า
  const stock = await query<{ available: string }>(
    `SELECT (current_stock - reserved_stock) AS available
       FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [device.tenantId, device.locationId, hit.sku, hit.size]
  );

  return NextResponse.json({
    ...hit,
    available: stock.rowCount ? Number(stock.rows[0].available) : 0,
  });
}

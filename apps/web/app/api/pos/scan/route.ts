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
import { listPrimaryProductImages } from "@/lib/bms/products";
import { query } from "@/lib/db";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const code = (req.nextUrl.searchParams.get("code") ?? "").trim();
  // ไม่แปลงเป็นตัวพิมพ์ใหญ่ — "150 ml" ต้องคงรูปไว้ให้ตรงกับ bms_inventory
  const size = (req.nextUrl.searchParams.get("size") ?? "").trim() || null;
  // ใช้ตอน POS ตรวจราคาในตะกร้าซ้ำก่อนรับเงิน: SKU อย่างเดียวระบุ pack ไม่พอ
  // แต่ packCode ยังเป็นเพียงตัวค้นหา ราคา/baseQty ถูกอ่านจากฐานข้อมูลเสมอ
  const packCode = (req.nextUrl.searchParams.get("packCode") ?? "").trim() || null;
  if (!code) return NextResponse.json({ error: "ต้องระบุ code" }, { status: 400 });

  const hit = await resolvePosScan(device.tenantId, code, {
    size,
    locationId: device.locationId,
    packCode,
  });
  if (!hit) return NextResponse.json({ error: "ไม่พบสินค้าจากรหัสนี้", code }, { status: 404 });

  // ของคงเหลือของสาขานี้ — จอขายต้องเห็นก่อนกดเพิ่มลงตะกร้า
  const stock = await query<{ available: string }>(
    `SELECT (current_stock - reserved_stock) AS available
       FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [device.tenantId, device.locationId, hit.sku, hit.size]
  );

  // รูปเฉพาะโหมด "เช็คของ" ที่คนกำลังดูว่าใช่ตัวไหน — การยิงเพื่อ "ขาย" ไม่ขอ
  // เพราะเป็นเส้นทางที่ถูกเรียกทุกชิ้นของทุกบิล คิวรีที่เพิ่มมาตรงนั้นคือความหน่วง
  // ที่แคชเชียร์รู้สึกได้ แลกกับรูปที่ไม่มีใครดูตอนกำลังยิงของเข้าตะกร้า
  //
  // ไม่ขอ = ไม่ส่งฟิลด์นี้เลย (ไม่ใช่ส่ง null) เพราะจอเอาผลการยิงไป spread ทับ
  // บรรทัดในตะกร้าตอนตรวจราคาซ้ำก่อนรับเงิน — ส่ง null มาจะลบรูปที่บรรทัดนั้นถืออยู่
  const wantImage = req.nextUrl.searchParams.get("withImage") === "1";
  const imagePatch = wantImage
    ? { imageUrl: (await listPrimaryProductImages(device.tenantId, [hit.sku])).get(hit.sku) ?? null }
    : {};

  return NextResponse.json({
    ...hit,
    available: stock.rowCount ? Number(stock.rows[0].available) : 0,
    ...imagePatch,
  });
}

export const GET = withRouteErrorLog("GET /api/pos/scan", handleGET);

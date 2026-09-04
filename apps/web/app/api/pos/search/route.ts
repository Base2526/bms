// =============================================================
// GET /api/pos/search?q=... — ค้นสินค้าหน้าร้านจากชื่อ/SKU/barcode/alias
// -------------------------------------------------------------
// ใช้ตอนบาร์โค้ดไม่ติดหรือสินค้ายังไม่แปะบาร์โค้ด
// การเพิ่มลงตะกร้ายังให้ /api/pos/scan เป็นคนตัดสินราคา/size ที่ขาย
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticatePosDevice } from "@/lib/bms/pos";
import { listPrimaryProductImages, listSellableProducts } from "@/lib/bms/products";
import { normalizePosSearchQuery } from "@/lib/bms/posRouteHelpers";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const q = normalizePosSearchQuery(req.nextUrl.searchParams.get("q"));
  if (!q) return NextResponse.json({ items: [] });

  const { items } = await listSellableProducts(device.tenantId, {
    search: q,
    inStockOnly: true,
    sort: "relevance",
    limit: 8,
    locationId: device.locationId,
    salesSurface: "RETAIL_POS",
  });

  // รูปย่อสำหรับ "เลือกด้วยตา" — ผลค้นหาคือจุดที่แคชเชียร์ยังไม่รู้ว่าใช่ตัวไหน
  // (ของที่ชื่อคล้ายกันคนละสูตร/คนละกลิ่น) ต่างจากการยิงบาร์โค้ดที่ยืนยันตัวสินค้า
  // ได้แม่นกว่ารูปอยู่แล้ว · คิวรีเพิ่มหนึ่งครั้งต่อการค้น ไม่ใช่ต่อการยิงขาย
  const imagesBySku = await listPrimaryProductImages(
    device.tenantId,
    items.map((item) => item.sku)
  );

  return NextResponse.json({
    items: items.map((item) => ({
      sku: item.sku,
      name: item.name,
      price: item.price,
      availableTotal: item.availableTotal,
      availability: item.availability,
      availableSizes: item.availableSizes,
      imageUrl: imagesBySku.get(item.sku) ?? null,
    })),
  });
}

export const GET = withRouteErrorLog("GET /api/pos/search", handleGET);

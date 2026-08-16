// =============================================================
// GET /api/pos/search?q=... — ค้นสินค้าหน้าร้านจากชื่อ/SKU/barcode/alias
// -------------------------------------------------------------
// ใช้ตอนบาร์โค้ดไม่ติดหรือสินค้ายังไม่แปะบาร์โค้ด
// การเพิ่มลงตะกร้ายังให้ /api/pos/scan เป็นคนตัดสินราคา/size ที่ขาย
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticatePosDevice } from "@/lib/bms/pos";
import { listSellableProducts } from "@/lib/bms/products";
import { normalizePosSearchQuery } from "@/lib/bms/posRouteHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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
  });

  return NextResponse.json({
    items: items.map((item) => ({
      sku: item.sku,
      name: item.name,
      price: item.price,
      availableTotal: item.availableTotal,
      availableSizes: item.availableSizes,
    })),
  });
}

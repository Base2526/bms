// =============================================================
// GET /api/pos/last-sale — บิลล่าสุดของเครื่องนี้
// -------------------------------------------------------------
// ใช้สำหรับพิมพ์ซ้ำหลังรีเฟรชหน้า/ล้าง state ฝั่ง browser
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticatePosDevice, getLatestPosSale } from "@/lib/bms/pos";
import { getLocation } from "@/lib/bms/locations";
import { decoratePosSale } from "@/lib/bms/posRouteHelpers";
import { getVatSettings } from "@/lib/bms/taxDocuments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const [sale, location, vat] = await Promise.all([
    getLatestPosSale(device.tenantId, device.id),
    getLocation(device.tenantId, device.locationId),
    getVatSettings(device.tenantId),
  ]);
  if (!sale) return NextResponse.json({ sale: null });

  return NextResponse.json({
    sale: decoratePosSale(sale as Record<string, unknown>, {
      storeName: location?.name ?? null,
      branchCode: location?.branchCode ?? null,
      posLabel: device.registeredPosNo ?? device.code,
      vatRegistered: vat.vatRegistered,
    }),
  });
}

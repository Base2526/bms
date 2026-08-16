// =============================================================
// GET /api/pos/recent-sales — บิลล่าสุดหลายใบของเครื่องนี้
// -------------------------------------------------------------
// ใช้สำหรับ reprint ย้อนหลังจากหน้า POS
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticatePosDevice, listRecentPosSales } from "@/lib/bms/pos";
import { normalizePosSearchQuery } from "@/lib/bms/posRouteHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 5);
  const q = normalizePosSearchQuery(req.nextUrl.searchParams.get("q"));
  const sales = await listRecentPosSales(
    device.tenantId,
    device.id,
    Number.isFinite(limit) ? limit : 5,
    { query: q || null }
  );
  return NextResponse.json({ sales });
}

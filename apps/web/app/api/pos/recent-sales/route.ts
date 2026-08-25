// =============================================================
// GET /api/pos/recent-sales — บิลล่าสุดหลายใบของเครื่องนี้
// -------------------------------------------------------------
// ใช้สำหรับ reprint/return lookup จากหน้า POS
// ถ้าไม่มีคำค้น จะคืนเฉพาะบิลล่าสุดของเครื่องนี้
// ถ้ามีคำค้น route จะส่งต่อให้ service ขยายไปค้นย้อนหลังข้ามเครื่อง POS ทั้ง tenant ได้
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticatePosDevice, listRecentPosSales } from "@/lib/bms/pos";
import { normalizePosSearchQuery } from "@/lib/bms/posRouteHelpers";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
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
    { query: q || null, locationId: device.locationId }
  );
  return NextResponse.json({ sales });
}

export const GET = withRouteErrorLog("GET /api/pos/recent-sales", handleGET);

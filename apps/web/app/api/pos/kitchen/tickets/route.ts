// =============================================================
// GET /api/pos/kitchen/tickets — POS ร้านอาหารอ่านคิวครัวของร้านตัวเอง
// -------------------------------------------------------------
// auth: header `x-pos-device-token` — ใช้จอที่จับคู่กับเครื่องครัว/จอรับออเดอร์
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticatePosDevice } from "@/lib/bms/pos";
import { listKitchenTickets } from "@/lib/bms/kitchen";
import { getKitchenStationSlaMap } from "@/lib/bms/kitchenSla";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const statusRaw = (req.nextUrl.searchParams.get("status") ?? "").trim();
  const status = statusRaw ? statusRaw.toUpperCase() : null;
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
  // เกณฑ์เวลาต่อสถานี (9.53) มากับคิวรอบเดียวกัน — จอครัวคำนวณสีเองทุกวินาที ถ้าให้ยิงแยก
  // จะกลายเป็นคำขอที่สองต่อการรีเฟรชหนึ่งครั้งโดยไม่ได้อะไรเพิ่ม
  const [tickets, stationSlas] = await Promise.all([
    listKitchenTickets(device.tenantId, status, limit, device.locationId),
    getKitchenStationSlaMap(device.tenantId),
  ]);

  return NextResponse.json({ tickets, stationSlas });
}

export const GET = withRouteErrorLog("GET /api/pos/kitchen/tickets", handleGET);

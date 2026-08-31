// =============================================================
// GET /api/pos/kitchen/tickets — POS ร้านอาหารอ่านคิวครัวของร้านตัวเอง
// -------------------------------------------------------------
// auth: header `x-pos-device-token` — ใช้จอที่จับคู่กับเครื่องครัว/จอรับออเดอร์
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticatePosDevice } from "@/lib/bms/pos";
import { listKitchenTickets } from "@/lib/bms/kitchen";
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
  const tickets = await listKitchenTickets(device.tenantId, status, limit, device.locationId);

  return NextResponse.json({ tickets });
}

export const GET = withRouteErrorLog("GET /api/pos/kitchen/tickets", handleGET);

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
import { listKitchenStations } from "@/lib/bms/kitchenStations";
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
  // ทะเบียนสถานี (9.54) มากับคิวรอบเดียวกันด้วยเหตุผลเดียวกับเกณฑ์เวลา · กรองตามสาขาของ
  // เครื่อง (สถานีระดับร้าน + ของสาขานี้) — ครัวสาขา A ไม่ต้องมีปุ่มของครัวสาขา B
  //
  // ⚠️ ทะเบียนล้ม **ต้องไม่ทำให้จอครัวดับ** — มันเป็นแค่ปุ่มกรอง ส่วนตั๋วคือของจริงที่ครัวต้องเห็น
  // ฐานที่ยังไม่ apply `9.54` (หรือสิทธิ์ไม่ถึง) จะได้ปุ่มกรองจาก "สถานีที่โผล่บนตั๋วจริง" แทน
  // ซึ่งคือพฤติกรรมก่อน 9.54 พอดี · เหตุผลเดียวกับ `bmsKitchenBoardEnabled` ที่กลืน error
  // เพื่อไม่ให้ sidebar พังทั้งอัน — จอครัวว่างเพราะการตั้งค่า ครัวอ่านว่า "ระบบไม่ส่งงานมา"
  const [tickets, stationSlas, stations] = await Promise.all([
    listKitchenTickets(device.tenantId, status, limit, device.locationId),
    getKitchenStationSlaMap(device.tenantId),
    listKitchenStations(device.tenantId, { locationId: device.locationId }).catch((error) => {
      console.error("[BMS] kitchen station master unavailable for KDS filters", error);
      return [];
    }),
  ]);

  return NextResponse.json({
    tickets,
    stationSlas,
    stations: stations.map((station) => ({
      id: station.id,
      name: station.name,
      sortOrder: station.sortOrder,
    })),
  });
}

export const GET = withRouteErrorLog("GET /api/pos/kitchen/tickets", handleGET);

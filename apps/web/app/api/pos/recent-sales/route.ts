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
import { searchDeposits } from "@/lib/bms/deposits";
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
  // แท็บคืนค้นได้เฉพาะบิลที่ปิดแล้ว (COMPLETED/RETURNED) ซึ่งถูกต้อง — ของที่ยังไม่ได้
  // ส่งมอบจะ "คืน" ไม่ได้ · แต่พนักงานที่ถือใบเสร็จมาย่อมมาค้นที่นี่ก่อน แล้วเดิมได้
  // คำตอบว่า "ไม่พบ" ทั้งที่บิลมีอยู่จริงในรูปของมัดจำ → บอกไปเลยว่าอยู่ที่ไหน
  // นี่เป็นแค่การชี้ทาง ไม่ได้เปิดให้คืนของที่ยังไม่ได้ส่งมอบ
  const depositMatches = sales.length === 0 && q
    ? await searchDeposits(device.tenantId, q, { locationId: device.locationId, limit: 5 })
    : [];

  return NextResponse.json({ sales, depositMatches });
}

export const GET = withRouteErrorLog("GET /api/pos/recent-sales", handleGET);

// =============================================================
// /api/bms/store-credit — ออก/ดู บัตรของขวัญและเครดิตร้าน (8.9)
// -------------------------------------------------------------
// GET  ?code=   ดูบัตรใบเดียว · ไม่ใส่ = ยอดค้างรวม (ตัวเลขสำหรับบัญชี)
// POST          ออกบัตรใหม่ (ต้องมี storecredit.issue)
//
// .issue แยกจาก .redeem เพราะการออกบัตรคือการ "สร้างเงิน" ขึ้นมาในระบบ
// ส่วนการรับบัตรเป็นการรับชำระเงินตามปกติ
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { findStoreCredit, getStoreCreditOutstanding, issueStoreCredit } from "@/lib/bms/storeCredit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("storecredit.redeem");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });

  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const credit = await findStoreCredit(auth.tenantId, code);
    return NextResponse.json({ credit }, { status: credit ? 200 : 404 });
  }
  return NextResponse.json({ outstanding: await getStoreCreditOutstanding(auth.tenantId) });
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("storecredit.issue");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await issueStoreCredit({
    tenantId: auth.tenantId,
    amount: Number(body.amount ?? 0),
    customerId: typeof body.customerId === "string" && body.customerId.trim() ? body.customerId.trim() : null,
    code: typeof body.code === "string" ? body.code : null,
    expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
    note: typeof body.note === "string" ? body.note : null,
    issuedBy: String(auth.adminId),
  });
  return NextResponse.json(result, { status: result.status === "ISSUED" ? 200 : 400 });
}

export const GET = withRouteErrorLog("GET /api/bms/store-credit", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/store-credit", handlePOST);

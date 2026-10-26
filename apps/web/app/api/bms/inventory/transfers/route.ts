// =============================================================
// /api/bms/inventory/transfers — โอนย้ายสต็อกระหว่างสาขา (7.98)
// -------------------------------------------------------------
// GET  ?status=  รายการใบโอน
// POST {action:"create"|"send"|"receive"|"cancel"}
//
// สองขั้น (ส่ง → รับ) โดยตั้งใจ — ของที่ยัง IN_TRANSIT ไม่อยู่ในสต็อกสาขาไหน
// ซึ่งตรงกับความจริงว่ามันอยู่บนรถ
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { listLocationsForUser } from "@/lib/bms/locations";
import { commandStaffStockTransfer } from "@/lib/bms/staffStockTransfers";
import {
  listStockTransfers,
  type StockTransferStatus,
} from "@/lib/bms/stockTransfers";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: StockTransferStatus[] = ["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"];

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("inventory.transfer");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });

  const raw = req.nextUrl.searchParams.get("status");
  const status = STATUSES.includes(raw as StockTransferStatus) ? (raw as StockTransferStatus) : null;
  const id = req.nextUrl.searchParams.get("id");
  if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return NextResponse.json({ error: "Invalid transfer identifier" }, { status: 400 });

  // สาขาเดินทางมาพร้อมใบโอน — หน้าจอต้องมีตัวเลือกสาขาเสมอ และการให้ไปดึงเอง
  // ผ่าน GraphQL bmsLocations จะบังคับสิทธิ์ product.view ซึ่งคลังสินค้าอาจไม่มี
  const [transfers, locations] = await Promise.all([
    listStockTransfers(auth.tenantId, status, 50, id, null, String(auth.adminId)),
    listLocationsForUser(auth.tenantId, String(auth.adminId)),
  ]);
  return NextResponse.json({ transfers, locations, commandScope: `${auth.tenantId}:${auth.adminId}` });
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("inventory.transfer");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });

  const body: unknown = await req.json().catch(() => null);
  // A UI precondition, never tenant/actor authority. Protect stale tabs after a
  // login or drill-down change; other API clients can omit this optional field.
  if (body && typeof body === "object" && "commandScope" in body &&
      body.commandScope !== `${auth.tenantId}:${auth.adminId}`) {
    return NextResponse.json({ status: "SCOPE_CHANGED", reason: "ผู้ใช้หรือร้านเปลี่ยนไป กรุณารีเฟรชก่อนตรวจผลคำขอเดิม" }, { status: 409 });
  }
  const result = await commandStaffStockTransfer(auth.tenantId, String(auth.adminId), body);
  const status = result.status === "OK" || result.status === "CREATED" ? 200
    : result.status === "INVALID" ? 400
    : result.status === "FORBIDDEN" ? 403
    : result.status === "NOT_FOUND" ? 404
    : 409;
  return NextResponse.json(result, { status });
}

export const GET = withRouteErrorLog("GET /api/bms/inventory/transfers", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/inventory/transfers", handlePOST);

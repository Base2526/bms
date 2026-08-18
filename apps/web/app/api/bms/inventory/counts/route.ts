// =============================================================
// /api/bms/inventory/counts — นับสต็อก (7.98)
// -------------------------------------------------------------
// GET  ?status=  รายการใบนับ
// POST {action:"create"|"item"|"apply"|"cancel"}
//
// "apply" ใช้สิทธิ์คนละตัวกับการนับ (inventory.count.apply) เพราะการยอมรับว่า
// ของหายไปเท่านั้นจริงเป็นการตัดสินใจทางบัญชี ไม่ใช่งานเดินนับของ
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  applyStockCount,
  cancelStockCount,
  createStockCount,
  listStockCounts,
  recordCountItem,
  type StockCountStatus,
} from "@/lib/bms/stockCounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: StockCountStatus[] = ["DRAFT", "APPLIED", "CANCELLED"];

export async function GET(req: NextRequest) {
  const auth = await authorizeAdminRoute("inventory.count");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });

  const raw = req.nextUrl.searchParams.get("status");
  const status = STATUSES.includes(raw as StockCountStatus) ? (raw as StockCountStatus) : null;
  return NextResponse.json({ counts: await listStockCounts(auth.tenantId, status) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  // ปิดใบนับต้องใช้สิทธิ์ที่สูงกว่าการกรอกตัวเลข
  const auth = await authorizeAdminRoute(action === "apply" ? "inventory.count.apply" : "inventory.count");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const actorUserId = String(auth.adminId);

  if (action === "create") {
    const result = await createStockCount({
      tenantId: auth.tenantId,
      locationId: String(body.locationId ?? ""),
      note: typeof body.note === "string" ? body.note : null,
      createdBy: actorUserId,
    });
    return NextResponse.json(result, { status: result.status === "CREATED" ? 200 : 400 });
  }

  const countId = String(body.countId ?? "");
  if (!countId) return NextResponse.json({ error: "ต้องระบุ countId" }, { status: 400 });

  if (action === "item") {
    const result = await recordCountItem({
      tenantId: auth.tenantId, countId,
      sku: String(body.sku ?? ""), size: String(body.size ?? ""),
      countedQty: Number(body.countedQty ?? 0),
      note: typeof body.note === "string" ? body.note : null,
      actorUserId,
    });
    const status = result.status === "OK" ? 200 : result.status === "NOT_FOUND" ? 404
      : result.status === "WRONG_STATE" ? 409 : 400;
    return NextResponse.json(result, { status });
  }

  if (action === "apply") {
    const result = await applyStockCount({ tenantId: auth.tenantId, countId, actorUserId });
    const status = result.status === "APPLIED" ? 200 : result.status === "NOT_FOUND" ? 404 : 409;
    return NextResponse.json(result, { status });
  }

  if (action === "cancel") {
    const result = await cancelStockCount({ tenantId: auth.tenantId, countId, actorUserId });
    const status = result.status === "OK" ? 200 : result.status === "NOT_FOUND" ? 404 : 409;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json({ error: "action ไม่ถูกต้อง" }, { status: 400 });
}

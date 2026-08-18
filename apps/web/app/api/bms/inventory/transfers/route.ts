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
import { listLocations } from "@/lib/bms/locations";
import {
  cancelStockTransfer,
  createStockTransfer,
  listStockTransfers,
  receiveStockTransfer,
  sendStockTransfer,
  type StockTransferStatus,
} from "@/lib/bms/stockTransfers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: StockTransferStatus[] = ["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"];

export async function GET(req: NextRequest) {
  const auth = await authorizeAdminRoute("inventory.transfer");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });

  const raw = req.nextUrl.searchParams.get("status");
  const status = STATUSES.includes(raw as StockTransferStatus) ? (raw as StockTransferStatus) : null;

  // สาขาเดินทางมาพร้อมใบโอน — หน้าจอต้องมีตัวเลือกสาขาเสมอ และการให้ไปดึงเอง
  // ผ่าน GraphQL bmsLocations จะบังคับสิทธิ์ product.view ซึ่งคลังสินค้าอาจไม่มี
  const [transfers, locations] = await Promise.all([
    listStockTransfers(auth.tenantId, status),
    listLocations(auth.tenantId),
  ]);
  return NextResponse.json({ transfers, locations });
}

export async function POST(req: NextRequest) {
  const auth = await authorizeAdminRoute("inventory.transfer");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const actorUserId = String(auth.adminId);

  if (action === "create") {
    const result = await createStockTransfer({
      tenantId: auth.tenantId,
      fromLocationId: String(body.fromLocationId ?? ""),
      toLocationId: String(body.toLocationId ?? ""),
      items: Array.isArray(body.items) ? (body.items as any[]) : [],
      note: typeof body.note === "string" ? body.note : null,
      createdBy: actorUserId,
    });
    return NextResponse.json(result, { status: result.status === "CREATED" ? 200 : 400 });
  }

  const transferId = String(body.transferId ?? "");
  if (!transferId) return NextResponse.json({ error: "ต้องระบุ transferId" }, { status: 400 });

  const result =
    action === "send" ? await sendStockTransfer({ tenantId: auth.tenantId, transferId, actorUserId })
    : action === "receive" ? await receiveStockTransfer({
        tenantId: auth.tenantId, transferId, actorUserId,
        received: Array.isArray(body.received) ? (body.received as any[]) : undefined,
      })
    : action === "cancel" ? await cancelStockTransfer({ tenantId: auth.tenantId, transferId, actorUserId })
    : null;

  if (!result) return NextResponse.json({ error: "action ไม่ถูกต้อง" }, { status: 400 });
  const status = result.status === "OK" ? 200 : result.status === "NOT_FOUND" ? 404 : 409;
  return NextResponse.json(result, { status });
}

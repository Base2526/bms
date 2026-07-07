// =============================================================
// /api/bms/purchase — สร้าง PO (POST) + list PO (GET)   [Phase 1: default tenant]
// -------------------------------------------------------------
//   curl -X POST http://localhost:3000/api/bms/purchase \
//     -H "content-type: application/json" \
//     -d '{"supplierName":"ABC Trading","note":"lot ก.ค.",
//          "items":[{"sku":"NIKE-AIR","size":"XL","qty":20,"unitCost":1800}]}'
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createPurchaseOrder,
  listPurchaseOrders,
  type PoItemInput,
} from "@/lib/bms/purchase";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit")) || 50;
  const offset = Number(url.searchParams.get("offset")) || 0;
  const rows = await listPurchaseOrders(DEFAULT_TENANT_ID, limit, offset);
  return NextResponse.json({ purchaseOrders: rows });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    supplierId?: unknown;
    supplierName?: unknown;
    note?: unknown;
    items?: unknown;
  };

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: PoItemInput[] = rawItems.map((r: any) => ({
    sku: String(r?.sku ?? "").trim(),
    size: String(r?.size ?? "").trim(),
    qty: Number(r?.qty),
    unitCost: Number(r?.unitCost ?? 0),
  }));

  if (items.length === 0) {
    return NextResponse.json({ error: "items is required" }, { status: 400 });
  }

  const result = await createPurchaseOrder({
    tenantId: DEFAULT_TENANT_ID,
    supplierId: typeof body.supplierId === "string" ? body.supplierId : null,
    supplierName: typeof body.supplierName === "string" ? body.supplierName : null,
    note: typeof body.note === "string" ? body.note : null,
    items,
  });

  const httpStatus =
    result.status === "CREATED" ? 201 : result.status === "NOT_FOUND" ? 404 : 400; // EMPTY

  return NextResponse.json(result, { status: httpStatus });
}

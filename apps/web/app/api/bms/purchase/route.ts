// =============================================================
// /api/bms/purchase — สร้าง PO (POST) + list PO (GET)   [signed admin + RBAC · tenant จาก session]
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
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("purchase.view");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? "";
  const limit = Number(url.searchParams.get("limit")) || 50;
  const offset = Number(url.searchParams.get("offset")) || 0;
  const rows = await listPurchaseOrders(auth.tenantId, search, limit, offset);
  return NextResponse.json({ purchaseOrders: rows });
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("purchase.edit");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
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
    supplierSku: typeof r?.supplierSku === "string" ? r.supplierSku : null,
    supplierProductName: typeof r?.supplierProductName === "string" ? r.supplierProductName : null,
    supplierBarcode: typeof r?.supplierBarcode === "string" ? r.supplierBarcode : null,
    packQty: r?.packQty == null ? null : Number(r.packQty),
    minOrderQty: r?.minOrderQty == null ? null : Number(r.minOrderQty),
    leadTimeDays: r?.leadTimeDays == null ? null : Number(r.leadTimeDays),
  }));

  if (items.length === 0) {
    return NextResponse.json({ error: "items is required" }, { status: 400 });
  }

  const result = await createPurchaseOrder({
    tenantId: auth.tenantId,
    supplierId: typeof body.supplierId === "string" ? body.supplierId : null,
    supplierName: typeof body.supplierName === "string" ? body.supplierName : null,
    note: typeof body.note === "string" ? body.note : null,
    items,
  });

  const httpStatus =
    result.status === "CREATED" ? 201
      : result.status === "NOT_FOUND" || result.status === "SUPPLIER_NOT_FOUND" ? 404
        : result.status === "SUPPLIER_SKU_CONFLICT" ? 409
          : 400;

  return NextResponse.json(result, { status: httpStatus });
}

export const GET = withRouteErrorLog("GET /api/bms/purchase", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/purchase", handlePOST);

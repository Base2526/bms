// =============================================================
// POST /api/bms/purchase/:id/receive — รับของเข้าสต็อก (บางส่วน/ครบ)
// -------------------------------------------------------------
//   curl -X POST http://localhost:3000/api/bms/purchase/<poId>/receive \
//     -H "content-type: application/json" \
//     -d '{"items":[{"sku":"NIKE-AIR","size":"XL","qty":10}]}'
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { receivePurchaseOrder, type ReceiveInput } from "@/lib/bms/purchase";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("purchase.receive");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const poId = params.id?.trim();
  if (!poId) return NextResponse.json({ error: "po id required" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { items?: unknown };
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: ReceiveInput[] = rawItems.map((r: any) => ({
    sku: String(r?.sku ?? "").trim(),
    size: String(r?.size ?? "").trim(),
    qty: Number(r?.qty),
  }));

  if (items.length === 0) {
    return NextResponse.json({ error: "items is required" }, { status: 400 });
  }

  const result = await receivePurchaseOrder(auth.tenantId, poId, items);

  const httpStatus =
    result.status === "RECEIVED" || result.status === "PARTIAL"
      ? 200
      : result.status === "PO_NOT_FOUND" || result.status === "LINE_NOT_FOUND"
      ? 404
      : result.status === "INVALID_STATE" || result.status === "OVER_RECEIVE"
      ? 409
      : 400; // EMPTY

  return NextResponse.json(result, { status: httpStatus });
}

export const POST = withRouteErrorLog("POST /api/bms/purchase/[id]/receive", handlePOST);

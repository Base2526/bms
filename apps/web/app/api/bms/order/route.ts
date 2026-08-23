// =============================================================
// POST /api/bms/order — สร้าง order + reserve สต็อก (atomic)
// -------------------------------------------------------------
//   curl -X POST http://localhost:3000/api/bms/order \
//     -H "content-type: application/json" \
//     -d '{"channel":"line","customerRef":"U123","items":[{"sku":"NIKE-AIR","size":"XL","qty":2}]}'
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createOrder, type OrderItemInput } from "@/lib/bms/orders";
import type { Channel } from "@/lib/bms/pipeline";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS: Channel[] = ["line", "tiktok", "facebook", "instagram", "web", "shopee", "lazada", "test"];

async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    channel?: unknown;
    customerRef?: unknown;
    items?: unknown;
    couponCode?: unknown;
  };

  const channel = CHANNELS.includes(body.channel as Channel)
    ? (body.channel as Channel)
    : "test";
  const customerRef =
    typeof body.customerRef === "string" ? body.customerRef : null;

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: OrderItemInput[] = rawItems.map((r: any) => ({
    sku: String(r?.sku ?? "").trim(),
    size: String(r?.size ?? "").trim(),
    qty: Number(r?.qty),
  }));

  if (items.length === 0) {
    return NextResponse.json({ error: "items is required" }, { status: 400 });
  }

  const couponCode = typeof body.couponCode === "string" ? body.couponCode : null;
  const result = await createOrder({ tenantId: DEFAULT_TENANT_ID, channel, customerRef, items, couponCode });

  const httpStatus =
    result.status === "CREATED"
      ? 201
      : result.status === "NOT_FOUND"
      ? 404
      : result.status === "EMPTY"
      ? 400
      : result.status === "INVALID_ITEM"
      ? 400
      : 409; // INSUFFICIENT / COUPON_INVALID

  return NextResponse.json(result, { status: httpStatus });
}

export const POST = withRouteErrorLog("POST /api/bms/order", handlePOST);

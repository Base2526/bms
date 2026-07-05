// =============================================================
// POST /api/bms/reserve — จองสต็อกตอนลูกค้ายืนยันสั่งซื้อ
// -------------------------------------------------------------
//   curl -X POST http://localhost:3000/api/bms/reserve \
//     -H "content-type: application/json" \
//     -d '{"sku":"NIKE-AIR","size":"XL","qty":2}'
//
// เพิ่ม reserved_stock แบบ atomic (กัน oversell) — ไม่ตัด current_stock
// จนกว่าจะจัดส่งจริง ตาม BUSINESS_RULES (Available = Current - Reserved)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { reserveStock } from "@/lib/bms/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    sku?: unknown;
    size?: unknown;
    qty?: unknown;
  };

  const sku = typeof body.sku === "string" ? body.sku.trim() : "";
  const size = typeof body.size === "string" ? body.size.trim() : "";
  const qty = Number(body.qty);

  if (!sku || !size || !Number.isInteger(qty) || qty <= 0) {
    return NextResponse.json(
      { error: "sku, size, qty (positive integer) are required" },
      { status: 400 }
    );
  }

  const result = await reserveStock(sku, size, qty);

  const httpStatus =
    result.status === "RESERVED"
      ? 200
      : result.status === "NOT_FOUND"
      ? 404
      : 409; // INSUFFICIENT → conflict

  return NextResponse.json(result, { status: httpStatus });
}

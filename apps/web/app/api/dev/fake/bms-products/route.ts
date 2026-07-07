// apps/web/app/api/dev/fake/bms-products/route.ts
// สร้าง BMS products + inventory (S/M/L/XL) จำนวนมากในคิวรี่เดียว (generate_series)
// mark ด้วย SKU prefix 'FAKE-' + keyword 'fake' เพื่อ cleanup ได้
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrInternal } from "@/lib/dev-guards";
import { query } from "@/lib/db";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Disabled in production" }, { status: 403 });

  const guard = requireAdminOrInternal(req);
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body?.count) || 5, 1), 2000);
  const tenantId = typeof body?.tenantId === "string" && body.tenantId.trim() ? body.tenantId.trim() : DEFAULT_TENANT_ID;

  // np: N products · inv: N × 4 sizes (data-modifying CTE รันครบเสมอแม้ไม่ถูก select)
  const sql = `
    WITH np AS (
      INSERT INTO bms_products (tenant_id, sku, name, active, price, keywords)
      SELECT $1,
             'FAKE-' || substr(md5(random()::text || g::text || clock_timestamp()::text), 1, 12),
             'Fake Product ' || g,
             true,
             (100 + floor(random() * 4900))::numeric(12,2),
             ARRAY['fake','test']
        FROM generate_series(1, $2) g
      RETURNING sku, name, price
    ),
    inv AS (
      INSERT INTO bms_inventory (tenant_id, product_sku, size, current_stock, reserved_stock, reorder_point)
      SELECT $1, np.sku, s.size, floor(random() * 50)::int, 0, 5
        FROM np CROSS JOIN (VALUES ('S'),('M'),('L'),('XL')) AS s(size)
      RETURNING 1
    )
    SELECT sku, name, price FROM np ORDER BY sku`;

  try {
    const { rows } = await query(sql, [tenantId, count]);
    return NextResponse.json({ ok: true, created: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: 500 });
  }
}

// apps/web/app/api/dev/fake/bms-products/route.ts
// สร้าง BMS products + inventory (S/M/L/XL) จำนวนมากในคิวรี่เดียว (generate_series)
// mark ด้วย SKU prefix 'FAKE-' + keyword 'fake' เพื่อ cleanup ได้
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrInternal, fakeSeedDisabled } from "@/lib/dev-guards";
import { query } from "@/lib/db";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });

  const guard = requireAdminOrInternal(req);
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body?.count) || 5, 1), 2000);
  // seed ลงร้านของผู้ล็อกอิน (ร้านค้าเทสได้เอง เห็นใน list ตัวเอง) — fallback: body.tenantId → default
  const tenantId = guard.actor?.tenant_id
    || (typeof body?.tenantId === "string" && body.tenantId.trim() ? body.tenantId.trim() : DEFAULT_TENANT_ID);

  // gen: สุ่ม sku/price/category/brand ก่อน เพื่อให้ cost_price + image_url อ้าง sku/price เดียวกันได้
  // np: N products (แนบรูป placeholder จาก picsum ตาม sku เป็น seed — deterministic, ไม่ต้องดาวน์โหลดไฟล์จริง)
  // inv: N × 4 sizes (data-modifying CTE รันครบเสมอแม้ไม่ถูก select)
  const sql = `
    WITH gen AS (
      SELECT
        'FAKE-' || substr(md5(random()::text || g::text || clock_timestamp()::text), 1, 12) AS sku,
        g,
        (100 + floor(random() * 4900))::numeric(12,2) AS price,
        (ARRAY['เสื้อผ้า','รองเท้า','เครื่องประดับ','กระเป๋า','อุปกรณ์กีฬา'])[1 + floor(random() * 5)::int] AS category,
        (ARRAY['Nike','Adidas','Uniqlo','Zara','No Brand'])[1 + floor(random() * 5)::int] AS brand
      FROM generate_series(1, $2) g
    ),
    np AS (
      INSERT INTO bms_products (tenant_id, sku, name, active, price, keywords, image_url, description, cost_price, category, brand)
      SELECT $1, sku, 'Fake Product ' || g, true, price, ARRAY['fake','test'],
             'https://picsum.photos/seed/' || sku || '/400/400',
             'สินค้าทดสอบสำหรับ demo/QA (สร้างโดยระบบอัตโนมัติ) — Fake Product ' || g,
             (price * (0.4 + random() * 0.3))::numeric(12,2),
             category, brand
        FROM gen
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

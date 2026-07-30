// apps/web/app/api/dev/fake/bms-orders/route.ts
// สร้าง BMS orders (backdate กระจาย 30 วัน, หลายสถานะ/ช่องทาง) + พ่วง payment/shipment
// เพื่อเติม Dashboard / Reports / CRM / Payment / Shipping
//
// marker: customer_ref ขึ้นต้น 'FAKE-' → cleanup ลบได้ (items/payments/shipments cascade)
// หมายเหตุ: ไม่ขยับสต็อก (ใช้เติม analytics) — ถ้าจะเทสต์ flow จ่าย/ส่งจริง ให้สั่งผ่าน Playground
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled } from "@/lib/dev-guards";
import { getClient, query } from "@/lib/db";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const R = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]): T => a[R(a.length)];
const short = () => Math.random().toString(36).slice(2, 10);
const sample = <T,>(a: T[], k: number): T[] => {
  const c = [...a]; const out: T[] = [];
  for (let j = 0; j < k && c.length; j++) out.push(c.splice(R(c.length), 1)[0]);
  return out;
};

const DAYS = 30;
const CHANNELS = ["line", "tiktok", "facebook", "instagram", "web", "shopee", "lazada"];
// revenue-heavy (ไม่ใส่ PENDING/PACKING เพราะไม่ได้ reserve สต็อก)
const STATUS_POOL = ["COMPLETED", "COMPLETED", "COMPLETED", "PAID", "PAID", "SHIPPED", "SHIPPED", "CANCELLED", "RETURNED"];
const METHODS = ["BANK_TRANSFER", "QR", "CARD", "TIKTOK", "CASH"];
const CARRIERS = ["FLASH", "KERRY", "DHL", "AUSPOST", "NZPOST"];
const PAID_SET = new Set(["PAID", "SHIPPED", "COMPLETED"]);
const SHIP_SET = new Set(["SHIPPED", "COMPLETED"]);

async function bulkInsert(client: any, table: string, cols: string[], rows: any[][]) {
  if (!rows.length) return 0;
  const ph: string[] = [];
  const params: any[] = [];
  rows.forEach((r, ri) => {
    ph.push("(" + cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(",") + ")");
    params.push(...r);
  });
  await client.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${ph.join(",")}`, params);
  return rows.length;
}

export async function POST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body?.count) || 20, 1), 2000);
  // seed ลงร้านของผู้ล็อกอิน (ร้านค้าเทสได้เอง เห็นใน list ตัวเอง) — fallback: body.tenantId → default
  const tenantId = guard.actor?.tenant_id
    || (typeof body?.tenantId === "string" && body.tenantId.trim() ? body.tenantId.trim() : DEFAULT_TENANT_ID);

  // pool ของ variant (เลือก FAKE- ก่อน แต่รวมของจริงด้วย) + customers
  const variants = (await query(
    `SELECT i.product_sku AS sku, i.size, p.price
       FROM bms_inventory i
       JOIN bms_products p ON p.tenant_id = i.tenant_id AND p.sku = i.product_sku
      WHERE i.tenant_id = $1 AND p.active
      ORDER BY (p.sku LIKE 'FAKE-%') DESC, random()
      LIMIT 500`,
    [tenantId]
  )).rows;
  if (variants.length === 0) {
    return NextResponse.json({ error: "ยังไม่มีสินค้า — สร้าง BMS Products ก่อน" }, { status: 400 });
  }
  const customers = (await query(
    `SELECT id FROM bms_customers WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY ('fake' = ANY(tags)) DESC, random() LIMIT 500`,
    [tenantId]
  )).rows;

  const orders: any[][] = [];
  const items: any[][] = [];
  const payments: any[][] = [];
  const shipments: any[][] = [];

  for (let i = 0; i < count; i++) {
    const id = uuid();
    const status = pick(STATUS_POOL);
    const channel = pick(CHANNELS);
    const created = new Date(Date.now() - R(DAYS) * 864e5 - R(86400) * 1000);
    const iso = created.toISOString();
    const customerId = customers.length ? pick(customers).id : null;

    const chosen = sample(variants, 1 + R(3)); // 1..3 รายการไม่ซ้ำ
    let total = 0;
    for (const v of chosen) {
      const qty = 1 + R(3);
      total += Number(v.price) * qty;
      items.push([tenantId, id, v.sku, v.size, qty, v.price]);
    }
    orders.push([tenantId, id, channel, "FAKE-" + short(), customerId, status, total.toFixed(2), iso, iso]);

    if (PAID_SET.has(status)) {
      payments.push([tenantId, id, pick(METHODS), total.toFixed(2), "CONFIRMED", "seed@fake", iso]);
    }
    if (SHIP_SET.has(status)) {
      shipments.push([tenantId, id, pick(CARRIERS), "TH" + short().toUpperCase(), status === "COMPLETED" ? "DELIVERED" : "SHIPPED", iso]);
    }
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await bulkInsert(client, "bms_orders",
      ["tenant_id", "id", "channel", "customer_ref", "customer_id", "status", "total_amount", "created_at", "updated_at"], orders);
    await bulkInsert(client, "bms_order_items",
      ["tenant_id", "order_id", "product_sku", "size", "qty", "unit_price"], items);
    await bulkInsert(client, "bms_payments",
      ["tenant_id", "order_id", "method", "amount", "status", "verified_by", "created_at"], payments);
    await bulkInsert(client, "bms_shipments",
      ["tenant_id", "order_id", "carrier", "tracking_no", "status", "created_at"], shipments);
    await client.query("COMMIT");
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: 500 });
  } finally {
    client.release();
  }

  return NextResponse.json({
    ok: true,
    created: orders.map((o) => ({ id: o[1], status: o[5], price: Number(o[6]), name: `order ${o[1].slice(0, 8)}` })),
    summary: { orders: orders.length, items: items.length, payments: payments.length, shipments: shipments.length },
  });
}

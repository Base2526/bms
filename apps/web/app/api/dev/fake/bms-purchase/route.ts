// apps/web/app/api/dev/fake/bms-purchase/route.ts
// สร้าง Purchase Orders ปลอม (suppliers + PO + items หลายสถานะ) เพื่อเติมหน้า Purchase
//
// marker: PO note ขึ้นต้น 'FAKE' + supplier name ขึ้นต้น 'FAKE ' → cleanup ลบได้ (items cascade)
// หมายเหตุ: ไม่ขยับสต็อก (ใช้เติมหน้ารายการ) — ถ้าจะเทสต์ receive จริง ให้ทำผ่าน UI /admin/purchase
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrInternal, fakeSeedDisabled } from "@/lib/dev-guards";
import { getClient, query } from "@/lib/db";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const R = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]): T => a[R(a.length)];
const sample = <T,>(a: T[], k: number): T[] => {
  const c = [...a]; const out: T[] = [];
  for (let j = 0; j < k && c.length; j++) out.push(c.splice(R(c.length), 1)[0]);
  return out;
};

const DAYS = 45;
const STATUS_POOL = ["OPEN", "OPEN", "PARTIAL", "RECEIVED", "RECEIVED", "CANCELLED"];
const SUPPLIER_NAMES = Array.from({ length: 8 }, (_, i) => `FAKE Supplier ${String(i + 1).padStart(2, "0")}`);

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
  const guard = requireAdminOrInternal(req);
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body?.count) || 20, 1), 2000);
  // seed ลงร้านของผู้ล็อกอิน (ร้านค้าเทสได้เอง เห็นใน list ตัวเอง) — fallback: body.tenantId → default
  const tenantId = guard.actor?.tenant_id
    || (typeof body?.tenantId === "string" && body.tenantId.trim() ? body.tenantId.trim() : DEFAULT_TENANT_ID);

  // pool ของ variant (เลือก FAKE- ก่อน)
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

  const client = await getClient();
  try {
    await client.query("BEGIN");

    // upsert fake suppliers → ได้ id ทุกตัว
    const supRows: { id: string }[] = [];
    for (const name of SUPPLIER_NAMES) {
      const r = await client.query(
        `INSERT INTO bms_suppliers (tenant_id, name, phone)
         VALUES ($1, $2, '02-000-0000')
         ON CONFLICT (tenant_id, name) DO UPDATE SET updated_at = now()
         RETURNING id`,
        [tenantId, name]
      );
      supRows.push({ id: r.rows[0].id });
    }

    const pos: any[][] = [];
    const items: any[][] = [];

    for (let i = 0; i < count; i++) {
      const id = uuid();
      const status = pick(STATUS_POOL);
      const created = new Date(Date.now() - R(DAYS) * 864e5 - R(86400) * 1000);
      const iso = created.toISOString();
      const supplierId = pick(supRows).id;

      const chosen = sample(variants, 1 + R(4)); // 1..4 รายการไม่ซ้ำ
      let total = 0;
      for (const v of chosen) {
        const qtyOrdered = 10 + R(91); // 10..100
        const unitCost = Math.max(1, Math.round(Number(v.price) * (0.5 + Math.random() * 0.2))); // ~50-70% ของราคาขาย
        let qtyReceived = 0;
        if (status === "RECEIVED") qtyReceived = qtyOrdered;
        else if (status === "PARTIAL") qtyReceived = Math.max(1, Math.floor(qtyOrdered * (0.2 + Math.random() * 0.6)));
        total += qtyOrdered * unitCost;
        items.push([tenantId, id, v.sku, v.size, qtyOrdered, qtyReceived, unitCost]);
      }
      pos.push([tenantId, id, supplierId, status, total.toFixed(2), `FAKE lot ${created.toISOString().slice(0, 10)}`, iso, iso]);
    }

    await bulkInsert(client, "bms_purchase_orders",
      ["tenant_id", "id", "supplier_id", "status", "total_amount", "note", "created_at", "updated_at"], pos);
    await bulkInsert(client, "bms_purchase_order_items",
      ["tenant_id", "po_id", "product_sku", "size", "qty_ordered", "qty_received", "unit_cost"], items);

    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      created: pos.map((p) => ({ id: p[1], status: p[3], price: Number(p[4]), name: `PO ${p[1].slice(0, 8)}` })),
      summary: { purchaseOrders: pos.length, items: items.length, suppliers: supRows.length },
    });
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: 500 });
  } finally {
    client.release();
  }
}

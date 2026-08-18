// =============================================================
// BMS — นับสต็อก / stock take (7.98)
// -------------------------------------------------------------
// กับดักหลักของการนับสต็อก: ระหว่างที่คนเดินนับ ร้านยังขายอยู่
//
// ถ้าตอนปิดใบนับเอา "จำนวนที่นับได้" ไปทับ current_stock ตรง ๆ ของที่ขายไป
// ระหว่างนับจะถูกเสกกลับมา (นับได้ 10 ตอน 9 โมง ขายไป 3 ตอน 10 โมง ปิดใบนับ
// ตอนเที่ยงแล้วสต็อกกลายเป็น 10 ทั้งที่ควรเป็น 7)
//
// จึงเก็บ snapshot_qty ตอนที่ "เพิ่มรายการเข้าใบนับ" แล้วตอนปิดใบคิดเป็น
// ส่วนต่าง (counted − snapshot) บวกเข้ากับยอดปัจจุบัน ไม่ใช่ทับค่า
// ยอดขายระหว่างนับจึงรอด และส่วนต่างที่บันทึกคือ "ของที่หายจริง" เท่านั้น
// =============================================================

import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { recordMovement } from "./movements";

export type StockCountStatus = "DRAFT" | "APPLIED" | "CANCELLED";

export type StockCountItem = {
  id: number;
  sku: string;
  productName: string | null;
  size: string;
  snapshotQty: number;
  countedQty: number;
  /** counted − snapshot · ลบ = ของหาย บวก = ของเกิน */
  variance: number;
  note: string | null;
};

export type StockCount = {
  id: string;
  countNo: string;
  locationId: string;
  locationName: string | null;
  status: StockCountStatus;
  note: string | null;
  createdByName: string | null;
  appliedAt: string | null;
  createdAt: string;
  items: StockCountItem[];
  /** ผลรวมของที่หาย (ค่าลบ) และของเกิน (ค่าบวก) — ตัวเลขที่บัญชีต้องเห็น */
  varianceUnits: number;
};

const toISO = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ""));

export async function listStockCounts(
  tenantId: string, status?: StockCountStatus | null, limit = 50
): Promise<StockCount[]> {
  const res = await query<any>(
    `SELECT c.*, l.name AS location_name, COALESCE(u.name, u.email) AS created_by_name
       FROM bms_stock_counts c
       LEFT JOIN bms_locations l ON l.id = c.location_id AND l.tenant_id = c.tenant_id
       LEFT JOIN users u ON u.id = c.created_by
      WHERE c.tenant_id = $1 AND ($2::text IS NULL OR c.status = $2)
      ORDER BY c.created_at DESC
      LIMIT $3`,
    [tenantId, status ?? null, Math.min(Math.max(limit, 1), 200)]
  );
  if (!res.rows.length) return [];

  const items = await query<any>(
    `SELECT i.*, p.name AS product_name
       FROM bms_stock_count_items i
       LEFT JOIN bms_products p ON p.sku = i.product_sku AND p.tenant_id = i.tenant_id
      WHERE i.tenant_id = $1 AND i.count_id = ANY($2::uuid[])
      ORDER BY i.id`,
    [tenantId, res.rows.map((r: any) => r.id)]
  );
  const byCount = new Map<string, StockCountItem[]>();
  for (const row of items.rows as any[]) {
    const list = byCount.get(row.count_id) ?? [];
    list.push({
      id: Number(row.id), sku: row.product_sku, productName: row.product_name ?? null,
      size: row.size, snapshotQty: Number(row.snapshot_qty), countedQty: Number(row.counted_qty),
      variance: Number(row.counted_qty) - Number(row.snapshot_qty),
      note: row.note ?? null,
    });
    byCount.set(row.count_id, list);
  }

  return res.rows.map((r: any) => {
    const list = byCount.get(r.id) ?? [];
    return {
      id: r.id,
      countNo: r.count_no,
      locationId: r.location_id,
      locationName: r.location_name ?? null,
      status: r.status,
      note: r.note ?? null,
      createdByName: r.created_by_name ?? null,
      appliedAt: r.applied_at ? toISO(r.applied_at) : null,
      createdAt: toISO(r.created_at),
      items: list,
      varianceUnits: list.reduce((sum, i) => sum + i.variance, 0),
    };
  });
}

export type CreateCountResult =
  | { status: "CREATED"; countId: string; countNo: string }
  | { status: "INVALID"; reason: string };

export async function createStockCount(input: {
  tenantId: string; locationId: string; note?: string | null; createdBy: string;
}): Promise<CreateCountResult> {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.createdBy });

    const loc = await client.query(
      `SELECT id FROM bms_locations WHERE tenant_id = $1 AND id = $2 AND active`,
      [input.tenantId, input.locationId]
    );
    if (!loc.rowCount) {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: "ไม่พบสาขานี้ หรือสาขาถูกปิดใช้งาน" };
    }

    const n = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM bms_stock_counts
        WHERE tenant_id = $1 AND created_at::date = CURRENT_DATE`,
      [input.tenantId]
    );
    const today = new Date();
    const stamp = `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const countNo = `CNT-${stamp}-${String(Number(n.rows[0].n) + 1).padStart(3, "0")}`;

    const ins = await client.query<{ id: string }>(
      `INSERT INTO bms_stock_counts (tenant_id, count_no, location_id, note, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [input.tenantId, countNo, input.locationId, input.note ?? null, input.createdBy]
    );
    await client.query("COMMIT");
    return { status: "CREATED", countId: ins.rows[0].id, countNo };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export type CountItemResult =
  | { status: "OK"; snapshotQty: number; variance: number }
  | { status: "NOT_FOUND" }
  | { status: "WRONG_STATE"; current: StockCountStatus }
  | { status: "INVALID"; reason: string };

/**
 * บันทึกจำนวนที่นับได้ของ 1 รายการ
 *
 * snapshot ถูกจับ "ตอนกรอกครั้งแรก" และไม่อัปเดตเมื่อกรอกซ้ำ — คนนับแก้ตัวเลข
 * ที่กรอกผิดได้โดยฐานเปรียบเทียบไม่ขยับ ถ้า snapshot ขยับตามทุกครั้งที่แก้
 * ยอดขายที่เกิดระหว่างนั้นจะถูกกลืนเข้าไปในส่วนต่างของการนับ
 */
export async function recordCountItem(input: {
  tenantId: string;
  countId: string;
  sku: string;
  size: string;
  countedQty: number;
  note?: string | null;
  actorUserId: string;
}): Promise<CountItemResult> {
  const size = input.size.trim().toUpperCase();
  const counted = Math.trunc(Number(input.countedQty));
  if (!Number.isInteger(counted) || counted < 0) return { status: "INVALID", reason: "จำนวนที่นับได้ไม่ถูกต้อง" };

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });

    const head = await client.query<{ status: StockCountStatus; location_id: string }>(
      `SELECT status, location_id FROM bms_stock_counts WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [input.tenantId, input.countId]
    );
    if (!head.rowCount) { await client.query("ROLLBACK"); return { status: "NOT_FOUND" }; }
    if (head.rows[0].status !== "DRAFT") {
      await client.query("ROLLBACK");
      return { status: "WRONG_STATE", current: head.rows[0].status };
    }

    const prod = await client.query(
      `SELECT 1 FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [input.tenantId, input.sku]
    );
    if (!prod.rowCount) { await client.query("ROLLBACK"); return { status: "INVALID", reason: `ไม่พบสินค้า ${input.sku}` }; }

    const inv = await client.query<{ current_stock: number }>(
      `SELECT current_stock FROM bms_inventory
        WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
      [input.tenantId, head.rows[0].location_id, input.sku, size]
    );
    const snapshot = inv.rowCount ? inv.rows[0].current_stock : 0;

    const res = await client.query<{ snapshot_qty: number }>(
      `INSERT INTO bms_stock_count_items (tenant_id, count_id, product_sku, size, snapshot_qty, counted_qty, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (count_id, product_sku, size)
         DO UPDATE SET counted_qty = EXCLUDED.counted_qty, note = EXCLUDED.note
       RETURNING snapshot_qty`,
      [input.tenantId, input.countId, input.sku, size, snapshot, counted, input.note ?? null]
    );
    await client.query("COMMIT");

    const kept = Number(res.rows[0].snapshot_qty);
    return { status: "OK", snapshotQty: kept, variance: counted - kept };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export type ApplyCountResult =
  | { status: "APPLIED"; adjustedItems: number; varianceUnits: number }
  | { status: "NOT_FOUND" }
  | { status: "WRONG_STATE"; current: StockCountStatus }
  | { status: "WOULD_BREAK_RESERVED"; sku: string; size: string; reserved: number; wouldBe: number };

/**
 * ปิดใบนับ = ยอมรับส่วนต่างเข้าสต็อกจริง
 *
 * แยกสิทธิ์จากการนับ (inventory.count.apply) เพราะนี่คือการตัดสินใจทางบัญชีว่า
 * ของหายไปเท่านั้นจริง ไม่ใช่งานเดินนับของ
 */
export async function applyStockCount(input: {
  tenantId: string; countId: string; actorUserId: string;
}): Promise<ApplyCountResult> {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });

    const head = await client.query<{ status: StockCountStatus; location_id: string; count_no: string }>(
      `SELECT status, location_id, count_no FROM bms_stock_counts
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [input.tenantId, input.countId]
    );
    if (!head.rowCount) { await client.query("ROLLBACK"); return { status: "NOT_FOUND" }; }
    const c = head.rows[0];
    if (c.status !== "DRAFT") { await client.query("ROLLBACK"); return { status: "WRONG_STATE", current: c.status }; }

    const items = await client.query<{ product_sku: string; size: string; snapshot_qty: number; counted_qty: number }>(
      `SELECT product_sku, size, snapshot_qty, counted_qty FROM bms_stock_count_items
        WHERE tenant_id = $1 AND count_id = $2 ORDER BY id`,
      [input.tenantId, input.countId]
    );

    let adjusted = 0;
    let varianceUnits = 0;

    for (const item of items.rows) {
      const delta = item.counted_qty - item.snapshot_qty;
      if (delta === 0) continue;

      const inv = await client.query<{ current_stock: number; reserved_stock: number }>(
        `SELECT current_stock, reserved_stock FROM bms_inventory
          WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4 FOR UPDATE`,
        [input.tenantId, c.location_id, item.product_sku, item.size]
      );

      if (!inv.rowCount) {
        if (delta < 0) continue; // ไม่มีแถวให้ลด — ข้าม
        await client.query(
          `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
           VALUES ($1,$2,$3,$4,$5,0)`,
          [input.tenantId, c.location_id, item.product_sku, item.size, delta]
        );
      } else {
        const wouldBe = inv.rows[0].current_stock + delta;
        // ของที่ลูกค้าจองไว้แล้วต้องไม่ถูกนับหายไป — ถ้าเลขที่นับได้ต่ำกว่าที่จองไว้
        // แปลว่ามีปัญหาที่ต้องคนตัดสิน ไม่ใช่ให้ระบบเลือกข้างเงียบ ๆ
        if (wouldBe < inv.rows[0].reserved_stock) {
          await client.query("ROLLBACK");
          return {
            status: "WOULD_BREAK_RESERVED",
            sku: item.product_sku, size: item.size,
            reserved: inv.rows[0].reserved_stock, wouldBe,
          };
        }
        await client.query(
          `UPDATE bms_inventory SET current_stock = current_stock + $5, updated_at = now()
            WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
          [input.tenantId, c.location_id, item.product_sku, item.size, delta]
        );
      }

      await recordMovement(client, {
        tenantId: input.tenantId, locationId: c.location_id,
        sku: item.product_sku, size: item.size,
        type: "COUNT_ADJUST", qty: Math.abs(delta),
        note: `นับสต็อก ${c.count_no}: ระบบ ${item.snapshot_qty} นับได้ ${item.counted_qty}`,
        actor: input.actorUserId,
      });
      adjusted += 1;
      varianceUnits += delta;
    }

    await client.query(
      `UPDATE bms_stock_counts SET status = 'APPLIED', applied_by = $3, applied_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, input.countId, input.actorUserId]
    );
    await client.query("COMMIT");
    return { status: "APPLIED", adjustedItems: adjusted, varianceUnits };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function cancelStockCount(input: {
  tenantId: string; countId: string; actorUserId: string;
}): Promise<{ status: "OK" } | { status: "NOT_FOUND" } | { status: "WRONG_STATE"; current: StockCountStatus }> {
  const res = await query(
    `UPDATE bms_stock_counts
        SET status = 'CANCELLED', cancelled_by = $3, cancelled_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'`,
    [input.tenantId, input.countId, input.actorUserId]
  );
  if (res.rowCount) return { status: "OK" };
  const cur = await query<{ status: StockCountStatus }>(
    `SELECT status FROM bms_stock_counts WHERE tenant_id = $1 AND id = $2`,
    [input.tenantId, input.countId]
  );
  if (!cur.rowCount) return { status: "NOT_FOUND" };
  return { status: "WRONG_STATE", current: cur.rows[0].status };
}

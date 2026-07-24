// =============================================================
// BMS Purchase Management — supplier PO + รับของเข้าสต็อก
// -------------------------------------------------------------
// createPurchaseOrder   : สร้าง PO (status OPEN, ยังไม่ขยับสต็อก)
// receivePurchaseOrder  : รับของ (บางส่วน/ครบ) → current_stock += qty + STOCK_IN
// cancelPurchaseOrder   : ยกเลิก (ก่อนรับครบ) — ไม่คืนของที่รับไปแล้ว
//
// ทุก write อยู่ในทรานแซกชันเดียว + tenant-scoped (beginTenantTx → RLS enforce)
// สต็อกเข้าเฉพาะตอน receive เท่านั้น และต้องมี movement (BUSINESS_RULES/CLAUDE §6)
// =============================================================

import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { recordMovement } from "./movements";
import { beginTenantTx } from "./tenant";

// ---- types ---------------------------------------------------
export type PoItemInput = { sku: string; size: string; qty: number; unitCost?: number };

export type CreatePOInput = {
  tenantId: string;
  supplierId?: string | null;
  supplierName?: string | null; // ถ้าไม่มี supplierId จะ resolve/สร้างจากชื่อ
  items: PoItemInput[];
  note?: string | null;
  actor?: string | null;
};

export type PoLine = {
  sku: string;
  size: string;
  qtyOrdered: number;
  qtyReceived: number;
  unitCost: number;
};

export type CreatePOResult =
  | { status: "CREATED"; poId: string; total: number; supplierId: string | null; items: PoLine[] }
  | { status: "NOT_FOUND"; sku: string }
  | { status: "EMPTY" };

export type ReceiveInput = { sku: string; size: string; qty: number };

export type ReceivePOResult =
  | { status: "RECEIVED" | "PARTIAL"; poId: string; items: PoLine[] }
  | { status: "PO_NOT_FOUND" }
  | { status: "INVALID_STATE"; current: string }
  | { status: "LINE_NOT_FOUND"; sku: string; size: string }
  | { status: "OVER_RECEIVE"; sku: string; size: string; remaining: number; requested: number }
  | { status: "EMPTY" };

// ---- helpers -------------------------------------------------
/** รวมรายการซ้ำ (sku+size) แล้วบวก qty — เรียง deterministic กัน deadlock */
function mergeItems<T extends { sku: string; size: string; qty: number }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const it of items) {
    const key = `${it.sku}__${it.size}`;
    const cur = map.get(key);
    if (cur) cur.qty += it.qty;
    else map.set(key, { ...it });
  }
  return [...map.values()].sort((a, b) =>
    a.sku === b.sku ? a.size.localeCompare(b.size) : a.sku.localeCompare(b.sku)
  );
}

/** หา/สร้าง supplier จากชื่อ (ในทรานแซกชันเดียวกัน) — คืน id */
async function resolveSupplier(
  client: PoolClient,
  tenantId: string,
  supplierId: string | null | undefined,
  supplierName: string | null | undefined
): Promise<string | null> {
  if (supplierId) {
    const r = await client.query(`SELECT id FROM bms_suppliers WHERE tenant_id = $1 AND id = $2`, [tenantId, supplierId]);
    return r.rowCount ? supplierId : null;
  }
  const name = supplierName?.trim();
  if (!name) return null;
  const ins = await client.query<{ id: string }>(
    `INSERT INTO bms_suppliers (tenant_id, name) VALUES ($1, $2)
     ON CONFLICT (tenant_id, name) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [tenantId, name]
  );
  return ins.rows[0].id;
}

// ---- create --------------------------------------------------
export async function createPurchaseOrder(input: CreatePOInput): Promise<CreatePOResult> {
  const tenantId = input.tenantId;
  const items = mergeItems(
    input.items
      .map((it) => ({
        sku: String(it.sku ?? "").trim(),
        size: String(it.size ?? "").trim(),
        qty: Number(it.qty),
        unitCost: Number(it.unitCost ?? 0),
      }))
      .filter((it) => it.sku && it.size && Number.isInteger(it.qty) && it.qty > 0)
  );
  if (items.length === 0) return { status: "EMPTY" };

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    // สินค้าทุก sku ต้องมีในร้าน
    for (const it of items) {
      const prod = await client.query(
        `SELECT 1 FROM bms_products WHERE tenant_id = $1 AND sku = $2`,
        [tenantId, it.sku]
      );
      if (prod.rowCount === 0) {
        await client.query("ROLLBACK");
        return { status: "NOT_FOUND", sku: it.sku };
      }
    }

    const supplierId = await resolveSupplier(client, tenantId, input.supplierId, input.supplierName);

    const total = items.reduce((sum, it) => sum + it.unitCost * it.qty, 0);

    const po = await client.query<{ id: string }>(
      `INSERT INTO bms_purchase_orders (tenant_id, supplier_id, status, total_amount, note)
       VALUES ($1, $2, 'OPEN', $3, $4)
       RETURNING id`,
      [tenantId, supplierId, total, input.note ?? null]
    );
    const poId = po.rows[0].id;

    const lines: PoLine[] = [];
    for (const it of items) {
      await client.query(
        `INSERT INTO bms_purchase_order_items
           (tenant_id, po_id, product_sku, size, qty_ordered, unit_cost)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, poId, it.sku, it.size, it.qty, it.unitCost]
      );
      lines.push({ sku: it.sku, size: it.size, qtyOrdered: it.qty, qtyReceived: 0, unitCost: it.unitCost });
    }

    await client.query("COMMIT");
    return { status: "CREATED", poId, total, supplierId, items: lines };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---- receive (partial/full) ----------------------------------
export async function receivePurchaseOrder(
  tenantId: string,
  poId: string,
  received: ReceiveInput[],
  actor: string | null = "admin",
  editorId?: string | number | null
): Promise<ReceivePOResult> {
  const lines = mergeItems(
    received
      .map((it) => ({ sku: String(it.sku ?? "").trim(), size: String(it.size ?? "").trim(), qty: Number(it.qty) }))
      .filter((it) => it.sku && it.size && Number.isInteger(it.qty) && it.qty > 0)
  );
  if (lines.length === 0) return { status: "EMPTY" };

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId });

    // ล็อก PO — ต้องอยู่สถานะที่รับได้
    const po = await client.query<{ status: string }>(
      `SELECT status FROM bms_purchase_orders
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, poId]
    );
    if (po.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: "PO_NOT_FOUND" };
    }
    const cur = po.rows[0].status;
    if (cur !== "OPEN" && cur !== "PARTIAL") {
      await client.query("ROLLBACK");
      return { status: "INVALID_STATE", current: cur };
    }

    for (const ln of lines) {
      // ล็อกรายการ PO ที่ตรง sku+size
      const item = await client.query<{ id: string; qty_ordered: number; qty_received: number }>(
        `SELECT id, qty_ordered, qty_received FROM bms_purchase_order_items
          WHERE tenant_id = $1 AND po_id = $2 AND product_sku = $3 AND size = $4 FOR UPDATE`,
        [tenantId, poId, ln.sku, ln.size]
      );
      if (item.rowCount === 0) {
        await client.query("ROLLBACK");
        return { status: "LINE_NOT_FOUND", sku: ln.sku, size: ln.size };
      }
      const { id: itemId, qty_ordered, qty_received } = item.rows[0];
      const remaining = qty_ordered - qty_received;
      if (ln.qty > remaining) {
        await client.query("ROLLBACK");
        return { status: "OVER_RECEIVE", sku: ln.sku, size: ln.size, remaining, requested: ln.qty };
      }

      // สต็อกเข้า: upsert inventory row (สร้างไซซ์ใหม่ได้)
      await client.query(
        `INSERT INTO bms_inventory (tenant_id, product_sku, size, current_stock, reserved_stock)
         VALUES ($1, $2, $3, $4, 0)
         ON CONFLICT (tenant_id, product_sku, size)
         DO UPDATE SET current_stock = bms_inventory.current_stock + EXCLUDED.current_stock, updated_at = now()`,
        [tenantId, ln.sku, ln.size, ln.qty]
      );

      await client.query(
        `UPDATE bms_purchase_order_items SET qty_received = qty_received + $2 WHERE id = $1`,
        [itemId, ln.qty]
      );

      await recordMovement(client, {
        tenantId,
        sku: ln.sku,
        size: ln.size,
        type: "STOCK_IN",
        qty: ln.qty,
        note: `PO:${poId.slice(0, 8)}`,
        actor: actor ?? "admin",
      });
    }

    // recompute สถานะ PO: ครบทุกรายการ = RECEIVED, ไม่งั้น PARTIAL
    const pending = await client.query<{ c: string }>(
      `SELECT COUNT(*)::int AS c FROM bms_purchase_order_items
        WHERE po_id = $1 AND qty_received < qty_ordered`,
      [poId]
    );
    const nextStatus = Number(pending.rows[0].c) === 0 ? "RECEIVED" : "PARTIAL";
    await client.query(
      `UPDATE bms_purchase_orders SET status = $2, updated_at = now() WHERE id = $1`,
      [poId, nextStatus]
    );

    // อ่านรายการล่าสุดกลับไป
    const items = await client.query<{ product_sku: string; size: string; qty_ordered: number; qty_received: number; unit_cost: string }>(
      `SELECT product_sku, size, qty_ordered, qty_received, unit_cost
         FROM bms_purchase_order_items WHERE po_id = $1 ORDER BY product_sku, size`,
      [poId]
    );

    await client.query("COMMIT");
    return {
      status: nextStatus,
      poId,
      items: items.rows.map((r) => ({
        sku: r.product_sku, size: r.size,
        qtyOrdered: r.qty_ordered, qtyReceived: r.qty_received,
        unitCost: Number(r.unit_cost),
      })),
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---- cancel --------------------------------------------------
/**
 * ยกเลิก PO (เฉพาะ OPEN/PARTIAL) → CANCELLED
 * ของที่ "รับเข้าสต็อกไปแล้ว" จะไม่ถูกดึงออก (ตามหลักบัญชีสินค้า)
 */
export async function cancelPurchaseOrder(
  tenantId: string,
  poId: string,
  editorId?: string | number | null
): Promise<boolean> {
  // ใช้ tenant tx เพื่อให้ revision trigger เห็น app.editor_id (ไม่งั้น editor จะเป็น system)
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId });
    const res = await client.query(
      `UPDATE bms_purchase_orders SET status = 'CANCELLED', updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status IN ('OPEN','PARTIAL')`,
      [tenantId, poId]
    );
    await client.query("COMMIT");
    return (res.rowCount ?? 0) > 0;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---- read ----------------------------------------------------
export async function listPurchaseOrders(tenantId: string, search = "", limit = 50, offset = 0) {
  const lim = Math.min(Math.max(limit, 1), 200);
  const q = search.trim();
  const res = await query(
    `SELECT po.id, po.status, po.total_amount, po.note, po.created_at, po.updated_at,
            s.id AS supplier_id, s.name AS supplier_name,
            COALESCE(SUM(i.qty_ordered), 0)::int  AS qty_ordered,
            COALESCE(SUM(i.qty_received), 0)::int AS qty_received
       FROM bms_purchase_orders po
       LEFT JOIN bms_suppliers s ON s.id = po.supplier_id
       LEFT JOIN bms_purchase_order_items i ON i.po_id = po.id
      WHERE po.tenant_id = $1
        AND (
          $4 = ''
          OR po.id::text ILIKE '%' || $4 || '%'
          OR COALESCE(s.name, '') ILIKE '%' || $4 || '%'
          OR COALESCE(po.note, '') ILIKE '%' || $4 || '%'
          OR EXISTS (
            SELECT 1
              FROM bms_purchase_order_items ii
             WHERE ii.tenant_id = po.tenant_id
               AND ii.po_id = po.id
               AND (
                 ii.product_sku ILIKE '%' || $4 || '%'
                 OR ii.size ILIKE '%' || $4 || '%'
               )
          )
        )
      GROUP BY po.id, s.id, s.name
      ORDER BY po.created_at DESC
      LIMIT $2 OFFSET $3`,
    [tenantId, lim, offset, q]
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    status: r.status,
    total: Number(r.total_amount),
    note: r.note,
    supplier: r.supplier_id ? { id: r.supplier_id, name: r.supplier_name } : null,
    qtyOrdered: r.qty_ordered,
    qtyReceived: r.qty_received,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function getPurchaseOrder(tenantId: string, poId: string) {
  const head = await query(
    `SELECT po.id, po.status, po.total_amount, po.note, po.created_at, po.updated_at,
            s.id AS supplier_id, s.name AS supplier_name
       FROM bms_purchase_orders po
       LEFT JOIN bms_suppliers s ON s.id = po.supplier_id
      WHERE po.tenant_id = $1 AND po.id = $2`,
    [tenantId, poId]
  );
  if (head.rowCount === 0) return null;
  const items = await query(
    `SELECT product_sku, size, qty_ordered, qty_received, unit_cost
       FROM bms_purchase_order_items WHERE tenant_id = $1 AND po_id = $2
      ORDER BY product_sku, size`,
    [tenantId, poId]
  );
  const h: any = head.rows[0];
  return {
    id: h.id,
    status: h.status,
    total: Number(h.total_amount),
    note: h.note,
    supplier: h.supplier_id ? { id: h.supplier_id, name: h.supplier_name } : null,
    createdAt: h.created_at,
    updatedAt: h.updated_at,
    items: items.rows.map((r: any) => ({
      sku: r.product_sku, size: r.size,
      qtyOrdered: r.qty_ordered, qtyReceived: r.qty_received,
      unitCost: Number(r.unit_cost),
    })),
  };
}

// ---- suppliers ----------------------------------------------
export async function listSuppliers(tenantId: string) {
  const res = await query(
    `SELECT id, name, phone, email, note, created_at
       FROM bms_suppliers WHERE tenant_id = $1 ORDER BY name`,
    [tenantId]
  );
  return res.rows;
}

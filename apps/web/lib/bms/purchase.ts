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

import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { recordMovement } from "./movements";
import { resolveDefaultLocationIdInTx } from "./locations";
import { receiveLotInTx } from "./lots";
import { beginTenantTx } from "./tenant";
import { markRestockSubscriptionsReady } from "./restockSubscriptions";

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

export type ReceiveInput = {
  sku: string;
  size: string;
  qty: number;
  /** เลข lot จากผู้ผลิต — ร้านยาต้องมี ร้านอื่นเว้นได้ (7.85) */
  lotNo?: string | null;
  /** YYYY-MM-DD */
  expiryDate?: string | null;
  unitCost?: number | null;
};

export type ReceivePOResult =
  | { status: "RECEIVED" | "PARTIAL"; poId: string; items: PoLine[]; replayed?: boolean }
  | { status: "PO_NOT_FOUND" }
  | { status: "LOCATION_NOT_FOUND" }
  | { status: "INVALID_INPUT" }
  | { status: "INVALID_STATE"; current: string }
  | { status: "LINE_NOT_FOUND"; sku: string; size: string }
  | { status: "OVER_RECEIVE"; sku: string; size: string; remaining: number; requested: number }
  | { status: "IDEMPOTENCY_CONFLICT" }
  | { status: "EMPTY" };

export type ReceivePurchaseOptions = {
  /** POS receives into its own branch; omitted admin callers retain the default branch. */
  locationId?: string | null;
  /** Stable POS retry key. The ledger row is written in this same transaction. */
  idempotency?: { deviceId: string; actorUserId: string; key: string } | null;
  /** Sensitive stock mutations must audit in the same transaction as the inventory write. */
  audit?: { actor: string; action?: string; meta?: Record<string, unknown> } | null;
};

// ---- helpers -------------------------------------------------
/**
 * รวมรายการซ้ำ (sku+size+lot) แล้วบวก qty — เรียง deterministic กัน deadlock
 * lot ต่างกันห้ามรวมกัน ไม่งั้นวันหมดอายุของกองที่รวมแล้วไม่มีความหมาย
 */
function mergeItems<T extends { sku: string; size: string; qty: number; lotNo?: string | null }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const it of items) {
    const key = `${it.sku}__${it.size}__${it.lotNo ?? ""}`;
    const cur = map.get(key);
    if (cur) cur.qty += it.qty;
    else map.set(key, { ...it });
  }
  return [...map.values()].sort((a, b) => {
    const skuOrder = a.sku.localeCompare(b.sku);
    if (skuOrder !== 0) return skuOrder;
    const sizeOrder = a.size.localeCompare(b.size);
    if (sizeOrder !== 0) return sizeOrder;
    return String(a.lotNo ?? "").localeCompare(String(b.lotNo ?? ""));
  });
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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
  editorId?: string | number | null,
  options: ReceivePurchaseOptions = {}
): Promise<ReceivePOResult> {
  if (!Array.isArray(received) || received.length === 0) return { status: "EMPTY" };
  if (received.length > 200) return { status: "INVALID_INPUT" };
  const normalized = received.map((it) => ({
    sku: String(it?.sku ?? "").trim(),
    size: String(it?.size ?? "").trim(),
    qty: Number(it?.qty),
    lotNo: it?.lotNo == null ? null : String(it.lotNo).trim() || null,
    expiryDate: it?.expiryDate == null ? null : String(it.expiryDate).trim() || null,
  }));
  if (normalized.some((it) =>
    !it.sku || it.sku.length > 200
    || !it.size || it.size.length > 100
    || !Number.isInteger(it.qty) || it.qty <= 0
    || (it.lotNo != null && it.lotNo.length > 100)
    || (it.expiryDate != null && (!it.lotNo || !isIsoDate(it.expiryDate)))
  )) {
    return { status: "INVALID_INPUT" };
  }
  const lotExpiry = new Map<string, string | null>();
  for (const item of normalized) {
    if (!item.lotNo) continue;
    const key = `${item.sku}\u0000${item.size}\u0000${item.lotNo}`;
    const expiry = item.expiryDate ?? null;
    if (lotExpiry.has(key) && lotExpiry.get(key) !== expiry) return { status: "INVALID_INPUT" };
    lotExpiry.set(key, expiry);
  }
  const lines = mergeItems(normalized);

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId });
    let locationId: string;
    if (options.locationId) {
      const location = await client.query<{ id: string }>(
        `SELECT id FROM bms_locations WHERE tenant_id = $1 AND id = $2 AND active`,
        [tenantId, options.locationId]
      );
      if (!location.rowCount) {
        await client.query("ROLLBACK");
        return { status: "LOCATION_NOT_FOUND" };
      }
      locationId = location.rows[0].id;
    } else {
      locationId = await resolveDefaultLocationIdInTx(client, tenantId);
    }

    // Lock before checking the retry ledger: a completed replay sees the stored result
    // even though the PO is now RECEIVED and no longer accepts a new receipt.
    const po = await client.query<{ status: string; supplier_id: string | null }>(
      `SELECT status, supplier_id FROM bms_purchase_orders
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, poId]
    );
    if (po.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: "PO_NOT_FOUND" };
    }

    let receiptId: string | null = null;
    if (options.idempotency) {
      const stableKey = options.idempotency.key.trim();
      if (!stableKey || stableKey.length > 200) {
        await client.query("ROLLBACK");
        return { status: "IDEMPOTENCY_CONFLICT" };
      }
      const requestHash = crypto.createHash("sha256").update(JSON.stringify({
        poId: poId.toLowerCase(),
        locationId: locationId.toLowerCase(),
        actorUserId: options.idempotency.actorUserId.toLowerCase(),
        lines: lines.map((line) => ({
          sku: line.sku,
          size: line.size,
          qty: line.qty,
          lotNo: line.lotNo ?? null,
          expiryDate: line.expiryDate ?? null,
        })),
      })).digest("hex");
      const claimed = await client.query<{ id: string }>(
        `INSERT INTO bms_pos_purchase_receipts
           (tenant_id, device_id, location_id, po_id, actor_user_id, idempotency_key, request_hash)
         SELECT $1, d.id, $3, $4, u.id, $6, $7
           FROM bms_pos_devices d
           JOIN users u ON u.tenant_id = d.tenant_id AND u.id = $5
          WHERE d.tenant_id = $1 AND d.id = $2 AND d.location_id = $3 AND d.active
         ON CONFLICT (tenant_id, device_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [tenantId, options.idempotency.deviceId, locationId, poId,
          options.idempotency.actorUserId, stableKey, requestHash]
      );
      if (!claimed.rowCount) {
        const prior = await client.query<{ request_hash: string; result: ReceivePOResult | null }>(
          `SELECT request_hash, result
             FROM bms_pos_purchase_receipts
            WHERE tenant_id = $1 AND device_id = $2 AND idempotency_key = $3`,
          [tenantId, options.idempotency.deviceId, stableKey]
        );
        await client.query("ROLLBACK");
        const row = prior.rows[0];
        if (!row || row.request_hash !== requestHash || !row.result) return { status: "IDEMPOTENCY_CONFLICT" };
        if (row.result.status === "RECEIVED" || row.result.status === "PARTIAL") {
          return { ...row.result, replayed: true };
        }
        return row.result;
      }
      receiptId = claimed.rows[0].id;
    }

    const cur = po.rows[0].status;
    const supplierId = po.rows[0].supplier_id ?? null;
    if (cur !== "OPEN" && cur !== "PARTIAL") {
      await client.query("ROLLBACK");
      return { status: "INVALID_STATE", current: cur };
    }

    for (const ln of lines) {
      // ล็อกรายการ PO ที่ตรง sku+size
      const item = await client.query<{ id: string; qty_ordered: number; qty_received: number; unit_cost: string }>(
        `SELECT id, qty_ordered, qty_received, unit_cost FROM bms_purchase_order_items
          WHERE tenant_id = $1 AND po_id = $2 AND product_sku = $3 AND size = $4 FOR UPDATE`,
        [tenantId, poId, ln.sku, ln.size]
      );
      if (item.rowCount === 0) {
        await client.query("ROLLBACK");
        return { status: "LINE_NOT_FOUND", sku: ln.sku, size: ln.size };
      }
      const { id: itemId, qty_ordered, qty_received, unit_cost } = item.rows[0];
      const remaining = qty_ordered - qty_received;
      if (ln.qty > remaining) {
        await client.query("ROLLBACK");
        return { status: "OVER_RECEIVE", sku: ln.sku, size: ln.size, remaining, requested: ln.qty };
      }

      // สต็อกเข้า: upsert inventory row (สร้างไซซ์ใหม่ได้)
      await client.query(
        `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
         VALUES ($1, $5, $2, $3, $4, 0)
         ON CONFLICT (tenant_id, location_id, product_sku, size)
         DO UPDATE SET current_stock = bms_inventory.current_stock + EXCLUDED.current_stock, updated_at = now()`,
        [tenantId, ln.sku, ln.size, ln.qty, locationId]
      );

      // lot: บันทึกในทรานแซกชันเดียวกับที่บวก current_stock — invariant ต้องไม่หลุด
      if (ln.lotNo) {
        await receiveLotInTx(client, {
          tenantId,
          locationId,
          productSku: ln.sku,
          size: ln.size,
          lotNo: ln.lotNo,
          qty: ln.qty,
          expiryDate: ln.expiryDate,
          supplierId,
          // Cost is authoritative PO data; POS/admin input cannot rewrite lot cost.
          unitCost: Number(unit_cost),
        });
      }

      await client.query(
        `UPDATE bms_purchase_order_items SET qty_received = qty_received + $2 WHERE id = $1`,
        [itemId, ln.qty]
      );

      await recordMovement(client, {
        tenantId,
        locationId,
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

    const result: ReceivePOResult = {
      status: nextStatus,
      poId,
      items: items.rows.map((r) => ({
        sku: r.product_sku, size: r.size,
        qtyOrdered: r.qty_ordered, qtyReceived: r.qty_received,
        unitCost: Number(r.unit_cost),
      })),
    };

    const auditActor = String(options.audit?.actor ?? actor ?? "admin").trim() || "admin";
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, auditActor, options.audit?.action?.trim() || "purchase.receive", poId,
        JSON.stringify({
          ...(options.audit?.meta ?? {}),
          status: nextStatus,
          locationId,
          itemCount: lines.length,
          units: lines.reduce((sum, line) => sum + line.qty, 0),
        })]
    );
    if (receiptId) {
      await client.query(
        `UPDATE bms_pos_purchase_receipts SET result = $2::jsonb WHERE id = $1`,
        [receiptId, JSON.stringify(result)]
      );
    }

    await client.query("COMMIT");
    for (const line of lines) {
      try {
        await markRestockSubscriptionsReady(tenantId, line.sku, line.size);
      } catch (error) {
        console.error("[BMS] restock ready hook failed after PO receipt:", error);
      }
    }
    return result;
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

/** Bounded queue for the POS receive screen — completed/cancelled POs never appear. */
export async function listReceivablePurchaseOrders(tenantId: string, limit = 50) {
  const lim = Math.min(Math.max(limit, 1), 100);
  const res = await query(
    `SELECT po.id, po.status, po.total_amount, po.note, po.created_at, po.updated_at,
            s.id AS supplier_id, s.name AS supplier_name,
            COALESCE(SUM(i.qty_ordered), 0)::int AS qty_ordered,
            COALESCE(SUM(i.qty_received), 0)::int AS qty_received
       FROM bms_purchase_orders po
       LEFT JOIN bms_suppliers s ON s.id = po.supplier_id
       LEFT JOIN bms_purchase_order_items i ON i.po_id = po.id AND i.tenant_id = po.tenant_id
      WHERE po.tenant_id = $1 AND po.status IN ('OPEN','PARTIAL')
      GROUP BY po.id, s.id, s.name
      ORDER BY po.created_at DESC
      LIMIT $2`,
    [tenantId, lim]
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    status: r.status,
    total: Number(r.total_amount),
    note: r.note,
    supplier: r.supplier_id ? { id: r.supplier_id, name: r.supplier_name } : null,
    qtyOrdered: Number(r.qty_ordered),
    qtyReceived: Number(r.qty_received),
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

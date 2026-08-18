// =============================================================
// BMS — โอนย้ายสต็อกระหว่างสาขา (7.98)
// -------------------------------------------------------------
// สองขั้น: ส่ง → รับ · ของที่ยัง IN_TRANSIT ไม่ได้อยู่ในสต็อกของสาขาไหนเลย
// ซึ่งถูกต้อง เพราะมันอยู่บนรถจริง ๆ · ขั้นเดียวจบแปลว่าของโผล่ที่ปลายทาง
// ทันทีที่กดส่ง แล้วถ้าหายระหว่างทางจะไม่มีใครรู้ว่าหายตอนไหน
//
// ทุก write ใช้ getClient() + beginTenantTx ตามกฎของโมดูล BMS
// =============================================================

import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { recordMovement } from "./movements";

export type StockTransferStatus = "DRAFT" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED";

export type StockTransferItem = {
  id: number;
  sku: string;
  productName: string | null;
  size: string;
  qty: number;
  receivedQty: number | null;
};

export type StockTransfer = {
  id: string;
  transferNo: string;
  fromLocationId: string;
  fromLocationName: string | null;
  toLocationId: string;
  toLocationName: string | null;
  status: StockTransferStatus;
  note: string | null;
  createdByName: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  items: StockTransferItem[];
};

const toISO = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v ?? "");

/** เลขที่ใบโอน — TRF-YYMMDD-NNN ต่อร้าน ไม่ใช่ global sequence */
async function nextTransferNoInTx(client: PoolClient, tenantId: string): Promise<string> {
  const res = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_stock_transfers
      WHERE tenant_id = $1 AND created_at::date = CURRENT_DATE`,
    [tenantId]
  );
  const seq = String(Number(res.rows[0].n) + 1).padStart(3, "0");
  const today = new Date();
  const stamp = `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  return `TRF-${stamp}-${seq}`;
}

export async function listStockTransfers(
  tenantId: string, status?: StockTransferStatus | null, limit = 50
): Promise<StockTransfer[]> {
  const res = await query<any>(
    `SELECT t.*, lf.name AS from_name, lt.name AS to_name,
            COALESCE(u.name, u.email) AS created_by_name
       FROM bms_stock_transfers t
       LEFT JOIN bms_locations lf ON lf.id = t.from_location AND lf.tenant_id = t.tenant_id
       LEFT JOIN bms_locations lt ON lt.id = t.to_location AND lt.tenant_id = t.tenant_id
       LEFT JOIN users u ON u.id = t.created_by
      WHERE t.tenant_id = $1 AND ($2::text IS NULL OR t.status = $2)
      ORDER BY t.created_at DESC
      LIMIT $3`,
    [tenantId, status ?? null, Math.min(Math.max(limit, 1), 200)]
  );
  if (!res.rows.length) return [];

  const ids = res.rows.map((r: any) => r.id);
  const items = await query<any>(
    `SELECT i.*, p.name AS product_name
       FROM bms_stock_transfer_items i
       LEFT JOIN bms_products p ON p.sku = i.product_sku AND p.tenant_id = i.tenant_id
      WHERE i.tenant_id = $1 AND i.transfer_id = ANY($2::uuid[])
      ORDER BY i.id`,
    [tenantId, ids]
  );
  const byTransfer = new Map<string, StockTransferItem[]>();
  for (const row of items.rows as any[]) {
    const list = byTransfer.get(row.transfer_id) ?? [];
    list.push({
      id: Number(row.id), sku: row.product_sku, productName: row.product_name ?? null,
      size: row.size, qty: Number(row.qty),
      receivedQty: row.received_qty == null ? null : Number(row.received_qty),
    });
    byTransfer.set(row.transfer_id, list);
  }

  return res.rows.map((r: any) => ({
    id: r.id,
    transferNo: r.transfer_no,
    fromLocationId: r.from_location,
    fromLocationName: r.from_name ?? null,
    toLocationId: r.to_location,
    toLocationName: r.to_name ?? null,
    status: r.status,
    note: r.note ?? null,
    createdByName: r.created_by_name ?? null,
    sentAt: r.sent_at ? toISO(r.sent_at) : null,
    receivedAt: r.received_at ? toISO(r.received_at) : null,
    createdAt: toISO(r.created_at),
    items: byTransfer.get(r.id) ?? [],
  }));
}

export async function getStockTransfer(tenantId: string, id: string): Promise<StockTransfer | null> {
  const list = await listStockTransfers(tenantId, null, 200);
  return list.find((t) => t.id === id) ?? null;
}

export type CreateTransferResult =
  | { status: "CREATED"; transferId: string; transferNo: string }
  | { status: "INVALID"; reason: string };

export async function createStockTransfer(input: {
  tenantId: string;
  fromLocationId: string;
  toLocationId: string;
  items: Array<{ sku: string; size: string; qty: number }>;
  note?: string | null;
  createdBy: string;
}): Promise<CreateTransferResult> {
  if (input.fromLocationId === input.toLocationId) {
    return { status: "INVALID", reason: "สาขาต้นทางกับปลายทางต้องต่างกัน" };
  }
  const items = input.items
    .map((i) => ({ sku: i.sku.trim(), size: i.size.trim().toUpperCase(), qty: Math.trunc(Number(i.qty)) }))
    .filter((i) => i.sku && i.size && Number.isInteger(i.qty) && i.qty > 0);
  if (items.length === 0) return { status: "INVALID", reason: "ต้องมีรายการอย่างน้อย 1 รายการ" };

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.createdBy });

    // สาขาทั้งสองต้องเป็นของร้านนี้ — ห้ามเชื่อ id จาก body
    const locs = await client.query(
      `SELECT id FROM bms_locations WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND active`,
      [input.tenantId, [input.fromLocationId, input.toLocationId]]
    );
    if (locs.rowCount !== 2) {
      await client.query("ROLLBACK");
      return { status: "INVALID", reason: "ไม่พบสาขาต้นทางหรือปลายทาง (หรือถูกปิดใช้งาน)" };
    }

    const transferNo = await nextTransferNoInTx(client, input.tenantId);
    const ins = await client.query<{ id: string }>(
      `INSERT INTO bms_stock_transfers (tenant_id, transfer_no, from_location, to_location, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [input.tenantId, transferNo, input.fromLocationId, input.toLocationId, input.note ?? null, input.createdBy]
    );
    const transferId = ins.rows[0].id;

    for (const item of items) {
      await client.query(
        `INSERT INTO bms_stock_transfer_items (tenant_id, transfer_id, product_sku, size, qty)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (transfer_id, product_sku, size) DO UPDATE SET qty = bms_stock_transfer_items.qty + EXCLUDED.qty`,
        [input.tenantId, transferId, item.sku, item.size, item.qty]
      );
    }

    await client.query("COMMIT");
    return { status: "CREATED", transferId, transferNo };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export type TransferActionResult =
  | { status: "OK" }
  | { status: "NOT_FOUND" }
  | { status: "WRONG_STATE"; current: StockTransferStatus }
  | { status: "INSUFFICIENT"; sku: string; size: string; available: number; requested: number };

/**
 * ส่งของออกจากต้นทาง — ตัดสต็อกต้นทางทันที ของเข้าสถานะ "อยู่บนรถ"
 *
 * ตัดจาก current_stock และห้ามให้ต่ำกว่า reserved_stock: ของที่ลูกค้าจองไว้ที่
 * สาขานี้แล้วต้องไม่ถูกส่งไปสาขาอื่น ไม่งั้นออร์เดอร์ที่รับปากลูกค้าไปแล้วจะไม่มีของ
 */
export async function sendStockTransfer(input: {
  tenantId: string; transferId: string; actorUserId: string;
}): Promise<TransferActionResult> {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });

    const head = await client.query<{ id: string; status: StockTransferStatus; from_location: string; transfer_no: string; to_location: string }>(
      `SELECT id, status, from_location, to_location, transfer_no FROM bms_stock_transfers
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [input.tenantId, input.transferId]
    );
    if (!head.rowCount) { await client.query("ROLLBACK"); return { status: "NOT_FOUND" }; }
    const t = head.rows[0];
    if (t.status !== "DRAFT") { await client.query("ROLLBACK"); return { status: "WRONG_STATE", current: t.status }; }

    const items = await client.query<{ product_sku: string; size: string; qty: number }>(
      `SELECT product_sku, size, qty FROM bms_stock_transfer_items
        WHERE tenant_id = $1 AND transfer_id = $2 ORDER BY id`,
      [input.tenantId, input.transferId]
    );

    for (const item of items.rows) {
      const inv = await client.query<{ current_stock: number; reserved_stock: number }>(
        `SELECT current_stock, reserved_stock FROM bms_inventory
          WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4 FOR UPDATE`,
        [input.tenantId, t.from_location, item.product_sku, item.size]
      );
      const available = inv.rowCount
        ? inv.rows[0].current_stock - inv.rows[0].reserved_stock
        : 0;
      if (available < item.qty) {
        await client.query("ROLLBACK");
        return { status: "INSUFFICIENT", sku: item.product_sku, size: item.size, available, requested: item.qty };
      }
      await client.query(
        `UPDATE bms_inventory SET current_stock = current_stock - $5, updated_at = now()
          WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
        [input.tenantId, t.from_location, item.product_sku, item.size, item.qty]
      );
      await recordMovement(client, {
        tenantId: input.tenantId, locationId: t.from_location,
        sku: item.product_sku, size: item.size, type: "TRANSFER_OUT", qty: item.qty,
        note: `โอนออก ${t.transfer_no}`, actor: input.actorUserId,
      });
    }

    await client.query(
      `UPDATE bms_stock_transfers SET status = 'IN_TRANSIT', sent_by = $3, sent_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, input.transferId, input.actorUserId]
    );
    await client.query("COMMIT");
    return { status: "OK" };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * รับของที่ปลายทาง — รับน้อยกว่าที่ส่งได้ (แตก/หาย/นับผิดตอนแพ็ก)
 *
 * ส่วนต่างไม่ถูกกลบหายไปเฉย ๆ: ของที่ส่งออกไปแล้วแต่ไม่ถึงปลายทางถูกบันทึกเป็น
 * STOCK_OUT ที่ต้นทางพร้อมโน้ตว่าหายระหว่างทาง ไม่งั้นมูลค่าสต็อกรวมของบริษัท
 * จะไม่ตรงกับของจริงโดยไม่มีร่องรอยว่าหายตรงไหน
 */
export async function receiveStockTransfer(input: {
  tenantId: string;
  transferId: string;
  actorUserId: string;
  received?: Array<{ itemId: number; qty: number }>;
}): Promise<TransferActionResult> {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });

    const head = await client.query<{ id: string; status: StockTransferStatus; to_location: string; from_location: string; transfer_no: string }>(
      `SELECT id, status, to_location, from_location, transfer_no FROM bms_stock_transfers
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [input.tenantId, input.transferId]
    );
    if (!head.rowCount) { await client.query("ROLLBACK"); return { status: "NOT_FOUND" }; }
    const t = head.rows[0];
    if (t.status !== "IN_TRANSIT") { await client.query("ROLLBACK"); return { status: "WRONG_STATE", current: t.status }; }

    const overrides = new Map((input.received ?? []).map((r) => [Number(r.itemId), Math.max(0, Math.trunc(Number(r.qty)))]));
    const items = await client.query<{ id: number; product_sku: string; size: string; qty: number }>(
      `SELECT id, product_sku, size, qty FROM bms_stock_transfer_items
        WHERE tenant_id = $1 AND transfer_id = $2 ORDER BY id`,
      [input.tenantId, input.transferId]
    );

    for (const item of items.rows) {
      const requested = overrides.has(Number(item.id)) ? overrides.get(Number(item.id))! : item.qty;
      const receivedQty = Math.min(requested, item.qty);

      if (receivedQty > 0) {
        await client.query(
          `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
           VALUES ($1,$2,$3,$4,$5,0)
           ON CONFLICT (tenant_id, location_id, product_sku, size)
             DO UPDATE SET current_stock = bms_inventory.current_stock + EXCLUDED.current_stock, updated_at = now()`,
          [input.tenantId, t.to_location, item.product_sku, item.size, receivedQty]
        );
        await recordMovement(client, {
          tenantId: input.tenantId, locationId: t.to_location,
          sku: item.product_sku, size: item.size, type: "TRANSFER_IN", qty: receivedQty,
          note: `รับโอน ${t.transfer_no}`, actor: input.actorUserId,
        });
      }

      const missing = item.qty - receivedQty;
      if (missing > 0) {
        // ของหายระหว่างทาง — ต้องมีบรรทัดของตัวเอง ไม่ใช่หายเงียบจากผลต่างสองสาขา
        await recordMovement(client, {
          tenantId: input.tenantId, locationId: t.from_location,
          sku: item.product_sku, size: item.size, type: "STOCK_OUT", qty: missing,
          note: `ของขาดระหว่างโอน ${t.transfer_no} (ส่ง ${item.qty} รับ ${receivedQty})`,
          actor: input.actorUserId,
        });
      }

      await client.query(
        `UPDATE bms_stock_transfer_items SET received_qty = $3 WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, item.id, receivedQty]
      );
    }

    await client.query(
      `UPDATE bms_stock_transfers SET status = 'RECEIVED', received_by = $3, received_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, input.transferId, input.actorUserId]
    );
    await client.query("COMMIT");
    return { status: "OK" };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/** ยกเลิกได้เฉพาะตอนยังไม่ส่ง — ของออกจากชั้นไปแล้วต้องเดินให้จบด้วยการรับ */
export async function cancelStockTransfer(input: {
  tenantId: string; transferId: string; actorUserId: string;
}): Promise<TransferActionResult> {
  const res = await query<{ status: StockTransferStatus }>(
    `UPDATE bms_stock_transfers
        SET status = 'CANCELLED', cancelled_by = $3, cancelled_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'
      RETURNING status`,
    [input.tenantId, input.transferId, input.actorUserId]
  );
  if (res.rowCount) return { status: "OK" };

  const cur = await query<{ status: StockTransferStatus }>(
    `SELECT status FROM bms_stock_transfers WHERE tenant_id = $1 AND id = $2`,
    [input.tenantId, input.transferId]
  );
  if (!cur.rowCount) return { status: "NOT_FOUND" };
  return { status: "WRONG_STATE", current: cur.rows[0].status };
}

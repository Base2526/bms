// =============================================================
// BMS CRM — customers service
// -------------------------------------------------------------
// ตาม BUSINESS_RULES: 1 คนหลายช่องทาง/หลายที่อยู่, soft delete
// ยอดซื้อสะสม = SUM(total) ของ order ที่จ่ายแล้ว (PAID ขึ้นไป, ไม่นับ CANCELLED/RETURNED)
// =============================================================

import type { PoolClient } from "pg";
import { query } from "@/lib/db";

// order ที่นับเป็น "ซื้อจริง"
const PAID_STATUSES = ["PAID", "PACKING", "SHIPPED", "COMPLETED"];

/**
 * หา/สร้างลูกค้าจาก (channel, external_ref) ในทรานแซกชันที่ส่ง client มา
 * ถ้าไม่มี ref → คืน null (ไม่ผูกลูกค้า เช่น test/ไม่ระบุ)
 */
export async function resolveOrCreateCustomer(
  client: PoolClient,
  channel: string,
  externalRef: string | null
): Promise<string | null> {
  if (!externalRef) return null;

  const found = await client.query<{ customer_id: string }>(
    `SELECT customer_id FROM bms_customer_identities
      WHERE channel = $1 AND external_ref = $2`,
    [channel, externalRef]
  );
  if (found.rowCount && found.rows[0]) return found.rows[0].customer_id;

  // ลูกค้าใหม่ (ชื่อ = ref ไปก่อน, tag ลูกค้าใหม่)
  const cust = await client.query<{ id: string }>(
    `INSERT INTO bms_customers (name, tags) VALUES ($1, ARRAY['ลูกค้าใหม่']) RETURNING id`,
    [externalRef]
  );
  const customerId = cust.rows[0].id;
  await client.query(
    `INSERT INTO bms_customer_identities (customer_id, channel, external_ref)
     VALUES ($1, $2, $3)
     ON CONFLICT (channel, external_ref) DO NOTHING`,
    [customerId, channel, externalRef]
  );
  return customerId;
}

export async function listCustomers(search = "", limit = 50, offset = 0) {
  const s = search.trim();
  const res = await query(
    `SELECT c.id, c.name, c.phone, c.note, c.tags, c.created_at,
            COALESCE(agg.order_count, 0)  AS order_count,
            COALESCE(agg.total_spent, 0)  AS total_spent
       FROM bms_customers c
       LEFT JOIN (
         SELECT customer_id,
                COUNT(*) FILTER (WHERE status = ANY($4)) AS order_count,
                SUM(total_amount) FILTER (WHERE status = ANY($4)) AS total_spent
           FROM bms_orders
          WHERE customer_id IS NOT NULL
          GROUP BY customer_id
       ) agg ON agg.customer_id = c.id
      WHERE c.deleted_at IS NULL
        AND ($1 = '' OR c.name ILIKE '%'||$1||'%' OR c.phone ILIKE '%'||$1||'%')
      ORDER BY c.created_at DESC
      LIMIT $2 OFFSET $3`,
    [s, Math.min(Math.max(limit, 1), 200), Math.max(offset, 0), PAID_STATUSES]
  );
  return res.rows;
}

export async function getCustomer(id: string) {
  const res = await query(
    `SELECT c.id, c.name, c.phone, c.note, c.tags, c.created_at,
            COALESCE(agg.order_count, 0) AS order_count,
            COALESCE(agg.total_spent, 0) AS total_spent
       FROM bms_customers c
       LEFT JOIN (
         SELECT customer_id,
                COUNT(*) FILTER (WHERE status = ANY($2)) AS order_count,
                SUM(total_amount) FILTER (WHERE status = ANY($2)) AS total_spent
           FROM bms_orders GROUP BY customer_id
       ) agg ON agg.customer_id = c.id
      WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [id, PAID_STATUSES]
  );
  return res.rows[0] ?? null;
}

export async function customerOrders(customerId: string) {
  const res = await query(
    `SELECT id, channel, customer_ref, status, total_amount, created_at, updated_at
       FROM bms_orders WHERE customer_id = $1 ORDER BY created_at DESC`,
    [customerId]
  );
  return res.rows;
}

export async function customerAddresses(customerId: string) {
  const res = await query(
    `SELECT id, label, address, is_default
       FROM bms_customer_addresses WHERE customer_id = $1
      ORDER BY is_default DESC, id`,
    [customerId]
  );
  return res.rows;
}

export async function customerIdentities(customerId: string) {
  const res = await query(
    `SELECT channel, external_ref FROM bms_customer_identities
      WHERE customer_id = $1 ORDER BY id`,
    [customerId]
  );
  return res.rows;
}

export type UpsertCustomerInput = {
  id?: string | null;
  name: string;
  phone?: string | null;
  note?: string | null;
  tags?: string[];
};

export async function upsertCustomer(input: UpsertCustomerInput) {
  const name = input.name.trim();
  if (!name) throw new Error("ชื่อลูกค้าห้ามว่าง");
  const phone = input.phone?.trim() || null;
  const note = input.note?.trim() || null;
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);

  if (input.id) {
    const res = await query(
      `UPDATE bms_customers
          SET name=$2, phone=$3, note=$4, tags=$5, updated_at=now()
        WHERE id=$1 AND deleted_at IS NULL
        RETURNING id, name, phone, note, tags, created_at`,
      [input.id, name, phone, note, tags]
    );
    if (res.rowCount === 0) throw new Error("ไม่พบลูกค้า");
    return res.rows[0];
  }
  const res = await query(
    `INSERT INTO bms_customers (name, phone, note, tags)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, phone, note, tags, created_at`,
    [name, phone, note, tags]
  );
  return res.rows[0];
}

export async function setCustomerTags(id: string, tags: string[]) {
  const clean = (tags ?? []).map((t) => t.trim()).filter(Boolean);
  const res = await query(
    `UPDATE bms_customers SET tags=$2, updated_at=now()
      WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
    [id, clean]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function addCustomerAddress(
  customerId: string,
  label: string | null,
  address: string,
  isDefault: boolean
) {
  const addr = address.trim();
  if (!addr) throw new Error("ที่อยู่ห้ามว่าง");
  if (isDefault) {
    await query(`UPDATE bms_customer_addresses SET is_default=false WHERE customer_id=$1`, [customerId]);
  }
  const res = await query(
    `INSERT INTO bms_customer_addresses (customer_id, label, address, is_default)
     VALUES ($1, $2, $3, $4) RETURNING id, label, address, is_default`,
    [customerId, label?.trim() || null, addr, isDefault]
  );
  return res.rows[0];
}

/** soft delete (BUSINESS_RULES: ห้ามลบจริง) */
export async function deleteCustomer(id: string) {
  const res = await query(
    `UPDATE bms_customers SET deleted_at=now(), updated_at=now()
      WHERE id=$1 AND deleted_at IS NULL`,
    [id]
  );
  return (res.rowCount ?? 0) > 0;
}

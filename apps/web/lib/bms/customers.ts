// =============================================================
// BMS CRM — customers service (tenant-scoped)
// =============================================================

import type { PoolClient } from "pg";
import { query, getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";

const PAID_STATUSES = ["PAID", "PACKING", "SHIPPED", "COMPLETED"];

/** หา/สร้างลูกค้าจาก (tenant, channel, external_ref) ในทรานแซกชันที่ส่ง client มา */
export async function resolveOrCreateCustomer(
  client: PoolClient,
  tenantId: string,
  channel: string,
  externalRef: string | null
): Promise<string | null> {
  if (!externalRef) return null;

  const found = await client.query<{ customer_id: string }>(
    `SELECT customer_id FROM bms_customer_identities
      WHERE tenant_id = $1 AND channel = $2 AND external_ref = $3`,
    [tenantId, channel, externalRef]
  );
  if (found.rowCount && found.rows[0]) return found.rows[0].customer_id;

  const cust = await client.query<{ id: string }>(
    `INSERT INTO bms_customers (tenant_id, name, tags) VALUES ($1, $2, ARRAY['ลูกค้าใหม่']) RETURNING id`,
    [tenantId, externalRef]
  );
  const customerId = cust.rows[0].id;
  await client.query(
    `INSERT INTO bms_customer_identities (tenant_id, customer_id, channel, external_ref)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, channel, external_ref) DO NOTHING`,
    [tenantId, customerId, channel, externalRef]
  );
  return customerId;
}

export async function listCustomers(tenantId: string, search = "", limit = 50, offset = 0) {
  const s = search.trim();
  const res = await query(
    `SELECT c.tenant_id, c.id, c.name, c.phone, c.note, c.tags, c.created_at,
            COALESCE(agg.order_count, 0) AS order_count,
            COALESCE(agg.total_spent, 0) AS total_spent
       FROM bms_customers c
       LEFT JOIN (
         SELECT customer_id,
                COUNT(*) FILTER (WHERE status = ANY($5)) AS order_count,
                SUM(total_amount) FILTER (WHERE status = ANY($5)) AS total_spent
           FROM bms_orders WHERE tenant_id = $1 AND customer_id IS NOT NULL
          GROUP BY customer_id
       ) agg ON agg.customer_id = c.id
      WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
        AND ($2 = '' OR c.name ILIKE '%'||$2||'%' OR c.phone ILIKE '%'||$2||'%')
      ORDER BY c.created_at DESC
      LIMIT $3 OFFSET $4`,
    [tenantId, s, Math.min(Math.max(limit, 1), 200), Math.max(offset, 0), PAID_STATUSES]
  );
  return res.rows;
}

export async function getCustomer(tenantId: string, id: string) {
  const res = await query(
    `SELECT c.tenant_id, c.id, c.name, c.phone, c.note, c.tags, c.created_at,
            COALESCE(agg.order_count, 0) AS order_count,
            COALESCE(agg.total_spent, 0) AS total_spent
       FROM bms_customers c
       LEFT JOIN (
         SELECT customer_id,
                COUNT(*) FILTER (WHERE status = ANY($3)) AS order_count,
                SUM(total_amount) FILTER (WHERE status = ANY($3)) AS total_spent
           FROM bms_orders WHERE tenant_id = $1 GROUP BY customer_id
       ) agg ON agg.customer_id = c.id
      WHERE c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`,
    [tenantId, id, PAID_STATUSES]
  );
  return res.rows[0] ?? null;
}

export async function resolveActiveCustomerId(
  tenantId: string,
  customerId?: string | null,
  opts?: { channel?: string | null; customerRef?: string | null }
): Promise<string | null> {
  if (opts?.channel && opts?.customerRef) {
    const byIdentity = await query<{ customer_id: string }>(
      `SELECT ci.customer_id
         FROM bms_customer_identities ci
         JOIN bms_customers c ON c.id = ci.customer_id
        WHERE ci.tenant_id = $1
          AND ci.channel = $2
          AND ci.external_ref = $3
          AND c.deleted_at IS NULL
        LIMIT 1`,
      [tenantId, opts.channel, opts.customerRef]
    );
    if (byIdentity.rows[0]?.customer_id) return byIdentity.rows[0].customer_id;
  }

  if (!customerId) return null;

  const current = await query<{ id: string }>(
    `SELECT id FROM bms_customers WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
    [tenantId, customerId]
  );
  return (current.rowCount ?? 0) > 0 && current.rows[0] ? current.rows[0].id : null;
}

export async function customerOrders(tenantId: string, customerId: string) {
  const res = await query(
    `SELECT id, channel, customer_ref, customer_id, status, total_amount, created_at, updated_at
       FROM bms_orders WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC`,
    [tenantId, customerId]
  );
  return res.rows;
}

export async function customerAddresses(tenantId: string, customerId: string) {
  const res = await query(
    `SELECT id, label, address, is_default FROM bms_customer_addresses
      WHERE tenant_id = $1 AND customer_id = $2 ORDER BY is_default DESC, id`,
    [tenantId, customerId]
  );
  return res.rows;
}

export async function customerIdentities(tenantId: string, customerId: string) {
  const res = await query(
    `SELECT channel, external_ref FROM bms_customer_identities
      WHERE tenant_id = $1 AND customer_id = $2 ORDER BY id`,
    [tenantId, customerId]
  );
  return res.rows;
}

/**
 * ผสานลูกค้าซ้ำ (คนเดียวกันทักมาคนละช่องทาง เลยถูกสร้างเป็นคนละ record)
 * ย้าย identities/orders/addresses/conversations จาก mergeId ไป keepId แล้ว soft-delete mergeId
 * ปลอดภัยเพราะ (tenant_id, channel, external_ref) เป็น UNIQUE — identity หนึ่งอยู่กับลูกค้าได้ทีละคนเท่านั้น จึงไม่มีชนกันตอนย้าย
 */
export async function mergeCustomers(tenantId: string, keepId: string, mergeId: string) {
  if (keepId === mergeId) throw new Error("เลือกลูกค้าที่จะผสานให้ต่างจากลูกค้าหลัก");

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const rows = await client.query<{ id: string; name: string; phone: string | null; note: string | null; tags: string[] }>(
      `SELECT id, name, phone, note, tags FROM bms_customers
        WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL
        FOR UPDATE`,
      [tenantId, [keepId, mergeId]]
    );
    const keep = rows.rows.find((r) => r.id === keepId);
    const merge = rows.rows.find((r) => r.id === mergeId);
    if (!keep || !merge) {
      await client.query("ROLLBACK");
      throw new Error("ไม่พบลูกค้าที่จะผสาน");
    }

    await client.query(
      `UPDATE bms_customer_identities SET customer_id = $3
        WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, mergeId, keepId]
    );
    await client.query(
      `UPDATE bms_orders SET customer_id = $3
        WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, mergeId, keepId]
    );
    await client.query(
      `UPDATE bms_customer_addresses SET customer_id = $3
        WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, mergeId, keepId]
    );
    await client.query(
      `UPDATE bms_conversations SET customer_id = $3
        WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, mergeId, keepId]
    );

    const mergedTags = Array.from(new Set([...(keep.tags || []), ...(merge.tags || [])]));
    await client.query(
      `UPDATE bms_customers SET
         phone = COALESCE(phone, $2),
         note = COALESCE(note, $3),
         tags = $4,
         updated_at = now()
       WHERE tenant_id = $1 AND id = $5`,
      [tenantId, merge.phone, merge.note, mergedTags, keepId]
    );
    await client.query(
      `UPDATE bms_customers SET deleted_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, mergeId]
    );

    await client.query("COMMIT");
    return true;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export type UpsertCustomerInput = {
  id?: string | null;
  name: string;
  phone?: string | null;
  note?: string | null;
  tags?: string[];
};

export async function upsertCustomer(tenantId: string, input: UpsertCustomerInput) {
  const name = input.name.trim();
  if (!name) throw new Error("ชื่อลูกค้าห้ามว่าง");
  const phone = input.phone?.trim() || null;
  const note = input.note?.trim() || null;
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);

  if (input.id) {
    const res = await query(
      `UPDATE bms_customers SET name=$3, phone=$4, note=$5, tags=$6, updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL
        RETURNING id, name, phone, note, tags, created_at`,
      [tenantId, input.id, name, phone, note, tags]
    );
    if (res.rowCount === 0) throw new Error("ไม่พบลูกค้า");
    return res.rows[0];
  }
  const res = await query(
    `INSERT INTO bms_customers (tenant_id, name, phone, note, tags)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, phone, note, tags, created_at`,
    [tenantId, name, phone, note, tags]
  );
  return res.rows[0];
}

export async function setCustomerTags(tenantId: string, id: string, tags: string[]) {
  const clean = (tags ?? []).map((t) => t.trim()).filter(Boolean);
  const res = await query(
    `UPDATE bms_customers SET tags=$3, updated_at=now()
      WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`,
    [tenantId, id, clean]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function addCustomerAddress(
  tenantId: string, customerId: string, label: string | null, address: string, isDefault: boolean
) {
  const addr = address.trim();
  if (!addr) throw new Error("ที่อยู่ห้ามว่าง");
  if (isDefault) {
    await query(`UPDATE bms_customer_addresses SET is_default=false WHERE tenant_id=$1 AND customer_id=$2`, [tenantId, customerId]);
  }
  const res = await query(
    `INSERT INTO bms_customer_addresses (tenant_id, customer_id, label, address, is_default)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, label, address, is_default`,
    [tenantId, customerId, label?.trim() || null, addr, isDefault]
  );
  return res.rows[0];
}

export async function updateCustomerAddress(
  tenantId: string, addressId: string, label: string | null, address: string
) {
  const addr = address.trim();
  if (!addr) throw new Error("ที่อยู่ห้ามว่าง");
  const res = await query(
    `UPDATE bms_customer_addresses SET label=$3, address=$4
      WHERE tenant_id=$1 AND id=$2
      RETURNING id, label, address, is_default`,
    [tenantId, addressId, label?.trim() || null, addr]
  );
  if (res.rowCount === 0) throw new Error("ไม่พบที่อยู่");
  return res.rows[0];
}

/** ตั้งที่อยู่นี้เป็นค่าเริ่มต้น — เคลียร์ default เดิมของลูกค้าคนนี้ก่อน (ทำใน tx เดียวกันผ่าน query เดียวต่อกัน) */
export async function setDefaultCustomerAddress(tenantId: string, addressId: string) {
  const target = await query<{ customer_id: string }>(
    `SELECT customer_id FROM bms_customer_addresses WHERE tenant_id=$1 AND id=$2`,
    [tenantId, addressId]
  );
  if (target.rowCount === 0) throw new Error("ไม่พบที่อยู่");
  const customerId = target.rows[0].customer_id;

  await query(`UPDATE bms_customer_addresses SET is_default=false WHERE tenant_id=$1 AND customer_id=$2`, [tenantId, customerId]);
  const res = await query(
    `UPDATE bms_customer_addresses SET is_default=true
      WHERE tenant_id=$1 AND id=$2
      RETURNING id, label, address, is_default`,
    [tenantId, addressId]
  );
  return res.rows[0];
}

export async function deleteCustomerAddress(tenantId: string, addressId: string) {
  const res = await query(
    `DELETE FROM bms_customer_addresses WHERE tenant_id=$1 AND id=$2`,
    [tenantId, addressId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function deleteCustomer(tenantId: string, id: string) {
  const res = await query(
    `UPDATE bms_customers SET deleted_at=now(), updated_at=now()
      WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
    [tenantId, id]
  );
  return (res.rowCount ?? 0) > 0;
}

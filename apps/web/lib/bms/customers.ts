// =============================================================
// BMS CRM — customers service (tenant-scoped)
// =============================================================

import type { PoolClient } from "pg";
import { query, getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { normalizeProvince } from "./shippingZones";
import { normalizeCustomerIdentity } from "./customerIdentity";

const PAID_STATUSES = ["PAID", "PACKING", "SHIPPED", "COMPLETED"];
const MARKETPLACE_CHECKOUT_CHANNELS = new Set(["lazada", "shopee"]);
const CUSTOMER_SAFE_ADDRESS_LABELS = new Set([
  "บ้าน",
  "ที่ทำงาน",
  "คอนโด",
  "หอพัก",
  "home",
  "office",
  "condo",
]);

export type CustomerCheckoutMissingField =
  | "recipientName"
  | "phone"
  | "shippingAddress";

export type CustomerCheckoutStatus = {
  customerFound: boolean;
  marketplaceManaged: boolean;
  requiresShippingDetails: boolean;
  hasRecipientName: boolean;
  hasPhone: boolean;
  hasShippingAddress: boolean;
  shippingAddressCount: number;
  defaultAddressLabel: string | null;
  missingFields: CustomerCheckoutMissingField[];
};

export type SaveCustomerCheckoutDetailsInput = {
  recipientName?: string | null;
  phone?: string | null;
  shippingAddress?: string | null;
  addressLabel?: string | null;
  /** จังหวัด/รหัสไปรษณีย์ปลายทาง (7.47) — ใช้คิดค่าส่งตามโซน ไม่บังคับกรอก */
  province?: string | null;
  postcode?: string | null;
};

function cleanOptional(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}

function customerSafeAddressLabel(value: string | null | undefined): string | null {
  const label = cleanOptional(value);
  return label && CUSTOMER_SAFE_ADDRESS_LABELS.has(label.toLocaleLowerCase())
    ? label
    : null;
}

function checkoutStatusFromRow(
  channel: string,
  customerRef: string | null | undefined,
  row?: {
    name: string;
    phone: string | null;
    shipping_address_count: string | number;
    default_address_label: string | null;
  }
): CustomerCheckoutStatus {
  const marketplaceManaged = MARKETPLACE_CHECKOUT_CHANNELS.has(channel);
  const normalizedName = cleanOptional(row?.name);
  const normalizedRef = cleanOptional(customerRef);
  const hasRecipientName = Boolean(
    normalizedName &&
      (!normalizedRef ||
        normalizedName.toLocaleLowerCase() !== normalizedRef.toLocaleLowerCase())
  );
  const hasPhone = Boolean(cleanOptional(row?.phone));
  const shippingAddressCount = Number(row?.shipping_address_count ?? 0);
  const hasShippingAddress = shippingAddressCount > 0;
  const missingFields: CustomerCheckoutMissingField[] = [];

  if (!marketplaceManaged) {
    if (!hasRecipientName) missingFields.push("recipientName");
    if (!hasPhone) missingFields.push("phone");
    if (!hasShippingAddress) missingFields.push("shippingAddress");
  }

  return {
    customerFound: Boolean(row),
    marketplaceManaged,
    requiresShippingDetails: !marketplaceManaged,
    hasRecipientName,
    hasPhone,
    hasShippingAddress,
    shippingAddressCount,
    defaultAddressLabel: customerSafeAddressLabel(row?.default_address_label),
    missingFields,
  };
}

/**
 * Customer-safe checkout status. It deliberately returns only completeness and an optional
 * address label, not the customer's raw name, phone number, or address.
 */
export async function getCustomerCheckoutStatus(
  tenantId: string,
  channel: string,
  customerRef?: string | null
): Promise<CustomerCheckoutStatus> {
  if (!customerRef) return checkoutStatusFromRow(channel, customerRef);

  const result = await query<{
    name: string;
    phone: string | null;
    shipping_address_count: string;
    default_address_label: string | null;
  }>(
    `SELECT c.name,
            c.phone,
            COUNT(a.id) AS shipping_address_count,
            (ARRAY_AGG(a.label ORDER BY a.is_default DESC, a.id)
              FILTER (WHERE a.id IS NOT NULL))[1] AS default_address_label
       FROM bms_customer_identities ci
       JOIN bms_customers c
         ON c.tenant_id = ci.tenant_id
        AND c.id = ci.customer_id
        AND c.deleted_at IS NULL
       LEFT JOIN bms_customer_addresses a
         ON a.tenant_id = c.tenant_id
        AND a.customer_id = c.id
        AND a.address_type = 'shipping'
      WHERE ci.tenant_id = $1
        AND ci.channel = $2
        AND ci.external_ref = $3
      GROUP BY c.id, c.name, c.phone
      LIMIT 1`,
    [tenantId, channel, customerRef]
  );

  return checkoutStatusFromRow(channel, customerRef, result.rows[0]);
}

/**
 * Save only delivery details explicitly supplied by the current channel identity.
 * Existing values are retained when omitted, and a repeated address is selected instead of
 * creating a duplicate row.
 */
export async function saveCustomerCheckoutDetails(
  tenantId: string,
  channel: string,
  customerRef: string,
  input: SaveCustomerCheckoutDetailsInput
): Promise<{ customerId: string; status: CustomerCheckoutStatus }> {
  const recipientName = cleanOptional(input.recipientName);
  const phone = cleanOptional(input.phone);
  const shippingAddress = cleanOptional(input.shippingAddress);
  const addressLabel = cleanOptional(input.addressLabel);
  const province = normalizeProvince(cleanOptional(input.province));
  const postcode = cleanOptional(input.postcode);

  if (postcode && !/^\d{5}$/.test(postcode)) {
    throw new Error("รหัสไปรษณีย์ต้องเป็นเลข 5 หลัก");
  }
  if (!recipientName && !phone && !shippingAddress) {
    throw new Error("ต้องระบุข้อมูลจัดส่งอย่างน้อย 1 รายการ");
  }
  if (recipientName && (recipientName.length < 2 || recipientName.length > 120)) {
    throw new Error("ชื่อผู้รับต้องมี 2-120 ตัวอักษร");
  }
  if (phone && (!/^[0-9+\-()\s]{8,30}$/.test(phone) || phone.replace(/\D/g, "").length < 8)) {
    throw new Error("เบอร์โทรศัพท์ไม่ถูกต้อง");
  }
  if (shippingAddress && (shippingAddress.length < 10 || shippingAddress.length > 1000)) {
    throw new Error("ที่อยู่จัดส่งต้องมี 10-1000 ตัวอักษร");
  }
  if (addressLabel && addressLabel.length > 80) {
    throw new Error("ชื่อที่อยู่ต้องไม่เกิน 80 ตัวอักษร");
  }

  const client = await getClient();
  let customerId: string | null = null;
  try {
    await beginTenantTx(client, tenantId);
    customerId = await resolveOrCreateCustomer(client, tenantId, channel, customerRef);
    if (!customerId) throw new Error("ไม่พบตัวตนลูกค้า");

    if (recipientName || phone) {
      await client.query(
        `UPDATE bms_customers
            SET name = COALESCE($3, name),
                phone = COALESCE($4, phone),
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, customerId, recipientName, phone]
      );
    }

    if (shippingAddress) {
      const existing = await client.query<{ id: string }>(
        `SELECT id
           FROM bms_customer_addresses
          WHERE tenant_id = $1
            AND customer_id = $2
            AND address_type = 'shipping'
            AND LOWER(BTRIM(address)) = LOWER(BTRIM($3))
          ORDER BY is_default DESC, id
          LIMIT 1`,
        [tenantId, customerId, shippingAddress]
      );

      await client.query(
        `UPDATE bms_customer_addresses
            SET is_default = false
          WHERE tenant_id = $1
            AND customer_id = $2
            AND address_type = 'shipping'`,
        [tenantId, customerId]
      );

      if (existing.rows[0]) {
        await client.query(
          `UPDATE bms_customer_addresses
              SET label = COALESCE($3, label),
                  province = COALESCE($4, province),
                  postcode = COALESCE($5, postcode),
                  is_default = true
            WHERE tenant_id = $1 AND id = $2`,
          [tenantId, existing.rows[0].id, addressLabel, province, postcode]
        );
      } else {
        await client.query(
          `INSERT INTO bms_customer_addresses
             (tenant_id, customer_id, label, address, is_default, address_type, province, postcode)
           VALUES ($1, $2, $3, $4, true, 'shipping', $5, $6)`,
          [tenantId, customerId, addressLabel, shippingAddress, province, postcode]
        );
      }
    } else if (province || postcode) {
      // ส่งมาแค่จังหวัด/ไปรษณีย์ (ไม่ได้แก้ที่อยู่) → เติมให้แถวที่อยู่ default เดิม
      await client.query(
        `UPDATE bms_customer_addresses
            SET province = COALESCE($3, province), postcode = COALESCE($4, postcode)
          WHERE tenant_id = $1 AND id = (
            SELECT id FROM bms_customer_addresses
             WHERE tenant_id = $1 AND customer_id = $2 AND address_type = 'shipping'
             ORDER BY is_default DESC, id LIMIT 1
          )`,
        [tenantId, customerId, province, postcode]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }

  const status = await getCustomerCheckoutStatus(tenantId, channel, customerRef);
  return { customerId, status };
}

/** หา/สร้างลูกค้าจาก (tenant, channel, external_ref) ในทรานแซกชันที่ส่ง client มา */
export async function resolveOrCreateCustomer(
  client: PoolClient,
  tenantId: string,
  channel: string,
  externalRef: string | null
): Promise<string | null> {
  const identity = normalizeCustomerIdentity(channel, externalRef);
  if (!identity) return null;
  const { channel: normalizedChannel, customerRef: normalizedRef } = identity;

  const found = await client.query<{ customer_id: string }>(
    `SELECT customer_id FROM bms_customer_identities
      WHERE tenant_id = $1 AND channel = $2 AND external_ref = $3`,
    [tenantId, normalizedChannel, normalizedRef]
  );
  if (found.rowCount && found.rows[0]) return found.rows[0].customer_id;

  const cust = await client.query<{ id: string }>(
    `INSERT INTO bms_customers (tenant_id, name, tags) VALUES ($1, $2, ARRAY['ลูกค้าใหม่']) RETURNING id`,
    [tenantId, normalizedRef]
  );
  const customerId = cust.rows[0].id;
  const insertedIdentity = await client.query<{ customer_id: string }>(
    `INSERT INTO bms_customer_identities (tenant_id, customer_id, channel, external_ref)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, channel, external_ref) DO NOTHING
     RETURNING customer_id`,
    [tenantId, customerId, normalizedChannel, normalizedRef]
  );
  if (insertedIdentity.rows[0]) {
    await linkCustomerOwnedRecordsInTx(
      client,
      tenantId,
      normalizedChannel,
      normalizedRef,
      insertedIdentity.rows[0].customer_id
    );
    return insertedIdentity.rows[0].customer_id;
  }

  // Another webhook may have established the same identity concurrently.
  // Discard this transaction's unused customer row and use the winner so an
  // intake can never be attached to an orphan CRM record.
  const winner = await client.query<{ customer_id: string }>(
    `SELECT customer_id FROM bms_customer_identities
      WHERE tenant_id = $1 AND channel = $2 AND external_ref = $3`,
    [tenantId, normalizedChannel, normalizedRef]
  );
  await client.query(
    `DELETE FROM bms_customers
      WHERE tenant_id = $1 AND id = $2
        AND NOT EXISTS (
          SELECT 1 FROM bms_customer_identities
           WHERE tenant_id = $1 AND customer_id = $2
        )`,
    [tenantId, customerId]
  );
  const winnerId = winner.rows[0]?.customer_id ?? null;
  if (winnerId) {
    await linkCustomerOwnedRecordsInTx(
      client,
      tenantId,
      normalizedChannel,
      normalizedRef,
      winnerId
    );
  }
  return winnerId;
}

async function linkCustomerOwnedRecordsInTx(
  client: PoolClient,
  tenantId: string,
  channel: string,
  customerRef: string,
  customerId: string
): Promise<void> {
  await client.query(
    `UPDATE bms_orders
        SET customer_id = $4, updated_at = now()
      WHERE tenant_id = $1 AND channel = $2 AND customer_ref = $3
        AND customer_id IS NULL`,
    [tenantId, channel, customerRef, customerId]
  );
  await client.query(
    `UPDATE bms_conversations
        SET customer_id = $4, updated_at = now()
      WHERE tenant_id = $1 AND channel = $2 AND customer_ref = $3
        AND customer_id IS NULL`,
    [tenantId, channel, customerRef, customerId]
  );
  await client.query(
    `UPDATE bms_restock_subscriptions
        SET customer_id = $4, updated_at = now()
      WHERE tenant_id = $1 AND channel = $2 AND customer_ref = $3
        AND customer_id IS NULL`,
    [tenantId, channel, customerRef, customerId]
  );
  await client.query(
    `UPDATE bms_pharmacy_assessments assessment
        SET customer_id = $4, updated_at = now()
       FROM bms_conversations conversation
      WHERE assessment.tenant_id = $1
        AND conversation.tenant_id = $1
        AND conversation.channel = $2
        AND conversation.customer_ref = $3
        AND conversation.customer_id = $4
        AND assessment.conversation_id = conversation.id
        AND assessment.customer_id IS NULL`,
    [tenantId, channel, customerRef, customerId]
  );
}

export async function findCustomerIdByIdentity(
  tenantId: string,
  channel?: string | null,
  customerRef?: string | null
): Promise<string | null> {
  const identity = normalizeCustomerIdentity(channel, customerRef);
  if (!identity) return null;
  const res = await query<{ customer_id: string }>(
    `SELECT ci.customer_id
       FROM bms_customer_identities ci
       JOIN bms_customers customer
         ON customer.tenant_id = ci.tenant_id
        AND customer.id = ci.customer_id
        AND customer.deleted_at IS NULL
      WHERE ci.tenant_id = $1 AND ci.channel = $2 AND ci.external_ref = $3
      LIMIT 1`,
    [tenantId, identity.channel, identity.customerRef]
  );
  return res.rows[0]?.customer_id ?? null;
}

/**
 * Establish the shared canonical CRM customer for commerce and pharmacy flows.
 * New identities also claim any older unlinked records with the same channel key;
 * deployment migration 7.74 performs the equivalent backfill for existing identities.
 */
export async function ensureCustomerForIdentity(
  tenantId: string,
  channel: string,
  externalRef: string | null | undefined
): Promise<string | null> {
  const identity = normalizeCustomerIdentity(channel, externalRef);
  if (!identity) return null;
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const customerId = await resolveOrCreateCustomer(
      client,
      tenantId,
      identity.channel,
      identity.customerRef
    );
    if (!customerId) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("COMMIT");
    return customerId;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
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

    const rows = await client.query<{
      id: string;
      name: string;
      phone: string | null;
      email: string | null;
      note: string | null;
      tags: string[];
      preferred_language: string | null;
      timezone: string | null;
      followup_opt_out: boolean;
    }>(
      `SELECT id, name, phone, email, note, tags, preferred_language, timezone, followup_opt_out
         FROM bms_customers
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
      `UPDATE bms_customer_addresses source
          SET is_default = false
        WHERE source.tenant_id = $1
          AND source.customer_id = $2
          AND source.is_default = true
          AND EXISTS (
            SELECT 1
              FROM bms_customer_addresses destination
             WHERE destination.tenant_id = $1
               AND destination.customer_id = $3
               AND destination.address_type = source.address_type
               AND destination.is_default = true
          )`,
      [tenantId, mergeId, keepId]
    );
    await client.query(
      `UPDATE bms_customer_addresses SET customer_id = $3
        WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, mergeId, keepId]
    );
    await client.query(
      `WITH ranked AS (
         SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY address_type
                  ORDER BY is_default DESC, id
                ) AS position
           FROM bms_customer_addresses
          WHERE tenant_id = $1 AND customer_id = $2
       )
       UPDATE bms_customer_addresses address
          SET is_default = (ranked.position = 1)
         FROM ranked
        WHERE address.id = ranked.id
          AND address.is_default IS DISTINCT FROM (ranked.position = 1)`,
      [tenantId, keepId]
    );
    await client.query(
      `UPDATE bms_conversations SET customer_id = $3
        WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, mergeId, keepId]
    );
    await client.query(
      `UPDATE bms_pharmacy_assessments SET customer_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, mergeId, keepId]
    );
    await client.query(
      `UPDATE bms_restock_subscriptions SET customer_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, mergeId, keepId]
    );
    await client.query(
      `UPDATE bms_customer_coupon_wallet destination
          SET state = source.state,
              claimed_at = source.claimed_at,
              reserved_at = source.reserved_at,
              reserved_order_id = source.reserved_order_id,
              redeemed_at = source.redeemed_at,
              redeemed_order_id = source.redeemed_order_id,
              expired_at = source.expired_at,
              revoked_at = source.revoked_at,
              updated_at = GREATEST(destination.updated_at, source.updated_at)
         FROM bms_customer_coupon_wallet source
        WHERE source.tenant_id = $1
          AND source.customer_id = $2
          AND destination.tenant_id = $1
          AND destination.customer_id = $3
          AND destination.coupon_id = source.coupon_id
          AND (
            CASE source.state
              WHEN 'REDEEMED' THEN 60 WHEN 'RESERVED' THEN 50 WHEN 'REVOKED' THEN 40
              WHEN 'EXPIRED' THEN 30 WHEN 'CLAIMED' THEN 20 ELSE 10
            END
            >
            CASE destination.state
              WHEN 'REDEEMED' THEN 60 WHEN 'RESERVED' THEN 50 WHEN 'REVOKED' THEN 40
              WHEN 'EXPIRED' THEN 30 WHEN 'CLAIMED' THEN 20 ELSE 10
            END
            OR (source.state = destination.state AND source.updated_at > destination.updated_at)
          )`,
      [tenantId, mergeId, keepId]
    );
    await client.query(
      `DELETE FROM bms_customer_coupon_wallet source
        USING bms_customer_coupon_wallet destination
       WHERE source.tenant_id = $1
         AND source.customer_id = $2
         AND destination.tenant_id = $1
         AND destination.customer_id = $3
         AND destination.coupon_id = source.coupon_id`,
      [tenantId, mergeId, keepId]
    );
    await client.query(
      `UPDATE bms_customer_coupon_wallet SET customer_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, mergeId, keepId]
    );
    // Any cached insight for either record is stale after histories are combined.
    await client.query(
      `DELETE FROM bms_customer_ai_summary
        WHERE tenant_id = $1 AND customer_id = ANY($2::uuid[])`,
      [tenantId, [keepId, mergeId]]
    );

    const mergedTags = Array.from(new Set([...(keep.tags || []), ...(merge.tags || [])]));
    await client.query(
      `UPDATE bms_customers SET
         phone = COALESCE(phone, $2),
         note = COALESCE(note, $3),
         tags = $4,
         email = COALESCE(email, $6),
         preferred_language = COALESCE(preferred_language, $7),
         timezone = COALESCE(timezone, $8),
         followup_opt_out = followup_opt_out OR $9,
         updated_at = now()
       WHERE tenant_id = $1 AND id = $5`,
      [
        tenantId,
        merge.phone,
        merge.note,
        mergedTags,
        keepId,
        merge.email,
        merge.preferred_language,
        merge.timezone,
        merge.followup_opt_out,
      ]
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

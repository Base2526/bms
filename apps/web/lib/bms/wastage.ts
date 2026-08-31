import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { recordMovement } from "./movements";
import { consumeLotsForWastageInTx } from "./lots";
import { isCapabilityEnabledInTx } from "./storeCapabilities";

export type InventoryWastage = {
  id: string;
  locationId: string;
  locationName: string | null;
  productSku: string;
  productName: string;
  size: string;
  qty: number;
  reason: string;
  orderId: string | null;
  actorName: string | null;
  createdAt: string;
};

export async function listInventoryWastage(
  tenantId: string,
  limit = 100
): Promise<InventoryWastage[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit) || 100), 1), 200);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await client.query(
      `SELECT w.id, w.location_id, l.name AS location_name,
              w.product_sku, p.name AS product_name, w.size, w.qty,
              w.reason, w.order_id, u.name AS actor_name, w.created_at
         FROM bms_inventory_wastage w
         JOIN bms_locations l
           ON l.tenant_id = w.tenant_id AND l.id = w.location_id
         JOIN bms_products p
           ON p.tenant_id = w.tenant_id AND p.sku = w.product_sku
         LEFT JOIN users u
           ON u.tenant_id = w.tenant_id AND u.id = w.actor_user_id
        WHERE w.tenant_id = $1
        ORDER BY w.created_at DESC, w.id DESC
        LIMIT $2`,
      [tenantId, safeLimit]
    );
    await client.query("COMMIT");
    return result.rows.map((row: any) => ({
      id: row.id,
      locationId: row.location_id,
      locationName: row.location_name ?? null,
      productSku: row.product_sku,
      productName: row.product_name,
      size: row.size,
      qty: Number(row.qty),
      reason: row.reason,
      orderId: row.order_id ?? null,
      actorName: row.actor_name ?? null,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function recordInventoryWastage(input: {
  tenantId: string;
  locationId: string;
  productSku: string;
  size: string;
  qty: number;
  reason: string;
  actorUserId: string;
  orderId?: string | null;
}): Promise<{ id: string }> {
  const qty = Math.trunc(Number(input.qty));
  const reason = String(input.reason ?? "").trim();
  if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error("จำนวนของเสียต้องมากกว่า 0");
  if (!reason) throw new Error("ต้องระบุเหตุผลของเสีย");

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    if (!(await isCapabilityEnabledInTx(client, input.tenantId, "WASTAGE"))) {
      throw new Error("ร้านยังไม่ได้เปิดความสามารถ Wastage — เปิดที่ /admin/stock-models ก่อนตัดของเสีย");
    }
    const adjusted = await client.query(
      `UPDATE bms_inventory
          SET current_stock = current_stock - $5, updated_at = now()
        WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4
          AND (current_stock - reserved_stock) >= $5`,
      [input.tenantId, input.locationId, input.productSku, input.size, qty]
    );
    if (!adjusted.rowCount) throw new Error("Stock ที่ไม่ถูกจองมีไม่พอสำหรับบันทึกของเสีย");
    // ยอดรวมกับยอดล็อตต้องขยับพร้อมกันเสมอ (invariant ของ lots.ts) — ของเสียคือทางหลัก
    // ที่ของหมดอายุออกจากชั้น ถ้าไม่ตัดล็อตด้วย ล็อตที่หมดอายุจะค้างยอดไว้ให้ FEFO หยิบต่อ
    await consumeLotsForWastageInTx(client, {
      tenantId: input.tenantId,
      locationId: input.locationId,
      productSku: input.productSku,
      size: input.size,
      qty,
    });
    const wastage = await client.query<{ id: string }>(
      `INSERT INTO bms_inventory_wastage
         (tenant_id, location_id, product_sku, size, qty, reason, actor_user_id, order_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [input.tenantId, input.locationId, input.productSku, input.size, qty,
        reason, input.actorUserId, input.orderId ?? null]
    );
    await recordMovement(client, {
      tenantId: input.tenantId,
      locationId: input.locationId,
      sku: input.productSku,
      size: input.size,
      type: "WASTAGE",
      qty,
      refOrderId: input.orderId ?? null,
      note: reason,
      actor: `user:${input.actorUserId}`,
    });
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'inventory.wastage_recorded',$3,$4::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`, wastage.rows[0].id,
        JSON.stringify({ locationId: input.locationId, sku: input.productSku, size: input.size, qty })]
    );
    await client.query("COMMIT");
    return wastage.rows[0];
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

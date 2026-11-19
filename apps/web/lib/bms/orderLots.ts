import type { PoolClient } from "pg";
import { usableLotSql, inheritQualityHold } from "./lotQuality";
import { validateTransferLotReceiptInTx } from "./lots";
/** Called after the order's stock update has locked inventory; throws => caller rolls back all. */
export async function consumeOrderLotsInTx(
  c: PoolClient,
  tenant: string,
  order: string,
) {
  const items = (
    await c.query(
      `SELECT order_item_id id,location_id,product_sku,size,qty FROM bms_order_stock_lines WHERE tenant_id=$1 AND order_id=$2 ORDER BY location_id,product_sku,size,order_item_id`,
      [tenant, order],
    )
  ).rows;
  for (const it of items) {
    const all = (
      await c.query(
        `SELECT id,qty,expiry_date::text,${usableLotSql("l")} usable FROM bms_inventory_lots l WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 ORDER BY expiry_date NULLS LAST,received_at,id FOR UPDATE`,
        [tenant, it.location_id, it.product_sku, it.size],
      )
    ).rows;
    if (!all.length) {
      const policy = await c.query<{ requires_lots: boolean }>(
        `SELECT (lot_tracking OR expiry_tracking) AS requires_lots
           FROM bms_product_stock_policies
          WHERE tenant_id=$1 AND product_sku=$2 FOR SHARE`,
        [tenant, it.product_sku],
      );
      if (policy.rows[0]?.requires_lots) throw new Error("INSUFFICIENT_USABLE_LOTS");
      continue;
    }
    const day = (
      await c.query(
        `SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date::text AS day`,
      )
    ).rows[0].day;
    let remaining = it.qty;
    for (const lot of all) {
      if (
        !lot.usable ||
        (lot.expiry_date && lot.expiry_date < day) ||
        remaining === 0
      )
        continue;
      const take = Math.min(remaining, lot.qty);
      if (!take) continue;
      await c.query(
        `UPDATE bms_inventory_lots SET qty=qty-$3,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [tenant, lot.id, take],
      );
      await c.query(
        `INSERT INTO bms_order_item_lots(tenant_id,order_item_id,lot_id,qty) VALUES($1,$2,$3,$4) ON CONFLICT(order_item_id,lot_id) DO UPDATE SET qty=bms_order_item_lots.qty+EXCLUDED.qty`,
        [tenant, it.id, lot.id, take],
      );
      remaining -= take;
    }
    if (remaining) throw new Error("INSUFFICIENT_USABLE_LOTS");
  }
}
/** Full return only, after the owning order transition; no guessed historical allocations. */
export async function restoreOrderLotsInTx(
  c: PoolClient,
  tenant: string,
  order: string,
) {
  // The caller has incremented and locked inventory in this transaction. Validate every
  // component against its original allocations before restoring any lot. Historical sales
  // without lot evidence must not silently add untracked units to a now-tracked branch.
  const stockLines = await c.query<{
    location_id: string; product_sku: string; size: string; qty: number;
    lot_tracking: boolean; expiry_tracking: boolean;
  }>(
    `SELECT sl.location_id, sl.product_sku, sl.size, SUM(sl.qty)::integer AS qty,
            COALESCE(policy.lot_tracking, false) AS lot_tracking,
            COALESCE(policy.expiry_tracking, false) AS expiry_tracking
       FROM bms_order_stock_lines sl
       LEFT JOIN bms_product_stock_policies policy
         ON policy.tenant_id = sl.tenant_id AND policy.product_sku = sl.product_sku
      WHERE sl.tenant_id = $1 AND sl.order_id = $2
      GROUP BY sl.location_id, sl.product_sku, sl.size, policy.lot_tracking, policy.expiry_tracking
      ORDER BY sl.location_id, sl.product_sku, sl.size`,
    [tenant, order],
  );
  const restored: Array<{ lot_id: string; qty: number }> = [];
  for (const line of stockLines.rows) {
    const allocations = await c.query<{
      lot_id: string; lot_no: string; expiry_date: string | null; qty: number;
    }>(
      `SELECT oil.lot_id, lot.lot_no, lot.expiry_date::text AS expiry_date,
              SUM(oil.qty)::integer AS qty
         FROM bms_order_item_lots oil
         JOIN bms_inventory_lots lot ON lot.tenant_id = oil.tenant_id AND lot.id = oil.lot_id
        WHERE oil.tenant_id = $1 AND lot.location_id = $3
          AND lot.product_sku = $4 AND lot.size = $5
          AND EXISTS (
            SELECT 1 FROM bms_order_stock_lines sl
             WHERE sl.tenant_id = oil.tenant_id AND sl.order_id = $2
               AND sl.order_item_id = oil.order_item_id AND sl.location_id = lot.location_id
               AND sl.product_sku = lot.product_sku AND sl.size = lot.size
          )
        GROUP BY oil.lot_id, lot.lot_no, lot.expiry_date
        ORDER BY oil.lot_id`,
      [tenant, order, line.location_id, line.product_sku, line.size],
    );
    const allocated = allocations.rows.reduce((sum, lot) => sum + Number(lot.qty), 0);
    if ((allocations.rows.length || line.lot_tracking || line.expiry_tracking) && allocated !== Number(line.qty)) {
      throw new Error(`STOCK_REVIEW_REQUIRED: ${line.product_sku}/${line.size} ข้อมูลล็อตตอนขายไม่ครบสำหรับรับคืน`);
    }
    const reason = await validateTransferLotReceiptInTx(c, {
      tenantId: tenant, locationId: line.location_id, productSku: line.product_sku,
      size: line.size, receivedQty: Number(line.qty), lots: allocations.rows,
    });
    if (reason) throw new Error(`STOCK_REVIEW_REQUIRED: ${reason}`);
    restored.push(...allocations.rows);
  }
  for (const x of restored) {
    await c.query(
      `UPDATE bms_inventory_lots SET qty = qty + $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenant, x.lot_id, x.qty],
    );
    await inheritQualityHold(
      c,
      tenant,
      x.lot_id,
      x.lot_id,
      "system:order-return",
    );
  }
}

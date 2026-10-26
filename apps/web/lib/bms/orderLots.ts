import type { PoolClient } from "pg";
import { usableLotSql, inheritQualityHold } from "./lotQuality";
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
    if (!all.length) continue;
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
  await c.query(
    `UPDATE bms_inventory_lots l SET qty=l.qty+x.qty,updated_at=now() FROM (SELECT oil.lot_id,sum(oil.qty)::int qty FROM bms_order_item_lots oil WHERE oil.tenant_id=$1 AND EXISTS(SELECT 1 FROM bms_order_stock_lines sl WHERE sl.tenant_id=oil.tenant_id AND sl.order_item_id=oil.order_item_id AND sl.order_id=$2) GROUP BY oil.lot_id) x WHERE l.tenant_id=$1 AND l.id=x.lot_id`,
    [tenant, order],
  );
  const restored = (
    await c.query(
      `SELECT DISTINCT oil.lot_id FROM bms_order_item_lots oil JOIN bms_order_items oi ON oi.tenant_id=oil.tenant_id AND oi.id=oil.order_item_id WHERE oil.tenant_id=$1 AND oi.order_id=$2`,
      [tenant, order],
    )
  ).rows;
  for (const x of restored)
    await inheritQualityHold(
      c,
      tenant,
      x.lot_id,
      x.lot_id,
      "system:order-return",
    );
}

import type { PoolClient } from "pg";
import { consumeOrderLotsInTx } from "./orderLots";
import { recordOrderMovements } from "./movements";

/** Consume a reserved order once, including its lot evidence and stock ledger. Caller owns the tenant transaction. */
export async function consumeReservedOrderStockInTx(
  client: PoolClient,
  tenantId: string,
  orderId: string,
  actor: string,
): Promise<void> {
  const result = await client.query<{ expected_count: string; updated_count: string }>(
    `WITH expected AS (
       SELECT tenant_id, location_id, product_sku, size, SUM(qty)::integer AS qty
         FROM bms_order_stock_lines
        WHERE tenant_id = $1 AND order_id = $2
        GROUP BY tenant_id, location_id, product_sku, size
     ), updated AS (
       UPDATE bms_inventory inv
          SET current_stock = inv.current_stock - expected.qty,
              reserved_stock = inv.reserved_stock - expected.qty,
              updated_at = now()
         FROM expected
        WHERE inv.tenant_id = $1
          AND inv.tenant_id = expected.tenant_id
          AND inv.location_id = expected.location_id
          AND inv.product_sku = expected.product_sku
          AND inv.size = expected.size
          AND inv.current_stock >= expected.qty
          AND inv.reserved_stock >= expected.qty
       RETURNING inv.product_sku
     )
     SELECT (SELECT count(*)::text FROM expected) AS expected_count,
            (SELECT count(*)::text FROM updated) AS updated_count`,
    [tenantId, orderId],
  );
  const counts = result.rows[0];
  if (!counts || Number(counts.expected_count) !== Number(counts.updated_count)) {
    throw new Error("STOCK_REVIEW_REQUIRED: order reservation is incomplete");
  }
  await consumeOrderLotsInTx(client, tenantId, orderId);
  await recordOrderMovements(client, [orderId], "SHIP", actor);
}

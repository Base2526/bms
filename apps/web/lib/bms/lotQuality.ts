import type { PoolClient } from "pg";
import { notifyQualityCase } from "./operationQualityDispatch";

/** Static SQL fragment only; alias is an internal identifier, never client input. */
export function usableLotSql(alias: string) {
  if (!/^[a-z_]+$/.test(alias)) throw new Error("Invalid internal SQL alias");
  return `NOT EXISTS(SELECT 1 FROM bms_operation_lot_holds qh WHERE qh.tenant_id=${alias}.tenant_id AND qh.lot_id=${alias}.id AND qh.status='ACTIVE')`;
}
/** Read-only availability; physical/reserved balances remain unchanged. Unknown reconciliation cannot promise stock. */
export function usableStockSql(alias: string) {
  if (!/^[a-z_]+$/.test(alias)) throw new Error("Invalid internal SQL alias");
  return `(SELECT CASE WHEN count(*)=0 THEN GREATEST(${alias}.current_stock-${alias}.reserved_stock,0)
    WHEN sum(ql.qty)<>${alias}.current_stock THEN 0
    ELSE GREATEST(COALESCE(sum(ql.qty) FILTER(WHERE ${usableLotSql("ql")} AND (ql.expiry_date IS NULL OR ql.expiry_date >= (now() AT TIME ZONE 'Asia/Bangkok')::date)),0)-${alias}.reserved_stock,0) END::int
    FROM bms_inventory_lots ql WHERE ql.tenant_id=${alias}.tenant_id AND ql.location_id=${alias}.location_id AND ql.product_sku=${alias}.product_sku AND ql.size=${alias}.size)`;
}
export async function qualityStock(
  c: PoolClient,
  tenant: string,
  location: string,
  sku: string,
  size: string,
) {
  // Separate statement after the lock is essential: a waiter must see a newly committed hold.
  const inv = (
    await c.query(
      `SELECT current_stock,reserved_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 FOR UPDATE`,
      [tenant, location, sku, size],
    )
  ).rows[0];
  const lots = (
    await c.query(
      `SELECT l.id,l.qty,l.expiry_date::text,${usableLotSql("l")} usable FROM bms_inventory_lots l WHERE l.tenant_id=$1 AND l.location_id=$2 AND l.product_sku=$3 AND l.size=$4 ORDER BY l.id FOR UPDATE OF l`,
      [tenant, location, sku, size],
    )
  ).rows;
  const day = (
    await c.query(
      `SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date::text AS day`,
    )
  ).rows[0].day;
  const total = lots.reduce((n, l) => n + l.qty, 0),
    eligible = lots
      .filter((l) => l.usable && (!l.expiry_date || l.expiry_date >= day))
      .reduce((n, l) => n + l.qty, 0);
  const stock = inv?.current_stock ?? 0,
    reserved = inv?.reserved_stock ?? 0;
  return {
    stock,
    reserved,
    lots,
    reconciled: !lots.length || total === stock,
    available: lots.length
      ? Math.max(0, Math.min(stock, eligible) - reserved)
      : Math.max(0, stock - reserved),
  };
}
/** Generic count/adjust/transfer cannot erase or reinterpret held stock. */
export async function assertNoQualityHold(
  c: PoolClient,
  tenant: string,
  location: string,
  sku: string,
  size: string,
) {
  const x = await qualityStock(c, tenant, location, sku, size);
  if (x.lots.some((l) => !l.usable)) throw new Error("LOT_QUALITY_HOLD");
}
/** Return a held lot to another branch without making it usable. Source lot is locked first. */
export async function inheritQualityHold(
  c: PoolClient,
  tenant: string,
  source: string,
  destination: string,
  actor: string,
  reason: "RETURN" | "RECEIPT" = "RETURN",
) {
  const h = (
    await c.query(
      `SELECT * FROM bms_operation_lot_holds WHERE tenant_id=$1 AND lot_id=ANY($2::uuid[]) AND status='ACTIVE' ORDER BY (lot_id=$3) DESC LIMIT 1`,
      [tenant, [source, destination], source],
    )
  ).rows[0];
  if (!h) return;
  const inserted =
    source === destination
      ? { rowCount: 0, rows: [] }
      : await c.query(
          `INSERT INTO bms_operation_lot_holds(tenant_id,case_id,lot_id,base_unit,reason,created_by,inherited_from) VALUES($1,$2,$3,$4,'Held lot returned across branches',$5,$6) ON CONFLICT(tenant_id,lot_id) WHERE status='ACTIVE' DO NOTHING RETURNING id`,
          [tenant, h.case_id, destination, h.base_unit, actor, h.id],
        );
  const destinationHold = (
    await c.query(
      `SELECT id,case_id FROM bms_operation_lot_holds WHERE tenant_id=$1 AND lot_id=$2 AND status='ACTIVE'`,
      [tenant, destination],
    )
  ).rows[0];
  await c.query(
    `UPDATE bms_operation_lot_holds SET version=version+1 WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,
    [tenant, [...new Set([h.id, destinationHold?.id].filter(Boolean))]],
  );
  for (const caseId of new Set(
    [h.case_id, destinationHold?.case_id].filter(Boolean),
  )) {
    const updated = await c.query(
      `UPDATE bms_operation_quality_cases SET status='OPEN',run_id=NULL,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING id,location_id,assigned_to,version`,
      [tenant, caseId],
    );
    await c.query(
      `INSERT INTO bms_operation_quality_events(tenant_id,case_id,action,actor,note,evidence) VALUES($1,$2,$5,$3,'Held lot replenished; inspection required',$4::jsonb)`,
      [
        tenant,
        caseId,
        actor,
        JSON.stringify({
          source,
          destination,
          holdId: inserted.rows[0]?.id ?? h.id,
        }),
        `${reason}_HOLD`,
      ],
    );
    await notifyQualityCase(c, tenant, updated.rows[0], "QUALITY_CHANGED");
  }
}

import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { costMonth } from "./operatingCostMath";
import { scanSalesEvidenceInTx } from "./salesEvidence";
import { createAllocationDriver } from "./costAllocationMath";
import { getCostAllocationReportInTx } from "./costAllocations";
import { createNetProfitAccumulator, type ProfitGap } from "./netProfitMath";

export function normalizeProfitMonth(value: unknown) {
  const month = costMonth(value);
  if (!month.startsWith("20")) throw new Error("NET_PROFIT_MONTH_UNSUPPORTED");
  return month;
}

// These sources have no reconciled historical valuation in phase 7/8. Detect them instead of
// silently reporting zero loss or subtracting cash twice. No current catalog valuation is guessed.
const GAPS_SQL = `SELECT key,code FROM (
  SELECT 'BLIND_RETURN:'||id AS key,'BLIND_RETURN_UNRECONCILED'::text AS code,created_at
    FROM bms_pos_blind_returns WHERE tenant_id=$1
  UNION ALL
  SELECT 'STOCK_MOVEMENT:'||id,'INVENTORY_ADJUSTMENT_UNVALUED',created_at
    FROM bms_stock_movements WHERE tenant_id=$1 AND
      (type IN ('WASTAGE','TRANSFER_LOST','COUNT_ADJUST') OR (type='STOCK_OUT' AND ref_order_id IS NULL))
) gaps WHERE created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
  AND created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
ORDER BY key LIMIT 1001`;

/** Read-only composition. No posting, snapshot backfill, price change or current-cost estimate. */
export async function getNetProfitReport(tenantId: string, actorId: string, value: unknown, actualCosts = false, transaction?: PoolClient) {
  const month = normalizeProfitMonth(value);
  if (!tenantId || !actorId) throw new Error("NET_PROFIT_FORBIDDEN");
  const from = `${month}-01`;
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const client = transaction ?? await getClient();
  try {
    if (!transaction) await beginTenantTx(client, tenantId, { serializable: true });
    await client.query("SET LOCAL statement_timeout = '30s'");
    const access = (await client.query(`SELECT EXISTS (SELECT 1 FROM bms_user_allowed_locations
      WHERE tenant_id=$1 AND user_id=$2) AS scoped,
      (SELECT currency FROM bms_store_profile WHERE tenant_id=$1) AS currency`, [tenantId, actorId])).rows[0];
    if (!access || access.scoped) throw new Error("NET_PROFIT_ALL_BRANCH_ACCESS_REQUIRED");
    if (access.currency !== "THB") throw new Error("NET_PROFIT_CURRENCY_REVIEW_REQUIRED");
    const profit = createNetProfitAccumulator(actualCosts), driver = createAllocationDriver();
    const scan = await scanSalesEvidenceInTx(client, tenantId, actorId, { from, to }, event => { profit.add(event); driver.add(event); }, actualCosts);
    const allocation = await getCostAllocationReportInTx(client, tenantId, actorId, month, driver.finish(scan.truncated));
    let gaps = (await client.query<ProfitGap>(GAPS_SQL, [tenantId, from, to])).rows;
    const gapsTruncated = gaps.length > 1000;
    if (actualCosts) {
      const valued = (await client.query<{id:string;location_id:string;kind:string;amount:string}>(`SELECT movement_id::text AS id,location_id,kind,round(amount,2)::text AS amount
        FROM bms_inventory_value_entries WHERE tenant_id=$1 AND amount IS NOT NULL
          AND kind IN ('WASTAGE','TRANSFER_LOST','COUNT_IN','COUNT_OUT','STOCK_OUT')
          AND created_at>=($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND created_at<(($3::date+1)::timestamp AT TIME ZONE 'Asia/Bangkok') ORDER BY movement_id LIMIT 20001`,[tenantId,from,to])).rows;
      if (valued.length>20000) throw new Error("NET_PROFIT_VALUATION_LIMIT");
      const known = new Set(valued.map(r=>`STOCK_MOVEMENT:${r.id}`));
      gaps = gaps.filter(g=>!known.has(g.key));
      for (const row of valued) profit.addLoss(row.location_id,row.kind==='COUNT_IN' ? `-${row.amount}` : row.amount);
    }
    const result = profit.finish(allocation, scan, gaps.slice(0, 1000), gapsTruncated);
    if (!transaction) await client.query("COMMIT");
    return { ...result, month, currency: "THB", observedAt: scan.observedAt };
  } catch (error) { try { if (!transaction) await client.query("ROLLBACK"); } catch {} throw error; }
  finally { if (!transaction) client.release(); }
}

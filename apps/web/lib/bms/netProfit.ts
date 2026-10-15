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
export async function getNetProfitReport(tenantId: string, actorId: string, value: unknown) {
  const month = normalizeProfitMonth(value);
  if (!tenantId || !actorId) throw new Error("NET_PROFIT_FORBIDDEN");
  const from = `${month}-01`;
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { serializable: true });
    await client.query("SET LOCAL statement_timeout = '30s'");
    const access = (await client.query(`SELECT EXISTS (SELECT 1 FROM bms_user_allowed_locations
      WHERE tenant_id=$1 AND user_id=$2) AS scoped,
      (SELECT currency FROM bms_store_profile WHERE tenant_id=$1) AS currency`, [tenantId, actorId])).rows[0];
    if (!access || access.scoped) throw new Error("NET_PROFIT_ALL_BRANCH_ACCESS_REQUIRED");
    if (access.currency !== "THB") throw new Error("NET_PROFIT_CURRENCY_REVIEW_REQUIRED");
    const profit = createNetProfitAccumulator(), driver = createAllocationDriver();
    const scan = await scanSalesEvidenceInTx(client, tenantId, actorId, { from, to }, event => { profit.add(event); driver.add(event); });
    const allocation = await getCostAllocationReportInTx(client, tenantId, actorId, month, driver.finish(scan.truncated));
    const gaps = (await client.query<ProfitGap>(GAPS_SQL, [tenantId, from, to])).rows;
    const result = profit.finish(allocation, scan, gaps.slice(0, 1000), gaps.length > 1000);
    await client.query("COMMIT");
    return { ...result, month, currency: "THB", observedAt: scan.observedAt };
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(); }
}

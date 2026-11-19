import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { getNetProfitReport } from "./netProfit";
import { getFishOwnerSnapshot } from "./fishOwnerRead";
import { evidenceCents, evidenceDecimal } from "./salesEvidenceMath";
import { FishOwnerError } from "./fishOwnerOperations";

/** Signed half-up division, used only for management allocations in satang. */
function prorate(amount: bigint, numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new FishOwnerError("NO_REVENUE_BASIS", "ไม่มียอดขายเดือนนี้สำหรับแบ่งค่าใช้จ่าย");
  const value = amount * numerator;
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const rounded = (magnitude * 2n + denominator) / (denominator * 2n);
  return negative ? -rounded : rounded;
}

export function allocateFishCostByRevenue(revenue: bigint[], pool: bigint, monthlyGross: bigint) {
  if (monthlyGross <= 0n) throw new FishOwnerError("NO_REVENUE_BASIS", "ไม่มียอดขายเดือนนี้สำหรับแบ่งค่าใช้จ่าย");
  if (revenue.some(value => value < 0n)) throw new FishOwnerError("INVALID_REVENUE_WEIGHT", "ฐานจัดสรรค่าใช้จ่ายต้องไม่ติดลบ");
  const dailyRevenue = revenue.reduce((sum, value) => sum + value, 0n);
  if (dailyRevenue <= 0n || dailyRevenue > monthlyGross)
    throw new FishOwnerError("NO_FISH_REVENUE", "ยอดขายปลาวันที่เลือกไม่พอสำหรับจัดสรรค่าใช้จ่าย");
  const dayPool = prorate(pool, dailyRevenue, monthlyGross);
  let cumulativeRevenue = 0n, assigned = 0n;
  const allocations = revenue.map(value => {
    cumulativeRevenue += value;
    const target = prorate(dayPool, cumulativeRevenue, dailyRevenue);
    const share = target - assigned;
    assigned = target;
    return share;
  });
  return { dayPool, allocations };
}

/** Returns reverse profit, while shared costs follow only positive merchandise sales. */
export function fishAllocationWeights(revenue: bigint[]) {
  return revenue.map(value => value > 0n ? value : 0n);
}

function day(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new FishOwnerError("INVALID_DATE", "วันที่ต้องเป็น YYYY-MM-DD");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new FishOwnerError("INVALID_DATE", "วันที่ไม่มีอยู่จริง");
  return value;
}

/** Read-only management allocation. Gross sale/cost rows remain the underlying evidence. */
export async function getFishOwnerAllocatedProfit(tenant: string, actor: string, rawDay: unknown) {
  const selectedDay = day(rawDay);
  const month = selectedDay.slice(0, 7);
  const snapshot = await getFishOwnerSnapshot(tenant, actor, selectedDay);
  if (snapshot.profit.truncated || snapshot.profit.missingLotCount || snapshot.profit.missingCostEvents)
    return { status: "FISH_EVIDENCE_INCOMPLETE" as const, day: selectedDay, month };

  const report = await getNetProfitReport(tenant, actor, month, true);
  if (!report.complete || !report.totals.complete || report.truncated)
    return { status: "MONTH_EVIDENCE_INCOMPLETE" as const, day: selectedDay, month,
      issues: report.issues.map(issue => issue.code).slice(0, 20) };

  const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1))
    .toISOString().slice(0, 10);
  const client = await getClient();
  let monthlyGross = "0", stockLoss = "0";
  try {
    await beginTenantTx(client, tenant);
    const result = (await client.query<{ gross: string; loss: string }>(`
      WITH sold AS (
        SELECT COALESCE(SUM(oi.line_amount),0) AS amount
          FROM bms_order_items oi JOIN bms_orders o ON o.tenant_id=oi.tenant_id AND o.id=oi.order_id
         WHERE oi.tenant_id=$1 AND (o.paid_at IS NOT NULL OR o.status IN ('PAID','PACKING','SHIPPED','COMPLETED','RETURNED'))
           AND (COALESCE(o.paid_at,o.created_at) AT TIME ZONE 'Asia/Bangkok')::date >= $2::date
           AND (COALESCE(o.paid_at,o.created_at) AT TIME ZONE 'Asia/Bangkok')::date < $3::date
      ), loss AS (
        SELECT COALESCE(SUM(CASE WHEN kind='COUNT_IN' THEN -amount ELSE amount END),0) AS amount
          FROM bms_inventory_value_entries
         WHERE tenant_id=$1 AND kind IN ('WASTAGE','TRANSFER_LOST','COUNT_IN','COUNT_OUT','STOCK_OUT')
           AND (created_at AT TIME ZONE 'Asia/Bangkok')::date >= $2::date
           AND (created_at AT TIME ZONE 'Asia/Bangkok')::date < $3::date
      )
      SELECT round((SELECT amount FROM sold),2)::text AS gross,
             round((SELECT amount FROM loss),2)::text AS loss`, [tenant, `${month}-01`, nextMonth])).rows[0];
    monthlyGross = result.gross; stockLoss = result.loss;
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }

  const denominator = evidenceCents(monthlyGross);
  if (denominator <= 0n) return { status: "NO_REVENUE_BASIS" as const, day: selectedDay, month };
  const pool = evidenceCents(report.totals.knownExpenseTotal) + evidenceCents(stockLoss);
  const rows = snapshot.profit.rows;
  const revenue = rows.map(row => evidenceCents(row.revenue));
  const allocationWeights = fishAllocationWeights(rows.map(row => evidenceCents(row.saleRevenue)));
  let allocation: ReturnType<typeof allocateFishCostByRevenue>;
  try { allocation = allocateFishCostByRevenue(allocationWeights, pool, denominator); }
  catch (error) {
    if (error instanceof FishOwnerError) return { status: error.code as "NO_FISH_REVENUE" | "NO_REVENUE_BASIS", day: selectedDay, month };
    throw error;
  }
  const allocated = rows.map((row, index) => {
    const expense = allocation.allocations[index];
    const grossProfit = BigInt(Math.round((row.profit ?? 0) * 100));
    return { sku: row.sku, size: row.size, lotId: row.lot_id, lotNo: row.lot_no,
      customerId: row.customer_id, customerName: row.customer_name,
      revenue: evidenceDecimal(revenue[index]), grossProfit: evidenceDecimal(grossProfit),
      allocatedSharedCost: evidenceDecimal(expense), allocatedNetProfit: evidenceDecimal(grossProfit - expense) };
  });
  return { status: "READY" as const, day: selectedDay, month, rows: allocated,
    monthlyMerchandiseRevenue: monthlyGross, monthlySharedCost: evidenceDecimal(pool),
    selectedDaySharedCost: evidenceDecimal(allocation.dayPool),
    netReportObservedAt: report.observedAt,
    basis: "MANAGEMENT_ESTIMATE_REVENUE_SHARE_PRE_INCOME_TAX" as const,
    note: "Revenue shares use positive gross merchandise line amounts before returns, order-wide discounts and VAT. Return rows retain negative revenue but receive no second shared-cost allocation. This is a management estimate, not an exact statutory net margin." };
}

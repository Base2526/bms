import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
});

function dateKey(value: Date) {
  const parts = DATE_FORMATTER.formatToParts(value);
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(value: string, days: number) {
  const parsed = new Date(`${value}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function validDate(value: unknown, fallback: string, field: string) {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`DELIVERY_ANALYTICS_${field}_INVALID`);
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error(`DELIVERY_ANALYTICS_${field}_INVALID`);
  }
  return text;
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : null;
}

export function normalizeDeliveryAnalyticsRange(from?: unknown, to?: unknown) {
  const today = dateKey(new Date());
  const end = validDate(to, today, "TO");
  const start = validDate(from, addDays(end, -29), "FROM");
  if (start > end) throw new Error("DELIVERY_ANALYTICS_RANGE_INVALID");
  const span = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  if (span > 366) throw new Error("DELIVERY_ANALYTICS_RANGE_TOO_LARGE");
  return { from: start, to: end };
}

export async function getDeliveryProviderAnalytics(input: {
  tenantId: string;
  from?: unknown;
  to?: unknown;
  locationId?: unknown;
  granularity?: unknown;
}) {
  const range = normalizeDeliveryAnalyticsRange(input.from, input.to);
  const locationId = typeof input.locationId === "string" && input.locationId.trim()
    ? input.locationId.trim() : null;
  if (locationId && !UUID_RE.test(locationId)) throw new Error("DELIVERY_ANALYTICS_LOCATION_INVALID");
  const granularity = String(input.granularity ?? "DAY").trim().toUpperCase();
  if (!["DAY", "WEEK", "MONTH"].includes(granularity)) throw new Error("DELIVERY_ANALYTICS_GRANULARITY_INVALID");
  const bucketUnit = granularity === "MONTH" ? "month" : granularity === "WEEK" ? "week" : "day";

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId);
    if (locationId) {
      const location = await client.query(
        `SELECT 1 FROM bms_locations WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, locationId],
      );
      if (!location.rowCount) throw new Error("DELIVERY_ANALYTICS_LOCATION_NOT_FOUND");
    }

    const operations = await client.query<any>(
      `WITH providers AS (
         SELECT provider FROM (VALUES ('GRABFOOD'),('LINEMAN'),('FOODPANDA')) AS p(provider)
       )
       SELECT p.provider,
              COUNT(d.id) FILTER (WHERE d.bms_order_id IS NOT NULL
                                    AND d.received_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                                    AND d.received_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'))::int AS intake_orders,
              COUNT(d.id) FILTER (WHERE d.bms_order_id IS NULL
                                    AND d.received_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                                    AND d.received_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'))::int AS shadow_orders,
              COUNT(d.id) FILTER (WHERE d.bms_order_id IS NOT NULL
                                    AND d.received_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                                    AND d.received_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
                                    AND d.accepted_at IS NOT NULL)::int AS accepted_orders,
              COUNT(d.id) FILTER (WHERE d.bms_order_id IS NOT NULL
                                    AND d.received_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                                    AND d.received_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
                                    AND d.completed_at IS NOT NULL)::int AS completed_orders,
              COUNT(d.id) FILTER (WHERE d.bms_order_id IS NOT NULL
                                    AND d.received_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                                    AND d.received_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
                                    AND (d.local_status IN ('REJECTED','CANCELLED','EXPIRED')
                                         OR upper(COALESCE(d.provider_status,''))='CANCELLED'))::int AS cancelled_orders,
              COUNT(d.id) FILTER (WHERE d.bms_order_id IS NOT NULL
                                    AND d.received_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                                    AND d.received_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
                                    AND d.local_status='ACTION_REQUIRED')::int AS action_required_orders,
              AVG(EXTRACT(EPOCH FROM (d.accepted_at-d.received_at))/60.0)
                FILTER (WHERE d.bms_order_id IS NOT NULL
                          AND d.received_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                          AND d.received_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
                          AND d.accepted_at >= d.received_at) AS avg_acceptance_minutes,
              AVG(EXTRACT(EPOCH FROM (d.ready_at-d.preparing_at))/60.0)
                FILTER (WHERE d.bms_order_id IS NOT NULL
                          AND d.received_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                          AND d.received_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
                          AND d.ready_at >= d.preparing_at) AS avg_preparation_minutes,
              COUNT(o.id) FILTER (WHERE o.status IN ('PAID','PACKING','SHIPPED','COMPLETED','RETURNED')
                                    AND COALESCE(o.paid_at,o.created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                                    AND COALESCE(o.paid_at,o.created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'))::int AS sales_orders,
              COALESCE(SUM(o.total_amount) FILTER (WHERE o.status IN ('PAID','PACKING','SHIPPED','COMPLETED','RETURNED')
                                    AND COALESCE(o.paid_at,o.created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                                    AND COALESCE(o.paid_at,o.created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')),0) AS gross_sales,
              MIN(d.currency) FILTER (WHERE d.currency IS NOT NULL AND (
                                    (d.received_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                                     AND d.received_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'))
                                    OR (o.status IN ('PAID','PACKING','SHIPPED','COMPLETED','RETURNED')
                                        AND COALESCE(o.paid_at,o.created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                                        AND COALESCE(o.paid_at,o.created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'))
                                  )) AS currency,
              COUNT(DISTINCT d.currency) FILTER (WHERE d.currency IS NOT NULL AND (
                                    (d.received_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                                     AND d.received_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'))
                                    OR (o.status IN ('PAID','PACKING','SHIPPED','COMPLETED','RETURNED')
                                        AND COALESCE(o.paid_at,o.created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
                                        AND COALESCE(o.paid_at,o.created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'))
                                  ))::int AS currency_count
         FROM providers p
         LEFT JOIN bms_delivery_orders d
           ON d.tenant_id=$1 AND d.provider=p.provider
          AND ($4::uuid IS NULL OR d.location_id=$4::uuid)
         LEFT JOIN bms_orders o ON o.tenant_id=d.tenant_id AND o.id=d.bms_order_id
        GROUP BY p.provider ORDER BY p.provider`,
      [input.tenantId, range.from, range.to, locationId],
    );

    const refunds = await client.query<any>(
      `WITH raw_refunds AS (
         SELECT pr.order_id, 'pos:' || a.id::text AS event_id, a.amount, o.total_amount,
                COALESCE(a.completed_at,a.updated_at) AS occurred_at
           FROM bms_pos_refund_allocations a
           JOIN bms_pos_returns pr ON pr.tenant_id=a.tenant_id AND pr.id=a.pos_return_id
           JOIN bms_orders o ON o.tenant_id=pr.tenant_id AND o.id=pr.order_id
          WHERE a.tenant_id=$1 AND a.status='COMPLETED'
         UNION ALL
         SELECT p.order_id, 'payment:' || p.id::text, p.amount, o.total_amount,
                COALESCE(p.refunded_at,p.updated_at)
           FROM bms_payments p
           JOIN bms_orders o ON o.tenant_id=p.tenant_id AND o.id=p.order_id
          WHERE p.tenant_id=$1 AND p.status='REFUNDED'
            AND NOT EXISTS (SELECT 1 FROM bms_pos_refund_allocations a
                             WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)
       ), capped AS (
         SELECT order_id, occurred_at,
                GREATEST(LEAST(amount,total_amount-COALESCE(SUM(amount) OVER (
                  PARTITION BY order_id ORDER BY occurred_at,event_id
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)),0) AS amount
           FROM raw_refunds
       )
       SELECT d.provider, COALESCE(SUM(c.amount),0) AS refund_amount,
              MIN(d.currency) AS refund_currency,
              COUNT(DISTINCT d.currency)::int AS refund_currency_count
         FROM capped c
         JOIN bms_delivery_orders d ON d.tenant_id=$1 AND d.bms_order_id=c.order_id
        WHERE c.occurred_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND c.occurred_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND ($4::uuid IS NULL OR d.location_id=$4::uuid)
        GROUP BY d.provider`,
      [input.tenantId, range.from, range.to, locationId],
    );

    const commands = await client.query<any>(
      `SELECT d.provider,
              COUNT(*)::int AS command_count,
              COUNT(*) FILTER (WHERE c.status='SUCCEEDED')::int AS command_succeeded,
              COUNT(*) FILTER (WHERE c.status IN ('FAILED','MANUAL_ACTION_REQUIRED'))::int AS command_problem,
              COUNT(*) FILTER (WHERE c.status IN ('PENDING','PROCESSING','RETRY'))::int AS command_pending
         FROM bms_delivery_commands c
         JOIN bms_delivery_orders d ON d.tenant_id=c.tenant_id AND d.id=c.delivery_order_id
        WHERE c.tenant_id=$1
          AND c.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND c.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND ($4::uuid IS NULL OR d.location_id=$4::uuid)
        GROUP BY d.provider`,
      [input.tenantId, range.from, range.to, locationId],
    );

    const settlements = locationId ? { rows: [] as any[] } : await client.query<any>(
      `SELECT provider, COUNT(*)::int AS statement_count,
              COUNT(*) FILTER (WHERE status='MISMATCH')::int AS mismatch_statements,
              COALESCE(SUM(gross_amount),0) AS statement_gross,
              COALESCE(SUM(fee_amount),0) AS fee_amount,
              COALESCE(SUM(discount_amount),0) AS discount_amount,
              COALESCE(SUM(commission_amount),0) AS commission_amount,
              COALESCE(SUM(refund_amount),0) AS settlement_refund_amount,
              COALESCE(SUM(adjustment_amount),0) AS adjustment_amount,
              COALESCE(SUM(expected_net_amount),0) AS expected_net_amount,
              SUM(actual_net_amount) AS actual_net_amount,
              COUNT(actual_net_amount)::int AS actual_statement_count,
              MIN(currency) AS settlement_currency,
              COUNT(DISTINCT currency)::int AS settlement_currency_count
         FROM bms_delivery_settlements
        WHERE tenant_id=$1
          AND period_start >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND period_end <= (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        GROUP BY provider`,
      [input.tenantId, range.from, range.to],
    );

    const trend = await client.query<any>(
      `WITH sales AS (
         SELECT d.provider,
                date_trunc('${bucketUnit}',COALESCE(o.paid_at,o.created_at) AT TIME ZONE 'Asia/Bangkok')::date AS bucket,
                COUNT(*)::int AS orders,COALESCE(SUM(o.total_amount),0) AS gross_sales
           FROM bms_delivery_orders d
           JOIN bms_orders o ON o.tenant_id=d.tenant_id AND o.id=d.bms_order_id
          WHERE d.tenant_id=$1 AND o.status IN ('PAID','PACKING','SHIPPED','COMPLETED','RETURNED')
            AND COALESCE(o.paid_at,o.created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND COALESCE(o.paid_at,o.created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND ($4::uuid IS NULL OR d.location_id=$4::uuid)
          GROUP BY d.provider,bucket
       ), raw_refunds AS (
         SELECT pr.order_id,'pos:' || a.id::text AS event_id,a.amount,o.total_amount,
                COALESCE(a.completed_at,a.updated_at) AS occurred_at
           FROM bms_pos_refund_allocations a
           JOIN bms_pos_returns pr ON pr.tenant_id=a.tenant_id AND pr.id=a.pos_return_id
           JOIN bms_orders o ON o.tenant_id=pr.tenant_id AND o.id=pr.order_id
          WHERE a.tenant_id=$1 AND a.status='COMPLETED'
         UNION ALL
         SELECT p.order_id,'payment:' || p.id::text,p.amount,o.total_amount,
                COALESCE(p.refunded_at,p.updated_at)
           FROM bms_payments p
           JOIN bms_orders o ON o.tenant_id=p.tenant_id AND o.id=p.order_id
          WHERE p.tenant_id=$1 AND p.status='REFUNDED'
            AND NOT EXISTS (SELECT 1 FROM bms_pos_refund_allocations a
                             WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)
       ), capped AS (
         SELECT order_id,occurred_at,
                GREATEST(LEAST(amount,total_amount-COALESCE(SUM(amount) OVER (
                  PARTITION BY order_id ORDER BY occurred_at,event_id
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)),0) AS amount
           FROM raw_refunds
       ), refunds AS (
         SELECT d.provider,date_trunc('${bucketUnit}',c.occurred_at AT TIME ZONE 'Asia/Bangkok')::date AS bucket,
                COALESCE(SUM(c.amount),0) AS refund_amount
           FROM capped c
           JOIN bms_delivery_orders d ON d.tenant_id=$1 AND d.bms_order_id=c.order_id
          WHERE c.occurred_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND c.occurred_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
            AND ($4::uuid IS NULL OR d.location_id=$4::uuid)
          GROUP BY d.provider,bucket
       ), keys AS (
         SELECT provider,bucket FROM sales UNION SELECT provider,bucket FROM refunds
       )
       SELECT k.provider,k.bucket,COALESCE(s.orders,0)::int AS orders,
              COALESCE(s.gross_sales,0) AS gross_sales,COALESCE(r.refund_amount,0) AS refund_amount
         FROM keys k
         LEFT JOIN sales s USING(provider,bucket)
         LEFT JOIN refunds r USING(provider,bucket)
        ORDER BY k.bucket,k.provider`,
      [input.tenantId, range.from, range.to, locationId],
    );

    await client.query("COMMIT");
    const refundByProvider = new Map(refunds.rows.map((row) => [row.provider, row]));
    const commandByProvider = new Map(commands.rows.map((row) => [row.provider, row]));
    const settlementByProvider = new Map(settlements.rows.map((row) => [row.provider, row]));
    const rows = operations.rows.map((row) => {
      const grossSales = number(row.gross_sales);
      const refund = refundByProvider.get(row.provider) as any;
      const refundAmount = number(refund?.refund_amount);
      const intakeOrders = number(row.intake_orders);
      const acceptedOrders = number(row.accepted_orders);
      const completedOrders = number(row.completed_orders);
      const cancelledOrders = number(row.cancelled_orders);
      const salesOrders = number(row.sales_orders);
      const command = commandByProvider.get(row.provider) as any;
      const settlement = settlementByProvider.get(row.provider) as any;
      const commandSucceeded = number(command?.command_succeeded);
      const commandTerminal = commandSucceeded + number(command?.command_problem);
      const statementGross = settlement ? number(settlement.statement_gross) : null;
      const feeAmount = settlement ? number(settlement.fee_amount) : null;
      const commissionAmount = settlement ? number(settlement.commission_amount) : null;
      const expectedNet = settlement ? number(settlement.expected_net_amount) : null;
      const actualNet = settlement?.actual_net_amount == null ? null : number(settlement.actual_net_amount);
      const statementCount = number(settlement?.statement_count);
      const actualStatementCount = number(settlement?.actual_statement_count);
      const actualPayoutComplete = statementCount > 0 && actualStatementCount === statementCount;
      const currencies = [row.currency, refund?.refund_currency, settlement?.settlement_currency]
        .filter((value): value is string => typeof value === "string" && value.length > 0);
      return {
        provider: row.provider,
        currency: row.currency ?? refund?.refund_currency ?? settlement?.settlement_currency ?? "THB",
        mixedCurrency: number(row.currency_count) > 1 || number(refund?.refund_currency_count) > 1
          || number(settlement?.settlement_currency_count) > 1 || new Set(currencies).size > 1,
        intakeOrders, shadowOrders: number(row.shadow_orders), acceptedOrders, completedOrders, cancelledOrders,
        actionRequiredOrders: number(row.action_required_orders), salesOrders,
        grossSales, refundAmount, netSales: grossSales - refundAmount,
        averageOrderValue: salesOrders > 0 ? grossSales / salesOrders : 0,
        acceptanceRate: ratio(acceptedOrders, intakeOrders),
        completionRate: ratio(completedOrders, intakeOrders),
        cancellationRate: ratio(cancelledOrders, intakeOrders),
        averageAcceptanceMinutes: row.avg_acceptance_minutes == null ? null : number(row.avg_acceptance_minutes),
        averagePreparationMinutes: row.avg_preparation_minutes == null ? null : number(row.avg_preparation_minutes),
        commandCount: number(command?.command_count),
        commandSucceeded, commandProblem: number(command?.command_problem),
        commandPending: number(command?.command_pending),
        commandSuccessRate: ratio(commandSucceeded, commandTerminal),
        settlement: settlement ? {
          statementCount,
          actualStatementCount,
          actualPayoutComplete,
          mismatchStatements: number(settlement.mismatch_statements),
          grossAmount: statementGross,
          feeAmount,
          discountAmount: number(settlement.discount_amount),
          commissionAmount,
          refundAmount: number(settlement.settlement_refund_amount),
          adjustmentAmount: number(settlement.adjustment_amount),
          expectedNetAmount: expectedNet,
          actualNetAmount: actualNet,
          varianceAmount: actualPayoutComplete && actualNet != null ? actualNet - (expectedNet ?? 0) : null,
          feeCommissionRate: statementGross && statementGross > 0
            ? ((feeAmount ?? 0) + (commissionAmount ?? 0)) / statementGross * 100 : null,
        } : null,
      };
    });
    return {
      ...range,
      locationId,
      granularity,
      settlementScope: locationId ? "ALL_BRANCHES_ONLY" : "SELECTED_PERIOD",
      providers: rows,
      trend: trend.rows.map((row) => ({
        provider: row.provider,
        bucket: row.bucket instanceof Date ? row.bucket.toISOString().slice(0, 10) : String(row.bucket).slice(0, 10),
        orders: number(row.orders), grossSales: number(row.gross_sales),
        refundAmount: number(row.refund_amount),
        netSales: number(row.gross_sales) - number(row.refund_amount),
      })),
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

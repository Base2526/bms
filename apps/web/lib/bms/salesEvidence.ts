import { getClient } from "@/lib/db";
import type { PoolClient } from "pg";
import { beginTenantTx } from "./tenant";
import { createSalesEvidenceAccumulator, type SalesEvidenceEvent } from "./salesEvidenceMath";

export const SALES_EVIDENCE_PAGE_SIZE = 100;
export const SALES_EVIDENCE_EVENT_LIMIT = 20000;
export type SalesEvidenceFilter = { from: string; to: string; locationId: string | null; channel: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function normalizeSalesEvidenceFilter(input: unknown): SalesEvidenceFilter {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("SALES_EVIDENCE_INVALID_INPUT");
  const p = input as Record<string, unknown>;
  if (Object.keys(p).some(k => !["from", "to", "locationId", "channel"].includes(k))) throw new Error("SALES_EVIDENCE_INVALID_INPUT");
  const date = (v: unknown): string => {
    if (typeof v !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v))
      || new Date(v).toISOString().slice(0, 10) !== v) throw new Error("SALES_EVIDENCE_INVALID_DATE");
    return v;
  };
  const from = date(p.from), to = date(p.to), days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (days < 0 || days >= 366) throw new Error("SALES_EVIDENCE_INVALID_RANGE");
  if (p.locationId != null && (typeof p.locationId !== "string" || !uuid.test(p.locationId))) throw new Error("SALES_EVIDENCE_INVALID_LOCATION");
  if (p.channel != null && (typeof p.channel !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(p.channel))) throw new Error("SALES_EVIDENCE_INVALID_CHANNEL");
  return { from, to, locationId: p.locationId == null ? null : String(p.locationId).toLowerCase(), channel: p.channel as string ?? null };
}

// Each source is one event, not a join of sales x returns x payment allocations.
// Identity paging covers the whole selected population (or explicitly reports the safety cap).
// Header selection is bounded BEFORE expanding line JSON. No current catalog or recipe reads.
const EVENTS_SQL = `WITH events AS (
  SELECT 'SALE:'||o.id AS key, 'SALE'::text AS kind, o.id AS order_id, o.id::text AS source_id,
    COALESCE(o.paid_at,o.created_at) AS occurred_at, o.location_id, o.channel,
    o.paid_at IS NULL AS legacy_date
  FROM bms_orders o WHERE o.tenant_id=$1 AND
    (o.paid_at IS NOT NULL OR o.status IN ('PAID','PACKING','SHIPPED','COMPLETED','RETURNED'))
  UNION ALL
  SELECT 'RETURN:'||r.id, 'RETURN', r.order_id, r.id::text, r.created_at, r.return_location_id, o.channel, false
  FROM bms_pos_returns r JOIN bms_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id WHERE r.tenant_id=$1
  UNION ALL
  SELECT 'REFUND:'||a.id, 'REFUND', r.order_id, a.id::text, a.completed_at, r.return_location_id, o.channel, false
  FROM bms_pos_refund_allocations a JOIN bms_pos_returns r ON r.tenant_id=a.tenant_id AND r.id=a.pos_return_id
  JOIN bms_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id WHERE a.tenant_id=$1 AND a.status='COMPLETED'
  UNION ALL
  SELECT 'PAYMENT_REFUND:'||p.id, 'PAYMENT_REFUND', p.order_id, p.id::text,
    COALESCE(p.refunded_at,p.updated_at), o.location_id, o.channel, p.refunded_at IS NULL
  FROM bms_payments p JOIN bms_orders o ON o.tenant_id=p.tenant_id AND o.id=p.order_id
  WHERE p.tenant_id=$1 AND p.status='REFUNDED'
    AND NOT EXISTS (SELECT 1 FROM bms_pos_refund_allocations a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)
  UNION ALL
  SELECT 'BACKOFFICE_RETURN:'||o.id, 'BACKOFFICE_RETURN', o.id, o.id::text,
    COALESCE(o.returned_at,o.updated_at), o.location_id, o.channel, o.returned_at IS NULL
  FROM bms_orders o WHERE o.tenant_id=$1 AND o.status='RETURNED'
    AND NOT EXISTS (SELECT 1 FROM bms_pos_returns r WHERE r.tenant_id=o.tenant_id AND r.order_id=o.id)
  UNION ALL
  SELECT 'TAX_ADJUSTMENT:'||d.id, 'TAX_ADJUSTMENT', d.order_id, d.id::text,
    d.issued_at, d.location_id, o.channel, false
  FROM bms_tax_documents d JOIN bms_orders o ON o.tenant_id=d.tenant_id AND o.id=d.order_id
  WHERE d.tenant_id=$1 AND d.doc_type IN ('CREDIT_NOTE','DEBIT_NOTE') AND d.cancelled_at IS NULL
), page AS (
  SELECT * FROM events WHERE occurred_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
    AND occurred_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
    AND ($4::uuid[] IS NULL OR location_id=ANY($4::uuid[]))
    AND ($5::text IS NULL OR channel=$5) AND key COLLATE "C" > $6::text COLLATE "C"
  ORDER BY key COLLATE "C" LIMIT $7
)
SELECT e.key, e.kind, e.order_id AS "orderId", e.location_id AS "locationId", e.channel,
  to_char(e.occurred_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS day,
  CASE e.kind
  WHEN 'SALE' THEN (SELECT jsonb_build_object('legacyDate',e.legacy_date,
    'cancelledWithoutReturn',o.status='CANCELLED' AND NOT EXISTS
      (SELECT 1 FROM bms_pos_returns r WHERE r.tenant_id=o.tenant_id AND r.order_id=o.id),
    'net',o.total_amount::text,'discount',o.discount_amount::text,'shipping',o.shipping_fee::text,
    'rounding',o.rounding_amount::text,'taxable',o.taxable_amount::text,'exempt',o.exempt_amount::text,'vat',o.vat_amount::text,
    'extras',(SELECT COALESCE(SUM(x.qty*x.unit_amount),0)::text FROM bms_order_extra_lines x WHERE x.tenant_id=o.tenant_id AND x.order_id=o.id),
    'lines',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i.id::text,'sku',i.product_sku,'size',i.size,
      'qty',i.qty::text,'amount',i.line_amount::text,'cost',i.cost_amount_snapshot::text,'costSource',i.cost_snapshot_source) ORDER BY i.id),'[]'::jsonb)
      FROM (SELECT * FROM bms_order_items WHERE tenant_id=$1 AND order_id=e.order_id ORDER BY id LIMIT 1001) i))
    FROM bms_orders o WHERE o.tenant_id=$1 AND o.id=e.order_id)
  WHEN 'RETURN' THEN (SELECT jsonb_build_object('amount',r.refund_amount::text,
    'financialSnapshot',CASE WHEN jsonb_typeof(r.financial_snapshot->'lines')='array'
      THEN CASE WHEN jsonb_array_length(r.financial_snapshot->'lines')<=1000 THEN r.financial_snapshot END END,
    'lines',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',ri.id::text,'qty',ri.qty::text,'amount',ri.refund_amount::text,
      'orderItemId',ri.order_item_id::text,
      'soldQty',i.qty::text,'cost',i.cost_amount_snapshot::text,'costSource',i.cost_snapshot_source,
      'cancellationCause',ri.cancellation_cause,
      'priorQty',(SELECT COALESCE(SUM(prev.qty),0)::text FROM bms_pos_return_items prev
        WHERE prev.tenant_id=ri.tenant_id AND prev.order_item_id=ri.order_item_id AND prev.id<ri.id)) ORDER BY ri.id),'[]'::jsonb)
      FROM (SELECT * FROM bms_pos_return_items WHERE tenant_id=$1 AND pos_return_id=r.id ORDER BY id LIMIT 1001) ri
      LEFT JOIN bms_order_items i ON i.tenant_id=ri.tenant_id AND i.id=ri.order_item_id AND i.order_id=r.order_id))
    FROM bms_pos_returns r WHERE r.tenant_id=$1 AND r.id=e.source_id::uuid)
  WHEN 'REFUND' THEN (SELECT jsonb_build_object('amount',a.amount::text,'method',a.method) FROM bms_pos_refund_allocations a WHERE a.tenant_id=$1 AND a.id=e.source_id::uuid)
  WHEN 'PAYMENT_REFUND' THEN (SELECT jsonb_build_object('amount',p.amount::text,'legacyDate',e.legacy_date) FROM bms_payments p WHERE p.tenant_id=$1 AND p.id=e.source_id::uuid)
  WHEN 'BACKOFFICE_RETURN' THEN (SELECT jsonb_build_object('amount',o.total_amount::text,'legacyDate',e.legacy_date) FROM bms_orders o WHERE o.tenant_id=$1 AND o.id=e.order_id)
  WHEN 'TAX_ADJUSTMENT' THEN (SELECT jsonb_build_object('amount',d.grand_total::text,'docType',d.doc_type) FROM bms_tax_documents d WHERE d.tenant_id=$1 AND d.id=e.source_id::uuid)
  END AS payload
FROM page e ORDER BY e.key COLLATE "C"`;

/** Internal shared source for P&L/menu readers. Consumer must be synchronous and side-effect-free.
 * Callers authorize report.view + tax.document.view; branch scope is repeated in the same snapshot.
 * No consumer/cursor/scope override is exposed through GraphQL.
 */
export async function scanSalesEvidence(tenantId: string, actorId: string, input: unknown,
  consume: (event: SalesEvidenceEvent) => unknown) {
  const filter = normalizeSalesEvidenceFilter(input);
  if (!tenantId || !actorId) throw new Error("SALES_EVIDENCE_FORBIDDEN");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { serializable: true });
    const result = await scanSalesEvidenceInTx(client, tenantId, actorId, filter, consume);
    await client.query("COMMIT");
    return result;
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(); }
}

/** Internal composition only: caller owns a serializable tenant transaction and source permissions. */
export async function scanSalesEvidenceInTx(client: PoolClient, tenantId: string, actorId: string, input: unknown,
  consume: (event: SalesEvidenceEvent) => unknown) {
    const filter = normalizeSalesEvidenceFilter(input);
    if (!tenantId || !actorId) throw new Error("SALES_EVIDENCE_FORBIDDEN");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const access = (await client.query<{ scoped: boolean; allowed: string[]; requested_exists: boolean; currency: string }>(
      `SELECT EXISTS (SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2) AS scoped,
        ARRAY(SELECT location_id::text FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2 ORDER BY location_id) AS allowed,
        ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM bms_locations WHERE tenant_id=$1 AND id=$3)) AS requested_exists,
        (SELECT currency FROM bms_store_profile WHERE tenant_id=$1) AS currency`,
      [tenantId, actorId, filter.locationId])).rows[0];
    if (!access || !access.requested_exists || (filter.locationId && access.scoped && !access.allowed.includes(filter.locationId))) throw new Error("SALES_EVIDENCE_FORBIDDEN");
    // These snapshots do not carry historical currency. Never silently combine another denomination.
    if (access.currency !== "THB") throw new Error("SALES_EVIDENCE_CURRENCY_REVIEW_REQUIRED");
    const locations = filter.locationId ? [filter.locationId] : access.scoped ? access.allowed : null;
    const observedAt = (await client.query<{ at: Date }>("SELECT transaction_timestamp() AS at")).rows[0].at.toISOString();
    let cursor = "", count = 0, truncated = false, limitCode = "EVENT_LIMIT";
    const started = Date.now();
    while (true) {
      if (Date.now() - started >= 30000) { truncated = true; limitCode = "SCAN_TIME_LIMIT"; break; }
      const remaining = SALES_EVIDENCE_EVENT_LIMIT - count;
      const limit = Math.min(SALES_EVIDENCE_PAGE_SIZE, remaining + 1);
      const rows = (await client.query<SalesEvidenceEvent>(EVENTS_SQL,
        [tenantId, filter.from, filter.to, locations, filter.channel, cursor, limit])).rows;
      if (rows.length > limit) throw new Error("SALES_EVIDENCE_INVALID_PAGE");
      for (const event of rows) {
        if (event.key <= cursor) throw new Error("SALES_EVIDENCE_INVALID_CURSOR");
        cursor = event.key;
        if (count === SALES_EVIDENCE_EVENT_LIMIT) { truncated = true; break; }
        const consumed = consume(event);
        if (consumed && typeof (consumed as { then?: unknown }).then === "function") {
          // A programming error must not also become an unhandled rejection after rollback.
          void Promise.resolve(consumed).catch(() => undefined);
          throw new Error("SALES_EVIDENCE_ASYNC_CONSUMER");
        }
        count++;
      }
      if (truncated || rows.length < limit) break;
    }
    return { ...filter, eventCount: count, truncated, limitCode, observedAt, basis: "EVENT_DATES_BANGKOK_V1",
      costBasis: "CATALOG_SNAPSHOT_NOT_PURCHASE_LOT", allocationBasis: "DERIVED_PROPORTIONAL_NOT_POSTED",
      refundBasis: "RETURNS_PAYMENTS_AND_CREDIT_REDUCTIONS_SEPARATE", diagnosticSampleLimit: 100,
      returnVatBasis: "SALE_BUCKET_CUMULATIVE_ALLOCATION_NOT_CREDIT_NOTE",
      currency: access.currency, currencyBasis: "CURRENT_STORE_NOT_HISTORICAL_SNAPSHOT" };
}

/** Read-only summary adapter; future menu readers consume the exact same scoped source stream. */
export async function getSalesEvidence(tenantId: string, actorId: string, input: unknown) {
  const accumulator = createSalesEvidenceAccumulator();
  const scan = await scanSalesEvidence(tenantId, actorId, input, accumulator.add);
  return { ...accumulator.finish(scan.truncated, scan.limitCode), ...scan };
}

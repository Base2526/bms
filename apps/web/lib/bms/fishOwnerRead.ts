import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { usableLotSql } from "./lotQuality";
import { FishOwnerError } from "./fishOwnerOperations";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function dayInput(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !ISO.test(value)) throw new FishOwnerError("INVALID_DATE", "วันที่ต้องเป็น YYYY-MM-DD");
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new FishOwnerError("INVALID_DATE", "วันที่ไม่มีอยู่จริง");
  return value;
}
const n = (v: unknown) => Number(v ?? 0);

/** One owner read, scoped to the actor's allowed branches. Rows are bounded; totals are separate unbounded aggregates. */
export async function getFishOwnerSnapshot(tenant: string, actor: string, requestedDay?: unknown) {
  const day = dayInput(requestedDay);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenant);
    const locations = (await client.query<{ id: string; name: string }>(
      `SELECT l.id,l.name FROM bms_locations l WHERE l.tenant_id=$1 AND l.active
       AND (NOT EXISTS (SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$2)
         OR EXISTS (SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$2 AND a.location_id=l.id))
       ORDER BY l.name`, [tenant, actor],
    )).rows;
    const ids = locations.map(x => x.id);
    const selectedDay = (await client.query<{ day: string }>(
      `SELECT COALESCE($1::date,(now() AT TIME ZONE 'Asia/Bangkok')::date)::text AS day`, [day],
    )).rows[0].day;

    const purchaseTotals = (await client.query<{
      line_count: number; bill_grams: string; received_grams: string; purchase_amount: string; extra_amount: string;
    }>(
      `SELECT COUNT(*)::int AS line_count,COALESCE(SUM(l.bill_grams),0)::text AS bill_grams,
              COALESCE(SUM(l.received_grams),0)::text AS received_grams,
              COALESCE(SUM(l.purchase_amount),0)::text AS purchase_amount,
              COALESCE(SUM(l.extra_amount),0)::text AS extra_amount
         FROM bms_fish_intake_lines l JOIN bms_fish_intakes h
           ON h.tenant_id=l.tenant_id AND h.id=l.intake_id
        WHERE l.tenant_id=$1 AND h.kind='LIVE' AND h.location_id=ANY($2::uuid[])
          AND l.received_date=$3::date`, [tenant, ids, selectedDay],
    )).rows[0];
    const purchases = (await client.query<any>(
      `SELECT l.id::text AS id,h.id::text AS intake_id,h.location_id::text AS location_id,
              l.supplier_name,l.vessel_registration,l.fish_name,l.sku,l.size,
              l.bill_grams,l.received_grams,l.unit_price_per_kg::text AS unit_price_per_kg,
              l.purchase_amount::text AS purchase_amount,l.extra_amount::text AS extra_amount,
              l.quality,l.lot_no,l.bill_date::text AS bill_date,l.received_date::text AS received_date
         FROM bms_fish_intake_lines l JOIN bms_fish_intakes h
           ON h.tenant_id=l.tenant_id AND h.id=l.intake_id
        WHERE l.tenant_id=$1 AND h.kind='LIVE' AND h.location_id=ANY($2::uuid[])
          AND l.received_date=$3::date
        ORDER BY h.created_at DESC,l.line_no LIMIT 501`, [tenant, ids, selectedDay],
    )).rows;
    const suppliers = (await client.query<any>(
      `SELECT l.supplier_name, l.sku,l.size,COUNT(*)::int AS line_count,
              SUM(l.received_grams)::text AS received_grams,
              SUM(l.bill_grams)::text AS bill_grams,
              SUM(l.purchase_amount)::text AS purchase_amount,
              CASE WHEN SUM(l.received_grams)>0
                THEN (SUM(l.purchase_amount)*1000/SUM(l.received_grams))::numeric(16,2)::text
                ELSE NULL END AS observed_baht_per_kg
         FROM bms_fish_intake_lines l JOIN bms_fish_intakes h
           ON h.tenant_id=l.tenant_id AND h.id=l.intake_id
        WHERE l.tenant_id=$1 AND h.kind='LIVE' AND h.location_id=ANY($2::uuid[])
          AND l.received_date=$3::date
        GROUP BY l.supplier_name,l.sku,l.size
        ORDER BY l.supplier_name,l.sku,l.size LIMIT 501`, [tenant, ids, selectedDay],
    )).rows;

    const stock = (await client.query<any>(
      `SELECT l.id::text AS lot_id,l.location_id::text AS location_id,
              l.product_sku AS sku,p.name,l.size,l.lot_no,l.qty AS qty_grams,
              l.expiry_date::text AS expiry_date,
              (${usableLotSql("l")} AND (l.expiry_date IS NULL OR l.expiry_date >= (now() AT TIME ZONE 'Asia/Bangkok')::date)) AS usable,
              c.id::text AS count_id,c.lot_qty_at_count,c.version,c.counted_at,
              (c.id IS NOT NULL AND c.lot_qty_at_count=l.qty AND c.lot_updated_at_count=l.updated_at) AS storage_current,
              COALESCE(z.ready_grams,0)::int AS ready_grams,
              COALESCE(z.cold_grams,0)::int AS cold_grams,
              COALESCE(z.other_grams,0)::int AS other_grams
         FROM bms_inventory_lots l
         JOIN bms_products p ON p.tenant_id=l.tenant_id AND p.sku=l.product_sku
         JOIN bms_product_stock_policies sp ON sp.tenant_id=l.tenant_id AND sp.product_sku=l.product_sku
         LEFT JOIN bms_fish_storage_counts c ON c.tenant_id=l.tenant_id AND c.lot_id=l.id
         LEFT JOIN LATERAL (
           SELECT SUM(qty_grams) FILTER(WHERE zone='READY') AS ready_grams,
                  SUM(qty_grams) FILTER(WHERE zone='COLD_ROOM') AS cold_grams,
                  SUM(qty_grams) FILTER(WHERE zone='OTHER') AS other_grams
             FROM bms_fish_storage_count_lines cl WHERE cl.tenant_id=l.tenant_id AND cl.count_id=c.id
         ) z ON true
        WHERE l.tenant_id=$1 AND l.location_id=ANY($2::uuid[]) AND l.qty>0
          AND sp.stock_policy='WEIGHTED' AND sp.base_unit='GRAM' AND sp.lot_tracking
        ORDER BY l.location_id,p.name,l.size,l.expiry_date NULLS LAST,l.lot_no LIMIT 501`, [tenant, ids],
    )).rows;
    const stockSummary = (await client.query<{ total_grams: string; lot_count: number; usable_grams: string }>(
      `SELECT COALESCE(SUM(l.qty),0)::text AS total_grams,COUNT(*)::int AS lot_count,
              COALESCE(SUM(l.qty) FILTER(WHERE ${usableLotSql("l")}
                AND (l.expiry_date IS NULL OR l.expiry_date >= (now() AT TIME ZONE 'Asia/Bangkok')::date)),0)::text AS usable_grams
         FROM bms_inventory_lots l JOIN bms_product_stock_policies sp
           ON sp.tenant_id=l.tenant_id AND sp.product_sku=l.product_sku
        WHERE l.tenant_id=$1 AND l.location_id=ANY($2::uuid[]) AND l.qty>0
          AND sp.stock_policy='WEIGHTED' AND sp.base_unit='GRAM' AND sp.lot_tracking`, [tenant, ids],
    )).rows[0];
    const production = (await client.query<any>(
      `SELECT p.location_id::text AS location_id,i.product_sku AS sku,i.size,
              SUM(i.qty)::text AS used_grams,COUNT(DISTINCT p.id)::int AS batch_count
         FROM bms_operation_production_inputs i
         JOIN bms_operation_production p ON p.tenant_id=i.tenant_id AND p.id=i.production_id
         JOIN bms_product_stock_policies sp ON sp.tenant_id=i.tenant_id AND sp.product_sku=i.product_sku
        WHERE i.tenant_id=$1 AND p.location_id=ANY($2::uuid[]) AND p.status='POSTED'
          AND (p.posted_at AT TIME ZONE 'Asia/Bangkok')::date=$3::date
          AND sp.stock_policy='WEIGHTED' AND sp.base_unit='GRAM' AND sp.lot_tracking
        GROUP BY p.location_id,i.product_sku,i.size ORDER BY used_grams DESC LIMIT 101`,
      [tenant, ids, selectedDay],
    )).rows;

    // Revenue authority is the frozen order line. COGS comes from the physical SHIP/RETURN
    // valuation entries, not the catalog cost snapshot; both are apportioned by source-lot grams.
    const profitRows = (await client.query<any>(
      `WITH sale AS (
         SELECT oi.product_sku AS sku,oi.size,o.customer_id,oil.lot_id,
                oil.qty::numeric AS grams,
                oi.line_amount*oil.qty::numeric/NULLIF(oi.qty,0) AS revenue,
                oi.line_amount*oil.qty::numeric/NULLIF(oi.qty,0) AS sale_revenue,
                CASE WHEN val.entries=1 AND val.amount IS NOT NULL
                     THEN val.amount*oil.qty::numeric/NULLIF(oi.qty,0) END AS cost
           FROM bms_order_items oi JOIN bms_orders o ON o.tenant_id=oi.tenant_id AND o.id=oi.order_id
           JOIN bms_order_item_lots oil ON oil.tenant_id=oi.tenant_id AND oil.order_item_id=oi.id
           JOIN bms_product_stock_policies sp ON sp.tenant_id=oi.tenant_id AND sp.product_sku=oi.product_sku
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS entries,SUM(v.amount) AS amount
               FROM bms_inventory_value_entries v
              WHERE v.tenant_id=oi.tenant_id AND v.order_item_id=oi.id
                AND v.product_sku=oi.product_sku AND v.size=oi.size AND v.kind='SHIP'
           ) val ON true
          WHERE oi.tenant_id=$1 AND o.location_id=ANY($2::uuid[])
            AND o.status IN ('SHIPPED','COMPLETED','RETURNED')
            AND (COALESCE(o.paid_at,o.created_at) AT TIME ZONE 'Asia/Bangkok')::date=$3::date
            AND sp.stock_policy='WEIGHTED' AND sp.base_unit='GRAM' AND sp.lot_tracking
       ), returned AS (
         SELECT oi.product_sku AS sku,oi.size,o.customer_id,ril.lot_id,
                -ril.qty::numeric AS grams,
                -ri.refund_amount*ril.qty::numeric/NULLIF(ri.qty,0) AS revenue,
                0::numeric AS sale_revenue,
                CASE WHEN val.entries=1 AND val.amount IS NOT NULL
                     THEN -val.amount*ril.qty::numeric/NULLIF(ri.qty,0) END AS cost
           FROM bms_pos_return_item_lots ril
           JOIN bms_pos_return_items ri ON ri.tenant_id=ril.tenant_id AND ri.id=ril.pos_return_item_id
           JOIN bms_pos_returns pr ON pr.tenant_id=ri.tenant_id AND pr.id=ri.pos_return_id
           JOIN bms_order_items oi ON oi.tenant_id=ri.tenant_id AND oi.id=ri.order_item_id
           JOIN bms_orders o ON o.tenant_id=oi.tenant_id AND o.id=oi.order_id
           JOIN bms_product_stock_policies sp ON sp.tenant_id=oi.tenant_id AND sp.product_sku=oi.product_sku
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS entries,SUM(v.amount) AS amount
               FROM bms_inventory_value_entries v
              WHERE v.tenant_id=ri.tenant_id AND v.return_id=pr.id AND v.order_item_id=ri.order_item_id
                AND v.product_sku=oi.product_sku AND v.size=oi.size AND v.kind='RETURN'
           ) val ON true
          WHERE ril.tenant_id=$1 AND o.location_id=ANY($2::uuid[])
            AND pr.is_void=FALSE
            AND (pr.created_at AT TIME ZONE 'Asia/Bangkok')::date=$3::date
            AND sp.stock_policy='WEIGHTED' AND sp.base_unit='GRAM' AND sp.lot_tracking
       ), web_returned AS (
         SELECT oi.product_sku AS sku,oi.size,o.customer_id,oil.lot_id,
                -oil.qty::numeric AS grams,
                -oi.line_amount*oil.qty::numeric/NULLIF(oi.qty,0) AS revenue,
                0::numeric AS sale_revenue,
                CASE WHEN val.entries=1 AND val.amount IS NOT NULL
                     THEN -val.amount*oil.qty::numeric/NULLIF(oi.qty,0) END AS cost
           FROM bms_order_items oi JOIN bms_orders o ON o.tenant_id=oi.tenant_id AND o.id=oi.order_id
           JOIN bms_order_item_lots oil ON oil.tenant_id=oi.tenant_id AND oil.order_item_id=oi.id
           JOIN bms_product_stock_policies sp ON sp.tenant_id=oi.tenant_id AND sp.product_sku=oi.product_sku
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS entries,SUM(v.amount) AS amount
               FROM bms_inventory_value_entries v
              WHERE v.tenant_id=oi.tenant_id AND v.order_item_id=oi.id
                AND v.product_sku=oi.product_sku AND v.size=oi.size AND v.kind='RETURN'
           ) val ON true
          WHERE oi.tenant_id=$1 AND o.location_id=ANY($2::uuid[]) AND o.status='RETURNED'
            AND (COALESCE(o.returned_at,o.updated_at) AT TIME ZONE 'Asia/Bangkok')::date=$3::date
            AND sp.stock_policy='WEIGHTED' AND sp.base_unit='GRAM' AND sp.lot_tracking
            AND NOT EXISTS (SELECT 1 FROM bms_pos_returns pr WHERE pr.tenant_id=o.tenant_id AND pr.order_id=o.id AND pr.is_void=FALSE)
       ), events AS (SELECT * FROM sale UNION ALL SELECT * FROM returned UNION ALL SELECT * FROM web_returned)
       SELECT e.sku,e.size,e.customer_id::text AS customer_id,c.name AS customer_name,
              e.lot_id::text AS lot_id,l.lot_no,
              SUM(e.grams)::text AS grams,SUM(e.revenue)::text AS revenue,
              SUM(e.sale_revenue)::text AS sale_revenue,
              CASE WHEN COUNT(*) FILTER(WHERE e.cost IS NULL)=0 THEN SUM(e.cost)::text ELSE NULL END AS cost,
              COUNT(*) FILTER(WHERE e.cost IS NULL)::int AS missing_cost_events
         FROM events e
         LEFT JOIN bms_customers c ON c.tenant_id=$1 AND c.id=e.customer_id
         JOIN bms_inventory_lots l ON l.tenant_id=$1 AND l.id=e.lot_id
        GROUP BY e.sku,e.size,e.customer_id,c.name,e.lot_id,l.lot_no
        ORDER BY SUM(e.revenue) DESC LIMIT 501`, [tenant, ids, selectedDay],
    )).rows;
    const missingLotCount = (await client.query<{ missing: number }>(
      `WITH missing_sale AS (
         SELECT oi.id FROM bms_order_items oi
         JOIN bms_orders o ON o.tenant_id=oi.tenant_id AND o.id=oi.order_id
         JOIN bms_product_stock_policies sp ON sp.tenant_id=oi.tenant_id AND sp.product_sku=oi.product_sku
        WHERE oi.tenant_id=$1 AND o.location_id=ANY($2::uuid[])
          AND o.status IN ('SHIPPED','COMPLETED','RETURNED')
          AND (COALESCE(o.paid_at,o.created_at) AT TIME ZONE 'Asia/Bangkok')::date=$3::date
          AND sp.stock_policy='WEIGHTED' AND sp.base_unit='GRAM' AND sp.lot_tracking
          AND NOT EXISTS (SELECT 1 FROM bms_order_item_lots oil WHERE oil.tenant_id=oi.tenant_id AND oil.order_item_id=oi.id)
       ), missing_return AS (
         SELECT ri.id FROM bms_pos_return_items ri
         JOIN bms_pos_returns pr ON pr.tenant_id=ri.tenant_id AND pr.id=ri.pos_return_id
         JOIN bms_order_items oi ON oi.tenant_id=ri.tenant_id AND oi.id=ri.order_item_id
         JOIN bms_orders o ON o.tenant_id=oi.tenant_id AND o.id=oi.order_id
         JOIN bms_product_stock_policies sp ON sp.tenant_id=oi.tenant_id AND sp.product_sku=oi.product_sku
        WHERE ri.tenant_id=$1 AND o.location_id=ANY($2::uuid[])
          AND pr.is_void=FALSE
          AND (pr.created_at AT TIME ZONE 'Asia/Bangkok')::date=$3::date
          AND sp.stock_policy='WEIGHTED' AND sp.base_unit='GRAM' AND sp.lot_tracking
          AND NOT EXISTS (SELECT 1 FROM bms_pos_return_item_lots ril WHERE ril.tenant_id=ri.tenant_id AND ril.pos_return_item_id=ri.id)
       ), missing_web_return AS (
         SELECT oi.id FROM bms_order_items oi
         JOIN bms_orders o ON o.tenant_id=oi.tenant_id AND o.id=oi.order_id
         JOIN bms_product_stock_policies sp ON sp.tenant_id=oi.tenant_id AND sp.product_sku=oi.product_sku
        WHERE oi.tenant_id=$1 AND o.location_id=ANY($2::uuid[]) AND o.status='RETURNED'
          AND (COALESCE(o.returned_at,o.updated_at) AT TIME ZONE 'Asia/Bangkok')::date=$3::date
          AND sp.stock_policy='WEIGHTED' AND sp.base_unit='GRAM' AND sp.lot_tracking
          AND NOT EXISTS (SELECT 1 FROM bms_pos_returns pr WHERE pr.tenant_id=o.tenant_id AND pr.order_id=o.id AND pr.is_void=FALSE)
          AND NOT EXISTS (SELECT 1 FROM bms_order_item_lots oil WHERE oil.tenant_id=oi.tenant_id AND oil.order_item_id=oi.id)
       )
       SELECT ((SELECT COUNT(*) FROM missing_sale)+(SELECT COUNT(*) FROM missing_return)
         +(SELECT COUNT(*) FROM missing_web_return))::int AS missing`,
      [tenant, ids, selectedDay],
    )).rows[0].missing;

    const plans = (await client.query<any>(
      `SELECT p.id::text AS id,p.location_id::text AS location_id,p.customer_id::text AS customer_id,
              c.name AS customer_name,p.due_on::text AS due_on,p.note,p.created_at
         FROM bms_fish_delivery_plans p JOIN bms_customers c ON c.tenant_id=p.tenant_id AND c.id=p.customer_id
        WHERE p.tenant_id=$1 AND p.location_id=ANY($2::uuid[])
        ORDER BY p.created_at DESC LIMIT 101`, [tenant, ids],
    )).rows;
    const planIds = plans.slice(0, 100).map(x => x.id);
    const planLines = (await client.query<any>(
      `SELECT plan_id::text AS plan_id,sku,size,agreed_grams
         FROM bms_fish_delivery_plan_lines WHERE tenant_id=$1 AND plan_id=ANY($2::uuid[])`,
      [tenant, planIds],
    )).rows;
    const linkedOrders = (await client.query<any>(
      `SELECT link.plan_id::text AS plan_id,o.id::text AS order_id,o.status,
              oi.product_sku AS sku,oi.size,SUM(oi.qty)::int AS qty_grams,
              SUM(LEAST(oi.qty,ret.qty))::int AS returned_grams,
              COALESCE(ar.due,0)::text AS ar_due,
              CASE WHEN o.status='PENDING' THEN GREATEST(o.total_amount-COALESCE(pay.confirmed,0),0)::text
                   ELSE '0' END AS pending_payment
         FROM bms_fish_delivery_plan_orders link
         JOIN bms_orders o ON o.tenant_id=link.tenant_id AND o.id=link.order_id
         JOIN bms_order_items oi ON oi.tenant_id=o.tenant_id AND oi.order_id=o.id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(ri.qty),0)::int AS qty
             FROM bms_pos_return_items ri JOIN bms_pos_returns pr
               ON pr.tenant_id=ri.tenant_id AND pr.id=ri.pos_return_id
            WHERE ri.tenant_id=oi.tenant_id AND ri.order_item_id=oi.id AND pr.is_void=FALSE
         ) ret ON true
         LEFT JOIN LATERAL (
           SELECT SUM(GREATEST(i.amount-i.credited_amount-i.settled_amount,0)) AS due
             FROM bms_ar_invoices i WHERE i.tenant_id=o.tenant_id AND i.order_id=o.id
               AND i.status IN ('OPEN','PARTIAL')
         ) ar ON true
         LEFT JOIN LATERAL (
           SELECT SUM(p.amount) AS confirmed FROM bms_payments p
            WHERE p.tenant_id=o.tenant_id AND p.order_id=o.id AND p.status='CONFIRMED'
         ) pay ON true
        WHERE link.tenant_id=$1 AND link.plan_id=ANY($2::uuid[])
        GROUP BY link.plan_id,o.id,o.status,oi.product_sku,oi.size,ar.due,pay.confirmed`,
      [tenant, planIds],
    )).rows;
    await client.query("COMMIT");

    type PlanLine = { sku: string; size: string; agreedGrams: number };
    type PlanOrder = { orderId: string; status: string; sku: string; size: string; qtyGrams: number; returnedGrams: number; arDue: number; pendingPayment: number };
    type PlanRow = { id: string; location_id: string; customer_id: string; customer_name: string;
      due_on: string | null; note: string | null; created_at: string; lines: PlanLine[]; orders: PlanOrder[] };
    const planById = new Map<string, PlanRow>();
    for (const row of plans.slice(0, 100)) planById.set(row.id, { ...row, lines: [], orders: [] });
    for (const row of planLines) planById.get(row.plan_id)?.lines.push({ sku: row.sku, size: row.size, agreedGrams: n(row.agreed_grams) });
    for (const row of linkedOrders) planById.get(row.plan_id)?.orders.push({ orderId: row.order_id, status: row.status,
      sku: row.sku, size: row.size, qtyGrams: n(row.qty_grams), returnedGrams:n(row.returned_grams),
      arDue: n(row.ar_due), pendingPayment:n(row.pending_payment) });
    const deliveryPlans = [...planById.values()].map(plan => ({ ...plan,
      lines: plan.lines.map(line => {
        const linked = plan.orders.filter(order => order.sku === line.sku && order.size === line.size && !["CANCELLED","RETURNED"].includes(order.status));
        const orderedGrams = linked.reduce((sum, row) => sum + Math.max(row.qtyGrams-row.returnedGrams,0), 0);
        const shippedGrams = linked.filter(row => ["SHIPPED","COMPLETED"].includes(row.status))
          .reduce((sum, row) => sum + Math.max(row.qtyGrams-row.returnedGrams,0), 0);
        return { ...line, orderedGrams, shippedGrams, remainingGrams: Math.max(line.agreedGrams-shippedGrams,0) };
      }),
      arDue: [...new Map(plan.orders.map(row => [row.orderId, row.arDue])).values()].reduce((sum, due) => sum + due, 0),
      pendingPayment: [...new Map(plan.orders.map(row => [row.orderId, row.pendingPayment])).values()].reduce((sum, due) => sum + due, 0),
    }));
    return {
      day: selectedDay, locations,
      purchases: { totals: { lineCount: n(purchaseTotals.line_count),billGrams:n(purchaseTotals.bill_grams),
        receivedGrams:n(purchaseTotals.received_grams),purchaseAmount:n(purchaseTotals.purchase_amount),extraAmount:n(purchaseTotals.extra_amount) },
        rows:purchases.slice(0,500),truncated:purchases.length>500,suppliers:suppliers.slice(0,500),suppliersTruncated:suppliers.length>500 },
      stock: { totalGrams:n(stockSummary.total_grams),usableGrams:n(stockSummary.usable_grams),lotCount:n(stockSummary.lot_count),
        rows:stock.slice(0,500).map(row => ({ ...row, qty_grams:n(row.qty_grams),ready_grams:n(row.ready_grams),
          cold_grams:n(row.cold_grams),other_grams:n(row.other_grams),lot_qty_at_count:row.lot_qty_at_count == null ? null : n(row.lot_qty_at_count),
          storageCurrent:row.storage_current === true })),truncated:stock.length>500 },
      production, profit: { rows:profitRows.slice(0,500).map(row => ({ ...row,grams:n(row.grams),revenue:n(row.revenue),
        saleRevenue:n(row.sale_revenue),
        cost:row.cost == null?null:n(row.cost),profit:row.cost == null?null:n(row.revenue)-n(row.cost) })),
        truncated:profitRows.length>500,missingLotCount,
        missingCostEvents:profitRows.slice(0,500).reduce((sum,row)=>sum+n(row.missing_cost_events),0) },
      deliveries: { plans:deliveryPlans,truncated:plans.length>100 },
    };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Server-backed selectors; the owner page never filters an incomplete customer/order list in the browser. */
export async function getFishOwnerOptions(tenant: string, actor: string, rawSearch: unknown) {
  if (typeof rawSearch !== "string" || rawSearch.length > 100)
    throw new FishOwnerError("INVALID_SEARCH", "คำค้นยาวเกินไป");
  const search = rawSearch.trim();
  const client = await getClient();
  try {
    await beginTenantTx(client, tenant);
    const locations = (await client.query<{ id: string; name: string }>(
      `SELECT l.id,l.name FROM bms_locations l WHERE l.tenant_id=$1 AND l.active
       AND (NOT EXISTS (SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$2)
         OR EXISTS (SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$2 AND a.location_id=l.id))
       ORDER BY l.name`, [tenant, actor],
    )).rows;
    const ids = locations.map(x => x.id);
    const customers = (await client.query<{ id: string; name: string }>(
      `SELECT id::text,name FROM bms_customers WHERE tenant_id=$1 AND deleted_at IS NULL
       AND ($2='' OR name ILIKE '%'||$2||'%' OR id::text ILIKE $2||'%')
       ORDER BY name,id LIMIT 51`, [tenant, search],
    )).rows;
    const products = (await client.query<{ sku: string; name: string; size: string }>(
      `SELECT p.sku,p.name,v.code AS size FROM bms_products p
       JOIN bms_product_stock_policies sp ON sp.tenant_id=p.tenant_id AND sp.product_sku=p.sku
       JOIN bms_product_variants v ON v.tenant_id=p.tenant_id AND v.product_sku=p.sku AND v.active
       WHERE p.tenant_id=$1 AND p.active AND sp.stock_policy='WEIGHTED' AND sp.base_unit='GRAM' AND sp.lot_tracking
         AND ($2='' OR p.name ILIKE '%'||$2||'%' OR p.sku ILIKE '%'||$2||'%')
       ORDER BY p.name,v.code LIMIT 51`, [tenant, search],
    )).rows;
    const orders = (await client.query<{ id: string; status: string; location_id: string; customer_id: string; customer_name: string }>(
      `SELECT o.id::text,o.status,o.location_id::text,o.customer_id::text,c.name AS customer_name
         FROM bms_orders o JOIN bms_customers c ON c.tenant_id=o.tenant_id AND c.id=o.customer_id
        WHERE o.tenant_id=$1 AND o.location_id=ANY($2::uuid[])
          AND o.status NOT IN ('CANCELLED','RETURNED')
          AND ($3='' OR o.id::text ILIKE $3||'%' OR c.name ILIKE '%'||$3||'%')
        ORDER BY o.created_at DESC LIMIT 51`, [tenant, ids, search],
    )).rows;
    await client.query("COMMIT");
    return { locations, customers:customers.slice(0,50),products:products.slice(0,50),orders:orders.slice(0,50),
      truncated:customers.length>50 || products.length>50 || orders.length>50 };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

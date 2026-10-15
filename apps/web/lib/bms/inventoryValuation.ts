import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export type ValuationMovement = {
  tenantId: string; locationId: string; sku: string; size: string; type: string; qty: number;
  direction?: string | null; refOrderId?: string | null;
  orderItemId?: string | number | null; returnId?: string | null;
  transferItemId?: string | number | null; purchaseItemId?: string | number | null;
  initialQty?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const micro = (v: string) => {
  if (!/^\d{1,18}(?:\.\d{1,6})?$/.test(v)) throw new Error("VALUATION_INVALID_AMOUNT");
  const [a,b=""] = v.split("."); return BigInt(a)*1000000n+BigInt(b.padEnd(6,"0"));
};
const decimal = (v: bigint) => `${v/1000000n}.${String(v%1000000n).padStart(6,"0")}`;
const portion = (value: bigint, qty: bigint, total: bigint) => (value*qty*2n+total)/(2n*total);

/** Called only after the physical movement, inside its tenant transaction. */
export async function valueMovementInTx(client: PoolClient, movementId: string, m: ValuationMovement) {
  if (["RESERVE","RELEASE"].includes(m.type)) return;
  const q = BigInt(m.qty);
  if (q <= 0n) throw new Error("VALUATION_INVALID_QUANTITY");
  const inbound = ["STOCK_IN","RETURN","TRANSFER_IN"].includes(m.type) || (m.type === "COUNT_ADJUST" && m.direction === "IN");
  const transit = ["QUARANTINE_IN","TRANSFER_LOST"].includes(m.type);
  const scope = [m.tenantId,m.locationId,m.sku,m.size];
  let amount: bigint | null = null;
  // A return carries the original consumed value, never today's average/catalog price.
  // Cumulative allocation conserves the last micro-baht on partial returns/transfers.
  if ((m.type === "RETURN" && m.orderItemId != null) || (m.transferItemId != null && m.type !== "TRANSFER_OUT")) {
    const isReturn = m.type === "RETURN";
    const source = (await client.query<{qty:string;amount:string|null;used:string}>(`
      SELECT COALESCE(SUM(qty) FILTER (WHERE kind=$5),0)::text AS qty,
        CASE WHEN bool_and(amount IS NOT NULL) FILTER (WHERE kind=$5)
          THEN SUM(amount) FILTER (WHERE kind=$5) END::text AS amount,
        COALESCE(SUM(qty) FILTER (WHERE kind<>$5),0)::text AS used
      FROM bms_inventory_value_entries WHERE tenant_id=$1 AND product_sku=$2 AND size=$3
        AND ${isReturn ? "order_item_id=$4::bigint AND kind IN ('SHIP','RETURN')" : "transfer_item_id=$4::bigint"}`,
    [m.tenantId,m.sku,m.size,isReturn ? m.orderItemId : m.transferItemId,isReturn ? "SHIP" : "TRANSFER_OUT"])).rows[0];
    const total = BigInt(source.qty), used = BigInt(source.used);
    if (total > 0n && used+q <= total && source.amount != null)
      amount = portion(micro(source.amount),used+q,total)-portion(micro(source.amount),used,total);
  } else if (m.type === "STOCK_IN" && m.purchaseItemId != null) {
    const source = (await client.query<{cost:string}>(`SELECT (i.unit_cost*$3)::text AS cost
      FROM bms_purchase_order_items i JOIN bms_purchase_orders p ON p.id=i.po_id AND p.tenant_id=i.tenant_id
      WHERE i.tenant_id=$1 AND i.id=$2 AND i.product_sku=$4 AND i.size=$5`,
    [m.tenantId,m.purchaseItemId,m.qty,m.sku,m.size])).rows[0];
    if (!source) throw new Error("VALUATION_PURCHASE_SOURCE_MISSING");
    amount = micro(source.cost);
  }
  if (!transit) {
    const inventory = (await client.query<{qty:string}>(`SELECT current_stock::text AS qty FROM bms_inventory
      WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 FOR UPDATE`,scope)).rows[0];
    if (!inventory) throw new Error("VALUATION_INVENTORY_MISSING");
    const initial = m.initialQty != null ? BigInt(m.initialQty) : BigInt(inventory.qty)+(inbound ? -q : q);
    if (initial < 0n) throw new Error("VALUATION_NEGATIVE_OPENING");
    await client.query(`INSERT INTO bms_inventory_values(tenant_id,location_id,product_sku,size,qty,value)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[...scope,String(initial),initial===0n ? "0" : null]);
    const balance = (await client.query<{qty:string;value:string|null}>(`SELECT qty::text,value::text FROM bms_inventory_values
      WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 FOR UPDATE`,scope)).rows[0];
    const prior = BigInt(balance.qty), value = balance.value == null ? null : micro(balance.value);
    if (inbound && m.type === "COUNT_ADJUST" && value != null && prior > 0n) amount = portion(value,q,prior);
    if (!inbound) {
      if (prior < q) throw new Error("VALUATION_QUANTITY_MISMATCH");
      amount = value == null ? null : portion(value,q,prior);
    }
    const nextQty = prior+(inbound ? q : -q);
    const nextValue = nextQty===0n ? 0n : value==null || amount==null ? null : value+(inbound ? amount : -amount);
    await client.query(`UPDATE bms_inventory_values SET qty=$5,value=$6,version=version+1
      WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4`,
    [...scope,String(nextQty),nextValue==null ? null : decimal(nextValue)]);
  }
  await client.query(`INSERT INTO bms_inventory_value_entries
    (tenant_id,movement_id,location_id,product_sku,size,kind,qty,amount,order_id,order_item_id,return_id,transfer_item_id,purchase_item_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
  [m.tenantId,movementId,m.locationId,m.sku,m.size,m.type==='COUNT_ADJUST' ? `COUNT_${m.direction}` : m.type,
    m.qty,amount==null ? null : decimal(amount),m.refOrderId??null,m.orderItemId??null,m.returnId??null,m.transferItemId??null,m.purchaseItemId??null]);
}

export async function assertValuationLocation(client: PoolClient, tenant: string, actor: string, location: string) {
  const r = (await client.query(`SELECT EXISTS(SELECT 1 FROM bms_locations WHERE tenant_id=$1 AND id=$3) AND
    (NOT EXISTS(SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2) OR
    EXISTS(SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2 AND location_id=$3)) AS ok,
    (SELECT currency FROM bms_store_profile WHERE tenant_id=$1) AS currency`,[tenant,actor,location])).rows[0];
  if (!r?.ok) throw new Error("VALUATION_FORBIDDEN");
  if (r.currency!=="THB") throw new Error("VALUATION_CURRENCY_REVIEW_REQUIRED");
}

export async function inventoryValuation(tenant: string, actor: string, location: string, paging: {search?: string | null; offset?: number | null; limit?: number | null} = {}) {
  const search = (paging.search ?? "").trim(), offset = paging.offset ?? 0, limit = paging.limit ?? 1000;
  if (search.length > 120 || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000000
    || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("VALUATION_INVALID_PAGE");
  if (!uuid.test(location)) throw new Error("VALUATION_INVALID_LOCATION");
  const client = await getClient();
  try {
    await beginTenantTx(client,tenant);
    await assertValuationLocation(client,tenant,actor,location);
    const rows = (await client.query(`SELECT i.product_sku AS sku,i.size,i.current_stock::text AS qty,
      v.value::text AS value,CASE WHEN v.qty>0 THEN round(v.value/v.qty,6)::text END AS "unitCost",
      COALESCE(v.version,0)::text AS version, count(*) OVER()::int AS total
      FROM bms_inventory i LEFT JOIN bms_inventory_values v USING(tenant_id,location_id,product_sku,size)
      WHERE i.tenant_id=$1 AND i.location_id=$2
        AND ($3='' OR position(lower($3) in lower(i.product_sku))>0 OR position(lower($3) in lower(i.size))>0)
      ORDER BY i.product_sku,i.size LIMIT $4 OFFSET $5`,[tenant,location,search,limit,offset])).rows;
    await client.query("COMMIT");
    return {rows, total: rows[0]?.total ?? 0, offset, limit, truncated: offset + rows.length < (rows[0]?.total ?? 0)};
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}

/** Explicitly reviewed opening only; never rewrites a historical movement or a known balance. */
export async function confirmInventoryValue(tenant: string, actor: string, input: {
  locationId:string; sku:string; size:string; qty:string; value:string; version:string;
  evidence:string; requestId:string; confirmed:boolean;
}) {
  if (input.confirmed!==true || !uuid.test(input.locationId) || !uuid.test(input.requestId)
    || !/^\d{1,10}$/.test(input.qty) || !/^\d{1,18}$/.test(input.version)
    || !input.sku || !input.size || !input.evidence?.trim() || input.evidence.length>1000) throw new Error("VALUATION_REVIEW_REQUIRED");
  const value = micro(input.value);
  if (BigInt(input.qty)===0n && value!==0n) throw new Error("VALUATION_INVALID_AMOUNT");
  const hash = createHash("sha256").update(JSON.stringify([input.locationId,input.sku,input.size,input.qty,decimal(value),input.version,input.evidence])).digest("hex");
  const client = await getClient();
  try {
    await beginTenantTx(client,tenant,{editorId:actor});
    await assertValuationLocation(client,tenant,actor,input.locationId);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1067))",[`${tenant}:${input.requestId}`]);
    const prior = (await client.query("SELECT request_hash FROM bms_inventory_value_openings WHERE tenant_id=$1 AND request_id=$2",[tenant,input.requestId])).rows[0];
    if (prior) {
      if (prior.request_hash!==hash) throw new Error("VALUATION_IDEMPOTENCY_CONFLICT");
      await client.query("COMMIT"); return {status:"SAVED"};
    }
    const scope = [tenant,input.locationId,input.sku,input.size];
    const inventory = (await client.query("SELECT current_stock::text AS qty FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 FOR UPDATE",scope)).rows[0];
    const balance = (await client.query("SELECT value::text,version::text FROM bms_inventory_values WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 FOR UPDATE",scope)).rows[0];
    if (!inventory || inventory.qty!==input.qty || (balance?.version??"0")!==input.version || balance?.value!=null) throw new Error("VALUATION_STALE_REVIEW");
    await client.query(`INSERT INTO bms_inventory_values(tenant_id,location_id,product_sku,size,qty,value)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,location_id,product_sku,size)
      DO UPDATE SET qty=EXCLUDED.qty,value=EXCLUDED.value,version=bms_inventory_values.version+1`,[...scope,input.qty,decimal(value)]);
    await client.query(`INSERT INTO bms_inventory_value_openings(tenant_id,request_id,request_hash,location_id,product_sku,size,qty,value,evidence,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[tenant,input.requestId,hash,input.locationId,input.sku,input.size,input.qty,decimal(value),input.evidence.trim(),actor]);
    await client.query(`INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,'inventory.value_opening',$3,$4::jsonb)`,
      [tenant,`user:${actor}`,input.requestId,JSON.stringify({locationId:input.locationId,sku:input.sku,size:input.size,qty:input.qty,value:decimal(value)})]);
    await client.query("COMMIT"); return {status:"SAVED"};
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}

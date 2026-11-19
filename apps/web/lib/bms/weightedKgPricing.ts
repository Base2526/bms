import { createHash } from "crypto";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { insertAuditInTx } from "./audit";

export type WeightedKgRate = {
  sku: string; size: string; revisionNo: number; rateCents: string; basisGrams: 1000;
};

/** Integer satang calculation, half up only once per sold line. */
export function weightedKgLineCents(rateCents: string | bigint, grams: number): bigint {
  if (!Number.isSafeInteger(grams) || grams < 1 || grams > 2_147_483_647) throw new Error("WEIGHTED_INVALID_GRAMS");
  const rate = BigInt(rateCents);
  if (rate < 1n || rate > 99_999_999_999n) throw new Error("WEIGHTED_INVALID_RATE");
  return (rate * BigInt(grams) + 500n) / 1000n;
}

export function weightedKgMoney(cents: bigint): number {
  if (cents < 0n || cents > 999_999_999_999n) throw new Error("WEIGHTED_AMOUNT_OUT_OF_RANGE");
  return Number(cents) / 100;
}

/** Rate input is a decimal string, never a binary floating-point value. */
export function parseWeightedKgRate(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(value)) return null;
  const [whole, fraction] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction);
  return cents > 0n && cents <= 99_999_999_999n ? cents : null;
}

export async function currentWeightedKgRate(
  reader: { query: typeof query }, tenantId: string, sku: string, size: string,
  lock = false
): Promise<WeightedKgRate | null> {
  // Publication locks the same product FOR UPDATE before changing current rows.
  // Locking it here avoids a READ COMMITTED gap where the old row no longer
  // matches is_current but the replacement was invisible to this statement.
  if (lock) await reader.query(`SELECT 1 FROM bms_products WHERE tenant_id=$1 AND sku=$2 FOR SHARE`,
    [tenantId,sku]);
  const row = await reader.query<{ revision_no: number; rate_cents: string }>(
    `SELECT revision_no,rate_cents::text FROM bms_weighted_kg_prices
      WHERE tenant_id=$1 AND product_sku=$2 AND size=$3 AND is_current${lock ? " FOR SHARE" : ""}`,
    [tenantId, sku, size]
  );
  return row.rows[0] ? { sku, size, revisionNo: Number(row.rows[0].revision_no),
    rateCents: row.rows[0].rate_cents, basisGrams: 1000 } : null;
}

/** Keep the retail-only published rate from leaking a rounded shelf price to public channels. */
export async function assertWeightedKgSalesSurfacesSupportedInTx(
  reader: {query: typeof query}, tenantId: string, sku: string, surfaces: readonly string[]
): Promise<void> {
  if (!surfaces.some((surface) => surface !== "RETAIL_POS")) return;
  const current = await reader.query(`SELECT 1 FROM bms_weighted_kg_prices
    WHERE tenant_id=$1 AND product_sku=$2 AND is_current LIMIT 1`,[tenantId,sku]);
  if (current.rowCount) throw new Error("WEIGHTED_KG_ONLINE_SURFACE_NOT_SUPPORTED");
}

export async function publishWeightedKgRate(
  tenantId: string, actorId: string, input: {
    sku: string; size: string; rateBahtPerKg: string; requestKey: string; confirmed: boolean;
  }
): Promise<{ status: string; revisionNo?: number; rateBahtPerKg?: string }> {
  const rate = parseWeightedKgRate(input?.rateBahtPerKg);
  if (!input?.confirmed || !rate || !input.sku?.trim() || !input.size?.trim()
    || !input.requestKey || input.requestKey.length < 8 || input.requestKey.length > 200) {
    return { status: "INVALID_INPUT" };
  }
  const sku = input.sku.trim();
  const size = input.size.trim();
  const hash = createHash("sha256").update(JSON.stringify([sku,size,rate.toString()])).digest("hex");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    const replay = await client.query<{request_hash:string;revision_no:number;rate_cents:string}>(
      `SELECT request_hash,revision_no,rate_cents::text FROM bms_weighted_kg_prices
        WHERE tenant_id=$1 AND request_key=$2`, [tenantId,input.requestKey]);
    if (replay.rowCount) {
      await client.query("COMMIT");
      return replay.rows[0].request_hash === hash
        ? { status: "PUBLISHED", revisionNo: Number(replay.rows[0].revision_no),
            rateBahtPerKg: (Number(replay.rows[0].rate_cents)/100).toFixed(2) }
        : { status: "IDEMPOTENCY_CONFLICT" };
    }
    // Lock product before variant/rate. Concurrent publications serialize here.
    const product = await client.query<{base_unit:string}>(
      `SELECT sp.base_unit FROM bms_products p JOIN bms_product_stock_policies sp
        ON sp.tenant_id=p.tenant_id AND sp.product_sku=p.sku
        JOIN bms_product_variants v ON v.tenant_id=p.tenant_id AND v.product_sku=p.sku
          AND v.code=$3 AND v.active
        WHERE p.tenant_id=$1 AND p.sku=$2 AND p.active
          AND sp.stock_policy='WEIGHTED' AND sp.base_unit='GRAM'
          AND sp.scale_item_code IS NOT NULL AND sp.scale_size=$3
        FOR UPDATE OF p`, [tenantId,sku,size]);
    if (!product.rowCount) { await client.query("ROLLBACK"); return {status:"PRODUCT_NOT_WEIGHTED_GRAM"}; }
    const online = await client.query(`SELECT 1 FROM bms_product_sales_surfaces
      WHERE tenant_id=$1 AND product_sku=$2 AND surface IN
        ('ONLINE_ORDER','PUBLIC_STOREFRONT','CUSTOMER_AI','RESTAURANT_POS') AND enabled LIMIT 1`,[tenantId,sku]);
    if (online.rowCount) {await client.query("ROLLBACK");return {status:"ONLINE_SURFACE_NOT_SUPPORTED"};}
    const actor = await client.query(`SELECT 1 FROM users WHERE id=$1 AND tenant_id=$2`,[actorId,tenantId]);
    if (!actor.rowCount) { await client.query("ROLLBACK"); return {status:"ACTOR_NOT_IN_TENANT"}; }
    // Repeat after acquiring the product lock so a concurrent request key replays.
    const again = await client.query<{request_hash:string;revision_no:number;rate_cents:string}>(
      `SELECT request_hash,revision_no,rate_cents::text FROM bms_weighted_kg_prices
        WHERE tenant_id=$1 AND request_key=$2`,[tenantId,input.requestKey]);
    if (again.rowCount) {
      await client.query("COMMIT");
      return again.rows[0].request_hash === hash
        ? {status:"PUBLISHED",revisionNo:Number(again.rows[0].revision_no),
            rateBahtPerKg:(Number(again.rows[0].rate_cents)/100).toFixed(2)}
        : {status:"IDEMPOTENCY_CONFLICT"};
    }
    const latest = await client.query<{next_no:number}>(
      `SELECT COALESCE(MAX(revision_no),0)+1 AS next_no FROM bms_weighted_kg_prices
        WHERE tenant_id=$1 AND product_sku=$2 AND size=$3`,[tenantId,sku,size]);
    const revisionNo = Number(latest.rows[0].next_no);
    await client.query(`UPDATE bms_weighted_kg_prices SET is_current=false
      WHERE tenant_id=$1 AND product_sku=$2 AND size=$3 AND is_current`,[tenantId,sku,size]);
    await client.query(`INSERT INTO bms_weighted_kg_prices
      (tenant_id,product_sku,size,revision_no,rate_cents,request_key,request_hash,published_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId,sku,size,revisionNo,rate.toString(),input.requestKey,hash,actorId]);
    await insertAuditInTx(client,{tenantId,actor:actorId,actorKind:"STAFF",actorUserId:actorId,
      action:"product.weighted_kg_price_published",target:sku,
      meta:{size,revisionNo,rateCents:rate.toString(),basisGrams:1000},
      eventKey:`weighted-price:${input.requestKey}`});
    await client.query("COMMIT");
    return {status:"PUBLISHED",revisionNo,rateBahtPerKg:input.rateBahtPerKg};
  } catch(error) {
    await client.query("ROLLBACK");
    if ((error as {code?:string})?.code === "23505") return {status:"IDEMPOTENCY_CONFLICT"};
    throw error;
  }
  finally { client.release(); }
}

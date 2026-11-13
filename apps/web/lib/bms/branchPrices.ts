import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { assertValuationLocation } from "./inventoryValuation";
import { beginTenantTx } from "./tenant";

type Reader = {query: typeof query};
/** A missing branch override inherits the shared catalog. Zero is a valid explicit price. */
export async function branchPrice(client:Reader,tenant:string,location:string|null|undefined,sku:string,size:string,packCode="BASE"):Promise<number|null> {
  if (!location) return null;
  // 10.116 can be staged after the web release. Keep existing branch prices
  // readable until that table is installed; a missing relation inside a tenant
  // transaction would otherwise abort every order that checks a price.
  const windowsReady = (await client.query<{present:boolean}>(
    "SELECT to_regclass('bms_branch_price_windows') IS NOT NULL AS present"
  )).rows[0]?.present === true;
  const candidates = windowsReady
    ? `SELECT tenant_id,location_id,product_sku,size,pack_code,price,1 AS priority
         FROM bms_branch_prices
       UNION ALL
       SELECT tenant_id,location_id,product_sku,size,pack_code,price,0 AS priority
         FROM bms_branch_price_windows
        WHERE cancelled_at IS NULL AND starts_at <= transaction_timestamp()
          AND (ends_at IS NULL OR ends_at > transaction_timestamp())`
    : `SELECT tenant_id,location_id,product_sku,size,pack_code,price,1 AS priority
         FROM bms_branch_prices`;
  const r=await client.query(`SELECT bp.price::text
    FROM (${candidates}) bp JOIN bms_products p ON p.tenant_id=bp.tenant_id AND p.sku=bp.product_sku AND p.active
    WHERE bp.tenant_id=$1 AND bp.location_id=$2 AND bp.product_sku=$3 AND bp.size=$4
      AND bp.pack_code=CASE WHEN EXISTS(SELECT 1 FROM bms_product_packs k WHERE k.tenant_id=$1 AND k.product_sku=$3 AND (k.size=$4 OR k.size IS NULL) AND upper(k.pack_code)=upper($5) AND k.is_base AND k.active) THEN 'BASE' ELSE upper($5) END
      AND ((bp.pack_code='BASE' AND EXISTS(SELECT 1 FROM bms_product_variants v WHERE v.tenant_id=$1 AND v.product_sku=$3 AND v.code=$4 AND v.active))
        OR EXISTS(SELECT 1 FROM bms_product_packs k WHERE k.tenant_id=bp.tenant_id AND k.product_sku=bp.product_sku AND (k.size=bp.size OR k.size IS NULL) AND upper(k.pack_code)=bp.pack_code AND k.active))
    ORDER BY bp.priority LIMIT 1`,[tenant,location,sku,size,packCode]);
  return r.rows[0] ? Number(r.rows[0].price) : null;
}
export async function readBranchPrice(tenant:string,location:string|null|undefined,sku:string,size:string,packCode="BASE") {
  return branchPrice({query},tenant,location,sku,size,packCode);
}
export async function saveBranchPriceInTx(client:PoolClient,tenant:string,actor:string,location:string,sku:string,size:string,packCode:string,price:number) {
  await assertValuationLocation(client,tenant,actor,location);
  if (!Number.isFinite(price)||price<0||price>1_000_000_000||Math.abs(price*100-Math.round(price*100))>0.00001) throw new Error("PRICE_PUBLISH_INVALID_BRANCH_PRICE");
  const pack=packCode.toUpperCase()==='BASE'
    ? await client.query('SELECT 1 FROM bms_product_variants WHERE tenant_id=$1 AND product_sku=$2 AND code=$3 AND active',[tenant,sku,size])
    : await client.query(`SELECT 1 FROM bms_product_packs WHERE tenant_id=$1 AND product_sku=$2 AND (size=$3 OR size IS NULL) AND upper(pack_code)=upper($4) AND active`,[tenant,sku,size,packCode]);
  if (!pack.rowCount) throw new Error("PRICE_PUBLISH_BRANCH_PACK_REQUIRED");
  await client.query(`INSERT INTO bms_branch_prices(tenant_id,location_id,product_sku,size,pack_code,price) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(tenant_id,location_id,product_sku,size,pack_code) DO UPDATE SET price=EXCLUDED.price,updated_at=now()`,[tenant,location,sku,size,packCode.toUpperCase(),price]);
}

/** Future windows temporarily supersede the current branch price; expiry restores it. */
export async function scheduleBranchPriceInTx(client:PoolClient,tenant:string,actor:string,location:string,
  sku:string,size:string,packCode:string,price:number,startsAt:string,endsAt:string|null) {
  await assertValuationLocation(client,tenant,actor,location);
  if (!Number.isFinite(price)||price<0||price>1_000_000_000||Math.abs(price*100-Math.round(price*100))>0.00001) throw new Error("PRICE_PUBLISH_INVALID_BRANCH_PRICE");
  const start=new Date(startsAt),end=endsAt?new Date(endsAt):null;
  if (!Number.isFinite(start.getTime())
    || (end && (!Number.isFinite(end.getTime()) || end<=start))) throw new Error("PRICE_PUBLISH_INVALID_WINDOW");
  const pack=packCode.toUpperCase()==='BASE'
    ? await client.query('SELECT 1 FROM bms_product_variants WHERE tenant_id=$1 AND product_sku=$2 AND code=$3 AND active',[tenant,sku,size])
    : await client.query(`SELECT 1 FROM bms_product_packs WHERE tenant_id=$1 AND product_sku=$2 AND (size=$3 OR size IS NULL) AND upper(pack_code)=upper($4) AND active`,[tenant,sku,size,packCode]);
  if (!pack.rowCount) throw new Error("PRICE_PUBLISH_BRANCH_PACK_REQUIRED");
  await client.query(`INSERT INTO bms_branch_price_windows
    (tenant_id,location_id,product_sku,size,pack_code,price,starts_at,ends_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tenant,location,sku,size,packCode.toUpperCase(),price,start.toISOString(),end?.toISOString()??null]);
}

export async function cancelBranchPriceWindow(tenant:string,actor:string,id:string,confirmed:boolean) {
  if (!confirmed || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error("PRICE_PUBLISH_CANCEL_CONFIRM_REQUIRED");
  const client=await getClient();
  try {
    await beginTenantTx(client,tenant,{editorId:actor});
    const row=(await client.query<{location_id:string;product_sku:string;size:string;pack_code:string;cancelled_at:Date|null}>(
      `SELECT location_id,product_sku,size,pack_code,cancelled_at
         FROM bms_branch_price_windows WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenant,id])).rows[0];
    if (!row) { await client.query("ROLLBACK"); return {status:"NOT_FOUND"}; }
    await assertValuationLocation(client,tenant,actor,row.location_id);
    if (row.cancelled_at) { await client.query("COMMIT"); return {status:"ALREADY_CANCELLED"}; }
    await client.query(`UPDATE bms_branch_price_windows SET cancelled_at=transaction_timestamp()
      WHERE tenant_id=$1 AND id=$2`,[tenant,id]);
    await client.query(`INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
      VALUES($1,$2,'restaurant.branch_price_window_cancelled',$3,$4::jsonb)`,
      [tenant,`user:${actor}`,id,JSON.stringify({sku:row.product_sku,size:row.size,packCode:row.pack_code,locationId:row.location_id})]);
    await client.query("COMMIT");
    return {status:"CANCELLED"};
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally {client.release();}
}

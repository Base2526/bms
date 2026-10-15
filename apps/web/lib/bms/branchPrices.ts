import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import { assertValuationLocation } from "./inventoryValuation";

type Reader = {query: typeof query};
/** A missing branch override inherits the shared catalog. Zero is a valid explicit price. */
export async function branchPrice(client:Reader,tenant:string,location:string|null|undefined,sku:string,size:string,packCode="BASE"):Promise<number|null> {
  if (!location) return null;
  const r=await client.query(`SELECT bp.price::text
    FROM bms_branch_prices bp JOIN bms_products p ON p.tenant_id=bp.tenant_id AND p.sku=bp.product_sku AND p.active
    WHERE bp.tenant_id=$1 AND bp.location_id=$2 AND bp.product_sku=$3 AND bp.size=$4
      AND bp.pack_code=CASE WHEN EXISTS(SELECT 1 FROM bms_product_packs k WHERE k.tenant_id=$1 AND k.product_sku=$3 AND (k.size=$4 OR k.size IS NULL) AND upper(k.pack_code)=upper($5) AND k.is_base AND k.active) THEN 'BASE' ELSE upper($5) END
      AND ((bp.pack_code='BASE' AND EXISTS(SELECT 1 FROM bms_product_variants v WHERE v.tenant_id=$1 AND v.product_sku=$3 AND v.code=$4 AND v.active))
        OR EXISTS(SELECT 1 FROM bms_product_packs k WHERE k.tenant_id=bp.tenant_id AND k.product_sku=bp.product_sku AND (k.size=bp.size OR k.size IS NULL) AND upper(k.pack_code)=bp.pack_code AND k.active))`,[tenant,location,sku,size,packCode]);
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

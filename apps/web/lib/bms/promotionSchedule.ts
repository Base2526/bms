import type { PoolClient } from "pg";
/** Half-open intervals; future publication preserves today's rule and closes it only at activation. */
export async function preparePromotionWindow(client:PoolClient,tenant:string,sku:string,location:string|null,start:string|null,end:string|null) {
  const enabled=(await client.query(`SELECT 1 FROM pg_constraint WHERE conrelid='bms_product_promotions'::regclass AND conname='bms_promotion_windows_exclusive'`)).rowCount;
  if(!enabled)return {enabled:false,id:null as string|null,start,end};
  const now=(await client.query('SELECT transaction_timestamp() AS now')).rows[0].now as Date;
  const starts=start?new Date(start):now;
  const rows=(await client.query(`SELECT id,starts_at,ends_at FROM bms_product_promotions WHERE tenant_id=$1 AND product_sku=$2 AND location_id IS NOT DISTINCT FROM $3::uuid AND active ORDER BY starts_at NULLS FIRST FOR UPDATE`,[tenant,sku,location])).rows;
  const millis=(d:Date|string|null,fallback:number)=>d==null?fallback:new Date(d).getTime();
  const exact=rows.find(r=>start ? millis(r.starts_at,-Infinity)===starts.getTime() : millis(r.starts_at,-Infinity)<=now.getTime()&&millis(r.ends_at,Infinity)>now.getTime());
  const later=rows.find(r=>r.id!==exact?.id&&millis(r.starts_at,-Infinity)>starts.getTime());
  const ends=end?new Date(end):later?.starts_at?new Date(later.starts_at):null;
  if(ends&&ends<=starts)throw new Error('PRICE_PUBLISH_INVALID_SCHEDULE');
  if(later&&ends&&ends.getTime()>millis(later.starts_at,Infinity))throw new Error('PRICE_PUBLISH_SCHEDULE_OVERLAP');
  // Do not rewrite historical start dates when editing a currently effective rule.
  const effectiveStart=exact ? exact.starts_at : starts;
  for(const prior of rows) {
    if(prior.id===exact?.id)continue;
    if(millis(prior.starts_at,-Infinity)<starts.getTime()&&millis(prior.ends_at,Infinity)>starts.getTime()) {
      await client.query('UPDATE bms_product_promotions SET ends_at=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2',[tenant,prior.id,starts]);
    }
  }
  return {enabled:true,id:exact?String(exact.id):null,start:effectiveStart==null?null:new Date(effectiveStart).toISOString(),end:ends?.toISOString()??null};
}

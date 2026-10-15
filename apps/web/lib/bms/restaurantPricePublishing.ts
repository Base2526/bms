import { saveBranchPriceInTx } from "./branchPrices";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { assertValuationLocation } from "./inventoryValuation";
import { normalizePricePlan } from "./restaurantPricePlanning";
import { getRecipeCostEstimate } from "./recipeCostEstimates";
import { upsertProductPackInTx } from "./productPacks";
import { upsertProductPromotionInTx } from "./productPromotions";

export type PublishPriceInput = {plan:unknown;scenarioIndex:number;mode:string;quantity:number;packCode?:string|null;locationId?:string|null;salesSurface?:string|null;startsAt?:string|null;endsAt?:string|null};
const hash = (v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function prepare(client:PoolClient,tenant:string,actor:string,input:PublishPriceInput) {
  const plan=normalizePricePlan(input.plan), scenario=plan.scenarios[input.scenarioIndex];
  if (!Number.isInteger(input.scenarioIndex)||!scenario||!['BASE','PACK','PROMOTION'].includes(input.mode)
    || !Number.isInteger(input.quantity)||input.quantity<1||input.quantity>10000
    || (input.mode==='BASE' && input.quantity!==1) || (input.mode==='PACK' && input.quantity<2)) throw new Error('PRICE_PUBLISH_INVALID_INPUT');
  const packCode=input.mode==='BASE' ? 'BASE' : String(input.packCode??'').trim().toUpperCase();
  if (input.mode==='PACK' && (!/^[A-Z0-9_-]{1,30}$/.test(packCode)||packCode==='BASE')) throw new Error('PRICE_PUBLISH_INVALID_PACK');
  // Shared prices need unrestricted access; branch overrides use authorized branch scope.
  const scoped=(await client.query('SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2 LIMIT 1',[tenant,actor])).rowCount;
  if (scoped && !input.locationId) throw new Error('PRICE_PUBLISH_ALL_BRANCH_ACCESS_REQUIRED');
  if (input.locationId != null && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.locationId)) throw new Error('PRICE_PUBLISH_INVALID_SCOPE');
  if (input.locationId) await assertValuationLocation(client,tenant,actor,input.locationId);
  const recipe=(await client.query(`SELECT r.product_sku,r.size,r.active,p.vat_category,s.vat_registered,s.price_includes_vat,s.vat_rate,s.currency
    FROM bms_product_recipes r JOIN bms_products p ON p.tenant_id=r.tenant_id AND p.sku=r.product_sku
    JOIN bms_store_profile s ON s.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.id=$2`,[tenant,plan.recipeId])).rows[0];
  if (!recipe?.active) throw new Error('PRICE_PUBLISH_ACTIVE_RECIPE_REQUIRED');
  if (recipe.currency!=='THB') throw new Error('PRICE_PUBLISH_CURRENCY_REVIEW_REQUIRED');
  if (recipe.vat_registered && !recipe.price_includes_vat) throw new Error('PRICE_PUBLISH_EXCLUSIVE_CHECKOUT_UNSUPPORTED');
  const expectedMode=!recipe.vat_registered||recipe.vat_category==='N' ? 'NONE' : recipe.price_includes_vat ? 'INCLUSIVE' : 'EXCLUSIVE';
  if (recipe.vat_category==='UNKNOWN' || (scenario.vatMode!==expectedMode && !(expectedMode==='INCLUSIVE' && scenario.vatMode==='EXCLUSIVE')) || scenario.vatPercent!==(expectedMode==='NONE'?0:Number(recipe.vat_rate))) throw new Error('PRICE_PUBLISH_VAT_MISMATCH');
  const locationId=input.locationId??null,salesSurface=input.salesSurface??null;
  const startsAt=input.startsAt ? new Date(input.startsAt) : null,endsAt=input.endsAt ? new Date(input.endsAt) : null;
  if ((salesSurface && !['RETAIL_POS','RESTAURANT_POS','ONLINE_ORDER'].includes(salesSurface))
    || (startsAt && !Number.isFinite(startsAt.getTime())) || (endsAt && !Number.isFinite(endsAt.getTime()))
    || (startsAt && endsAt && endsAt<=startsAt)) throw new Error('PRICE_PUBLISH_INVALID_SCOPE');
  if (input.mode!=='PROMOTION' && (salesSurface||startsAt||endsAt)) throw new Error('PRICE_PUBLISH_SCOPE_REQUIRES_PROMOTION');
  const estimate=await getRecipeCostEstimate(tenant,plan.recipeId,client,plan,actor);
  if (!estimate || estimate.status!=='COMPLETE') throw new Error('PRICE_PUBLISH_COST_INCOMPLETE');
  const sku=String(recipe.product_sku),size=String(recipe.size);
  const packs=(await client.query('SELECT * FROM bms_product_packs WHERE tenant_id=$1 AND product_sku=$2 ORDER BY id',[tenant,sku])).rows;
  const promotions=(await client.query('SELECT * FROM bms_product_promotions WHERE tenant_id=$1 AND product_sku=$2 AND active ORDER BY id',[tenant,sku])).rows;
  const now=(await client.query('SELECT transaction_timestamp() AS now')).rows[0].now as Date;
  const currentPromotionIds=promotions.filter(p=>(!p.starts_at||new Date(p.starts_at)<=now)&&(!p.ends_at||new Date(p.ends_at)>now)).map(p=>String(p.id));
  const tiers=(await client.query('SELECT * FROM bms_product_price_tiers WHERE tenant_id=$1 AND product_sku=$2 ORDER BY id',[tenant,sku])).rows;
  const branchPrices=(await client.query("SELECT * FROM bms_branch_prices WHERE tenant_id=$1 AND product_sku=$2 ORDER BY location_id,size,pack_code",[tenant,sku])).rows;
  const base=(await client.query('SELECT price::text FROM bms_products WHERE tenant_id=$1 AND sku=$2',[tenant,sku])).rows[0];
  const matches=(p:any)=>input.mode==='BASE' ? p.is_base : p.pack_code===packCode;
  const existing=packs.find(p=>p.size===size && matches(p)) ?? (locationId ? packs.find(p=>p.size==null && matches(p)) : undefined);
  if(locationId && input.mode==='PACK' && (!existing || !existing.active || Number(existing.base_qty)!==input.quantity)) throw new Error('PRICE_PUBLISH_BRANCH_PACK_REQUIRED');
  // Existing base barcode/unit are retained by the shared writer.
  // Convert an exclusive what-if price to the inclusive checkout price shown for confirmation.
  // Keep per-unit rounding consistent with the planner before multiplying the pack quantity.
  const unitCents=BigInt(Math.round(scenario.price*100)), rateBps=BigInt(Math.round(scenario.vatPercent*100));
  const sellingCents=scenario.vatMode==='EXCLUSIVE' ? unitCents+(unitCents*rateBps+5000n)/10000n : unitCents;
  const price=Number(sellingCents*BigInt(input.quantity))/100;
  if (price>1_000_000_000) throw new Error('PRICE_PUBLISH_PRICE_LIMIT');
  const snapshot={plan,scenarioIndex:input.scenarioIndex,mode:input.mode,quantity:input.quantity,packCode,
    sku,size,price,scope:locationId?'SELECTED_BRANCH':input.mode==='PROMOTION'?'SELECTED_PROMOTION_SCOPE':'ALL_BRANCHES_ALL_CHANNELS',locationId,salesSurface,startsAt:startsAt?.toISOString()??null,endsAt:endsAt?.toISOString()??null,existingPackId:existing?.id??null,
    estimate:{...estimate,calculatedAt:undefined},recipe,packs,promotions,tiers,base,branchPrices,currentPromotionIds};
  return {fingerprint:hash(snapshot),snapshot,existing};
}
export async function previewPricePublication(tenant:string,actor:string,input:PublishPriceInput) {
  const client=await getClient();
  try {
    await beginTenantTx(client,tenant,{serializable:true});
    const p=await prepare(client,tenant,actor,input);
    await client.query('COMMIT');
    return {status:'READY',fingerprint:p.fingerprint,snapshot:p.snapshot};
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
export async function publishPricePlan(tenant:string,actor:string,input:PublishPriceInput,review:{fingerprint:string;requestId:string;confirmed:boolean}) {
  if (review.confirmed!==true || !/^[a-f0-9]{64}$/.test(review.fingerprint) || !/^[a-f0-9-]{36}$/i.test(review.requestId)) throw new Error('PRICE_PUBLISH_CONFIRM_REQUIRED');
  const requestHash=hash({input, fingerprint:review.fingerprint}),client=await getClient();
  try {
    await beginTenantTx(client,tenant,{serializable:true,editorId:actor});
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1041))',[tenant]);
    const scoped=(await client.query('SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2 LIMIT 1',[tenant,actor])).rowCount;
    if (scoped && !input.locationId) throw new Error('PRICE_PUBLISH_ALL_BRANCH_ACCESS_REQUIRED');
  if (input.locationId != null && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.locationId)) throw new Error('PRICE_PUBLISH_INVALID_SCOPE');
  if (input.locationId) await assertValuationLocation(client,tenant,actor,input.locationId);
    const saved=(await client.query('SELECT request_hash FROM bms_price_plan_publications WHERE tenant_id=$1 AND request_id=$2',[tenant,review.requestId])).rows[0];
    if (saved) {
      if (saved.request_hash!==requestHash) throw new Error('PRICE_PUBLISH_IDEMPOTENCY_CONFLICT');
      await client.query('COMMIT'); return {status:'PUBLISHED'};
    }
    const p=await prepare(client,tenant,actor,input),s=p.snapshot;
    if (p.fingerprint!==review.fingerprint) throw new Error('PRICE_PUBLISH_STALE_REVIEW');
    if (s.mode==='PROMOTION') await upsertProductPromotionInTx(client,{tenantId:tenant,actorUserId:actor,productSku:s.sku,
      kind:'N_FOR_PRICE',buySize:s.size,locationId:s.locationId,salesSurface:s.salesSurface,startsAt:s.startsAt,endsAt:s.endsAt,buyQty:s.quantity,bundlePrice:s.price,note:`Price plan: ${s.plan.scenarios[s.scenarioIndex].label}`});
    else if(s.locationId) await saveBranchPriceInTx(client,tenant,actor,s.locationId,s.sku,s.size,s.mode==='BASE'?'BASE':s.packCode,s.price);
    else await upsertProductPackInTx(client,tenant,{id:p.existing?.id,productSku:s.sku,size:s.size,
      packCode:p.existing?.pack_code??s.packCode,unitName:p.existing?.unit_name,
      barcode:p.existing?.barcode,baseQty:s.quantity,price:s.price,isBase:s.mode==='BASE',active:true});
    await client.query('INSERT INTO bms_price_plan_publications(tenant_id,request_id,request_hash,snapshot,created_by) VALUES($1,$2,$3,$4::jsonb,$5)',[tenant,review.requestId,requestHash,JSON.stringify(s),actor]);
    await client.query(`INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,'restaurant.price_plan_published',$3,$4::jsonb)`,[tenant,`user:${actor}`,review.requestId,JSON.stringify({sku:s.sku,mode:s.mode,price:s.price,fingerprint:p.fingerprint})]);
    await client.query('COMMIT');return {status:'PUBLISHED'};
  } catch(e) { await client.query('ROLLBACK');throw e; } finally {client.release();}
}

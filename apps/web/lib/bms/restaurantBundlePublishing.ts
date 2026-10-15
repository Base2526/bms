import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { normalizeMenuPlan, calculateMenuPlan } from "./restaurantMenuPlanning";
import { getRecipeCostEstimate } from "./recipeCostEstimates";
import { loadPinnedRecipeCompositionInTx, flattenRecipeComposition } from "./recipeComposition";
import { upsertProduct } from "./products";
import { upsertProductRecipe } from "./productRecipes";
import { publishProduct, normalizeProductSalesSurfaces } from "./productConfiguration";
import { normalizeRecipeCostAssumptions, type RecipeCostAssumptions } from "./recipeCosting";

export type BundlePublicationInput={plan:unknown;sku:string;name:string;vatCategory:'V'|'N';surfaces:string[];kitchenStation?:string|null};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function access(c:PoolClient,tenant:string,actor:string) {
  if((await c.query('SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2 LIMIT 1',[tenant,actor])).rowCount)throw new Error('BUNDLE_PUBLISH_ALL_BRANCH_ACCESS_REQUIRED');
}
async function prepare(c:PoolClient,tenant:string,actor:string,input:BundlePublicationInput) {
  await access(c,tenant,actor);
  const plan=normalizeMenuPlan(input.plan),sku=String(input.sku??'').trim(),name=String(input.name??'').trim();
  if(!plan.bundle||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(sku)||!name||name.length>200||!['V','N'].includes(input.vatCategory))throw new Error('BUNDLE_PUBLISH_INVALID_INPUT');
  const surfaces=normalizeProductSalesSurfaces(input.surfaces);
  if(!surfaces.length||surfaces.some(s=>!['RETAIL_POS','RESTAURANT_POS','ONLINE_ORDER'].includes(s)))throw new Error('BUNDLE_PUBLISH_INVALID_SURFACES');
  if((await c.query('SELECT 1 FROM bms_products WHERE tenant_id=$1 AND sku=$2',[tenant,sku])).rowCount)throw new Error('BUNDLE_PUBLISH_SKU_EXISTS');
  const profile=(await c.query('SELECT vat_registered,price_includes_vat,vat_rate,currency FROM bms_store_profile WHERE tenant_id=$1',[tenant])).rows[0];
  if(profile?.currency!=='THB'||(profile.vat_registered&&!profile.price_includes_vat))throw new Error('BUNDLE_PUBLISH_TAX_SETTINGS_REQUIRED');
  const scenario=plan.bundle.scenario,taxable=profile.vat_registered&&input.vatCategory==='V';
  if(taxable ? !['INCLUSIVE','EXCLUSIVE'].includes(scenario.vatMode)||scenario.vatPercent!==Number(profile.vat_rate) : scenario.vatMode!=='NONE'||scenario.vatPercent!==0)throw new Error('BUNDLE_PUBLISH_VAT_MISMATCH');
  const estimates=[];
  for(const item of plan.items){const e=await getRecipeCostEstimate(tenant,item.recipeId,c,plan,actor);if(!e||e.status!=='COMPLETE')throw new Error('BUNDLE_PUBLISH_COST_INCOMPLETE');estimates.push(e);}
  const children=await loadPinnedRecipeCompositionInTx(c,tenant,sku,plan.bundle.parts);
  const bom=flattenRecipeComposition(sku,[],children);
  const assumptions:RecipeCostAssumptions={labor:null,electricity:null,gas:null};
  for(const category of ['labor','electricity','gas'] as const) {
    let quantity=0,extendedRate=0;
    for(const part of plan.bundle.parts) {
      const e=estimates.find(e=>e.recipeId===part.recipeId)!;
      const line=e.overhead.find(l=>l.category===category)!;
      if(line.quantity==null||line.rate==null)throw new Error('BUNDLE_PUBLISH_COST_INCOMPLETE');
      const q=line.quantity*part.qty/e.outputQty;quantity+=q;extendedRate+=q*line.rate;
    }
    assumptions[category]={quantity:Number(quantity.toFixed(6)),rate:quantity?Number((extendedRate/quantity).toFixed(6)):0,source:`Published child recipe assumptions: ${plan.assumptionSource}`.slice(0,500)};
  }
  normalizeRecipeCostAssumptions(assumptions);
  const analysis=calculateMenuPlan(plan,new Map(estimates.map(e=>[e.recipeId,e.totalUnitCost])));
  const price=analysis.bundle!.price.customerTotal;
  const snapshot={plan,sku,name,size:'STD',surfaces,vatCategory:input.vatCategory,kitchenStation:input.kitchenStation?.trim()||null,price,bom,assumptions,
    estimates:estimates.map(({calculatedAt,...e})=>e),profile};
  return {snapshot,fingerprint:hash(snapshot)};
}
export async function previewBundlePublication(tenant:string,actor:string,input:BundlePublicationInput) {
  const c=await getClient();try{await beginTenantTx(c,tenant,{serializable:true});const p=await prepare(c,tenant,actor,input);await c.query('COMMIT');return {status:'READY',...p};}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function publishMenuBundle(tenant:string,actor:string,input:BundlePublicationInput,review:{fingerprint:string;requestId:string;confirmed:boolean}) {
  if(review.confirmed!==true||!/^[a-f0-9]{64}$/.test(review.fingerprint)||!/^[a-f0-9-]{36}$/i.test(review.requestId))throw new Error('BUNDLE_PUBLISH_CONFIRM_REQUIRED');
  const c=await getClient();try{
    await beginTenantTx(c,tenant,{serializable:true,editorId:actor});await access(c,tenant,actor);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1072))',[tenant]);
    const requestHash=hash({input,fingerprint:review.fingerprint});
    const old=(await c.query('SELECT request_hash,snapshot FROM bms_price_plan_publications WHERE tenant_id=$1 AND request_id=$2',[tenant,review.requestId])).rows[0];
    if(old){if(old.request_hash!==requestHash)throw new Error('BUNDLE_PUBLISH_IDEMPOTENCY_CONFLICT');await c.query('COMMIT');return {status:'PUBLISHED',snapshot:old.snapshot};}
    const p=await prepare(c,tenant,actor,input),s=p.snapshot;
    if(p.fingerprint!==review.fingerprint)throw new Error('BUNDLE_PUBLISH_STALE_REVIEW');
    await upsertProduct(tenant,{sku:s.sku,name:s.name,price:s.price,vat_category:s.vatCategory,stock_policy:'RECIPE',base_unit:'PIECE',variant_codes:[s.size],sales_surfaces:s.surfaces,kitchen_station:s.kitchenStation},actor,null,c);
    await upsertProductRecipe(tenant,{productSku:s.sku,size:s.size,outputQty:1,active:true,directItems:[],subrecipes:s.plan.bundle!.parts,costAssumptions:s.assumptions,sopSteps:s.plan.bundle!.parts.map(p=>`${p.qty} × ${p.recipeId}`)},actor,c);
    await publishProduct(tenant,s.sku,actor,c);
    await c.query('INSERT INTO bms_price_plan_publications(tenant_id,request_id,request_hash,snapshot,created_by) VALUES($1,$2,$3,$4::jsonb,$5)',[tenant,review.requestId,requestHash,JSON.stringify({...s,mode:'MENU_BUNDLE'}),actor]);
    await c.query(`INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,'restaurant.bundle_published',$3,$4::jsonb)`,[tenant,actor,s.sku,JSON.stringify({fingerprint:p.fingerprint,requestId:review.requestId,price:s.price})]);
    await c.query('COMMIT');return {status:'PUBLISHED',snapshot:{sku:s.sku}};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

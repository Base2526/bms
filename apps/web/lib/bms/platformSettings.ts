import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { query, runInTransaction } from "@/lib/db";
import { requirePlatformAdmin } from "./platform";
import { getTenantId } from "./tenant";
import { planFeatureKeys, type PackageFeature } from "./featurePolicy";

type PlatformContext = { admin?: { id?: string; email?: string; tenant_id?: string } };

export const FALLBACK_COUNTRIES = [
  { code: "TH", nameTh: "ไทย", nameEn: "Thailand", defaultCurrencyCode: "THB", defaultTimezoneCode: "Asia/Bangkok", addressDatasetStatus: "READY", active: true },
  { code: "AU", nameTh: "ออสเตรเลีย", nameEn: "Australia", defaultCurrencyCode: "AUD", defaultTimezoneCode: "Australia/Sydney", addressDatasetStatus: "REVIEW_REQUIRED", active: true },
  { code: "GB", nameTh: "สหราชอาณาจักร", nameEn: "United Kingdom", defaultCurrencyCode: "GBP", defaultTimezoneCode: "Europe/London", addressDatasetStatus: "REVIEW_REQUIRED", active: true },
] as const;
export const FALLBACK_CURRENCIES = [
  { code: "THB", nameTh: "บาทไทย", nameEn: "Thai baht", symbol: "฿", minorUnits: 2, active: true },
  { code: "AUD", nameTh: "ดอลลาร์ออสเตรเลีย", nameEn: "Australian dollar", symbol: "A$", minorUnits: 2, active: true },
  { code: "GBP", nameTh: "ปอนด์สเตอร์ลิง", nameEn: "Pound sterling", symbol: "£", minorUnits: 2, active: true },
] as const;
export const FALLBACK_TIMEZONES = [
  { code: "Asia/Bangkok", nameTh: "เวลาไทย", nameEn: "Bangkok time", active: true },
  { code: "Australia/Sydney", nameTh: "เวลาซิดนีย์", nameEn: "Sydney time", active: true },
  { code: "Europe/London", nameTh: "เวลาลอนดอน", nameEn: "London time", active: true },
] as const;

export async function listPlatformReferences() {
  try {
    const [countries, currencies, timezones, issues] = await Promise.all([
      query<any>(`SELECT * FROM bms_master_countries ORDER BY code`),
      query<any>(`SELECT * FROM bms_master_currencies ORDER BY code`),
      query<any>(`SELECT * FROM bms_master_timezones ORDER BY code`),
      query<any>(`SELECT field,raw_value,COUNT(*)::int AS shops FROM bms_master_reference_backfill_issues WHERE resolved_at IS NULL GROUP BY field,raw_value ORDER BY field,raw_value LIMIT 200`),
    ]);
    return {
      source: "DATABASE",
      countries: countries.rows.map(r => ({ code:r.code,nameTh:r.name_th,nameEn:r.name_en,defaultCurrencyCode:r.default_currency_code,defaultTimezoneCode:r.default_timezone_code,addressDatasetStatus:r.address_dataset_status,active:r.active })),
      currencies: currencies.rows.map(r => ({ code:r.code,nameTh:r.name_th,nameEn:r.name_en,symbol:r.symbol,minorUnits:r.minor_units,active:r.active })),
      timezones: timezones.rows.map(r => ({ code:r.code,nameTh:r.name_th,nameEn:r.name_en,active:r.active })),
      unresolved: issues.rows.map(r => ({ field:r.field,rawValue:r.raw_value,shops:r.shops })),
    };
  } catch {
    return { source:"CODE_FALLBACK", countries:FALLBACK_COUNTRIES, currencies:FALLBACK_CURRENCIES, timezones:FALLBACK_TIMEZONES, unresolved:[] };
  }
}

function mapAiRate(row:any){return{id:row.id,provider:row.provider,model:row.model,inputUsdPerMillion:Number(row.input_usd_per_million),
  outputUsdPerMillion:Number(row.output_usd_per_million),cacheCreationMultiplier:Number(row.cache_creation_multiplier),
  cacheReadMultiplier:Number(row.cache_read_multiplier),effectiveFrom:row.effective_from instanceof Date?row.effective_from.toISOString():row.effective_from,
  effectiveTo:row.effective_to instanceof Date?row.effective_to.toISOString():row.effective_to??null,active:row.active,source:row.source,sourceVersion:row.source_version};}

export async function listAiRateCards(ctx:PlatformContext){
  await requirePlatformAdmin(ctx);
  const result=await query<any>(`SELECT * FROM bms_master_ai_rates ORDER BY provider,model,effective_from DESC LIMIT 500`);
  return result.rows.map(mapAiRate);
}

export type AiRateInput={provider:string;model:string;inputUsdPerMillion:number;outputUsdPerMillion:number;cacheCreationMultiplier?:number|null;cacheReadMultiplier?:number|null;effectiveFrom:string;source:string;sourceVersion:string};
export async function addAiRateCard(ctx:PlatformContext,input:AiRateInput){
  await requirePlatformAdmin(ctx);const actorId=String(ctx.admin?.id||"");if(!actorId)throw new Error("Unauthenticated");
  const normalized={provider:String(input.provider).trim().toLowerCase().slice(0,80),model:String(input.model).trim().slice(0,200),
    input:Number(input.inputUsdPerMillion),output:Number(input.outputUsdPerMillion),cacheCreate:Number(input.cacheCreationMultiplier??1),cacheRead:Number(input.cacheReadMultiplier??1),
    effectiveFrom:new Date(input.effectiveFrom),source:String(input.source).trim().slice(0,300),sourceVersion:String(input.sourceVersion).trim().slice(0,120)};
  if(!normalized.provider||!normalized.model||!normalized.source||!normalized.sourceVersion||Number.isNaN(normalized.effectiveFrom.getTime())||
    [normalized.input,normalized.output,normalized.cacheCreate,normalized.cacheRead].some(v=>!Number.isFinite(v)||v<0))throw new Error("AI_RATE_FIELDS_INVALID");
  return(await runInTransaction(actorId,async client=>{const result=await client.query<any>(`SELECT * FROM public.add_bms_ai_rate($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [normalized.provider,normalized.model,normalized.input,normalized.output,normalized.cacheCreate,normalized.cacheRead,normalized.effectiveFrom.toISOString(),normalized.source,normalized.sourceVersion]);
    const row=result.rows[0];await writeAudit(client,ctx,"platform.ai_rate.add",String(row.id),{provider:row.provider,model:row.model,effectiveFrom:row.effective_from,sourceVersion:row.source_version});return mapAiRate(row);})).result;
}

export type PlanCatalogInput = {
  code: string; expectedVersion: number; name: string; priceMonthly: number;
  maxProducts: number; maxChannels: number; maxOrdersMonth: number; maxUsers: number;
  maxBranches: number; maxDevices: number; maxAiMessagesMonth: number; aiCreditsMonthly: number;
  featureKeys: string[];
};

const PLAN_FEATURE_SET = new Set<PackageFeature>(["REPORT_SCHEDULE", "RETENTION_ENGINE"]);
const intLimit = (value: unknown) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < -1 || n > 2_147_483_647) throw new Error("PLAN_LIMIT_INVALID");
  return n;
};

function normalizePlanInput(input: PlanCatalogInput) {
  const features = [...new Set(input.featureKeys.map(v => String(v).trim().toUpperCase()))].sort();
  if (features.some(v => !PLAN_FEATURE_SET.has(v as PackageFeature))) throw new Error("PLAN_FEATURE_INVALID");
  const price = Number(input.priceMonthly);
  if (!Number.isFinite(price) || price < 0) throw new Error("PLAN_PRICE_INVALID");
  const code = String(input.code).trim().toLowerCase();
  const name = String(input.name).trim().slice(0, 120);
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(code) || !name) throw new Error("PLAN_FIELDS_REQUIRED");
  const expectedVersion=intLimit(input.expectedVersion);
  if(expectedVersion<1)throw new Error("PLAN_VERSION_INVALID");
  // Orders are intentionally unlimited in every package. Do not publish a cap
  // that checkout/POS cannot enforce, or a second AI allowance ignored at runtime.
  if (intLimit(input.maxOrdersMonth) !== -1) throw new Error("PLAN_ORDERS_MUST_BE_UNLIMITED");
  if (intLimit(input.maxAiMessagesMonth) !== intLimit(input.aiCreditsMonthly)) {
    throw new Error("PLAN_AI_ALLOWANCE_MISMATCH");
  }
  return { code, expectedVersion, name, priceMonthly:Number(price.toFixed(2)),
    maxProducts:intLimit(input.maxProducts),maxChannels:intLimit(input.maxChannels),maxOrdersMonth:intLimit(input.maxOrdersMonth),
    maxUsers:intLimit(input.maxUsers),maxBranches:intLimit(input.maxBranches),maxDevices:intLimit(input.maxDevices),
    maxAiMessagesMonth:intLimit(input.maxAiMessagesMonth),aiCreditsMonthly:intLimit(input.aiCreditsMonthly),featureKeys:features };
}

const previewToken = (proposal: ReturnType<typeof normalizePlanInput>, tenants: number) =>
  createHash("sha256").update(JSON.stringify({ ...proposal, tenants })).digest("hex");

export function summarizePlanImpact(tenantCount:number,beforeFeatures:readonly string[],afterFeatures:readonly string[],changed=true,featureTenantCount=tenantCount) {
  const grantedFeatures=afterFeatures.filter(value=>!beforeFeatures.includes(value));
  const revokedFeatures=beforeFeatures.filter(value=>!afterFeatures.includes(value));
  return { affectedTenants:changed?tenantCount:0,featureGrantedTenants:grantedFeatures.length?featureTenantCount:0,
    featureRevokedTenants:revokedFeatures.length?featureTenantCount:0,grantedFeatures,revokedFeatures };
}

function mapPlanRow(row: any) {
  return { code:row.code,name:row.name,priceMonthly:Number(row.price_monthly),maxProducts:row.max_products,
    maxChannels:row.max_channels,maxOrdersMonth:row.max_orders_month,maxUsers:row.max_users,
    maxBranches:row.max_branches,maxDevices:row.max_devices,maxAiMessagesMonth:row.max_ai_messages_month,
    aiCreditsMonthly:row.ai_credits_monthly,featureKeys:Array.isArray(row.feature_keys)?row.feature_keys:planFeatureKeys(row.code),
    version:row.version??1,updatedAt:row.updated_at instanceof Date?row.updated_at.toISOString():row.updated_at??null };
}

type QueryRunner = (sql:string,params?:any[])=>Promise<{rows:any[];rowCount:number|null}>;
async function readPlanPreview(run: QueryRunner, proposal: ReturnType<typeof normalizePlanInput>) {
  const result = await run(`SELECT p.*,COUNT(t.id)::int AS tenant_count,
    COUNT(t.id) FILTER (WHERE COALESCE((to_jsonb(t)->>'feature_policy_version')::int,1)=2)::int AS feature_tenant_count
    FROM bms_plans p LEFT JOIN bms_tenants t ON t.plan=p.code WHERE p.code=$1 GROUP BY p.code`,[proposal.code]);
  const current = result.rows[0];
  if (!current) throw new Error("PLAN_NOT_FOUND");
  if ((current.version??1) !== proposal.expectedVersion) throw new Error("PLAN_VERSION_CONFLICT");
  const tenants = Number(current.tenant_count??0);
  const beforeFeatures: string[] = Array.isArray(current.feature_keys)?current.feature_keys:planFeatureKeys(current.code);
  const changed = JSON.stringify(mapPlanRow(current)) !== JSON.stringify({ ...mapPlanRow(current),
    name:proposal.name,priceMonthly:proposal.priceMonthly,maxProducts:proposal.maxProducts,maxChannels:proposal.maxChannels,
    maxOrdersMonth:proposal.maxOrdersMonth,maxUsers:proposal.maxUsers,maxBranches:proposal.maxBranches,maxDevices:proposal.maxDevices,
    maxAiMessagesMonth:proposal.maxAiMessagesMonth,aiCreditsMonthly:proposal.aiCreditsMonthly,featureKeys:proposal.featureKeys });
  return { code:proposal.code,version:proposal.expectedVersion,...summarizePlanImpact(tenants,beforeFeatures,proposal.featureKeys,changed,Number(current.feature_tenant_count??0)),
    previewToken:previewToken(proposal,tenants) };
}

export async function listPlanCatalog(ctx: PlatformContext) {
  await requirePlatformAdmin(ctx);
  const result = await query<any>(`SELECT * FROM bms_plans ORDER BY sort,code`);
  return result.rows.map(mapPlanRow);
}

export async function previewPlanCatalogChange(ctx: PlatformContext, input: PlanCatalogInput) {
  await requirePlatformAdmin(ctx);
  return readPlanPreview((sql,params)=>query(sql,params), normalizePlanInput(input));
}

async function writeAudit(client: PoolClient, ctx: PlatformContext, action: string, target: string, meta: object) {
  await client.query(`INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [getTenantId(ctx),String(ctx.admin?.email||ctx.admin?.id||"system"),action,target,JSON.stringify(meta)]);
}

export async function updatePlanCatalog(ctx: PlatformContext, input: PlanCatalogInput, token: string, confirmed: boolean) {
  await requirePlatformAdmin(ctx);
  if (!confirmed) throw new Error("CONFIRMATION_REQUIRED");
  const actorId = String(ctx.admin?.id||"");
  if (!actorId) throw new Error("Unauthenticated");
  const proposal = normalizePlanInput(input);
  return (await runInTransaction(actorId, async client => {
    const preview = await readPlanPreview((sql,params)=>client.query(sql,params), proposal);
    if (token !== preview.previewToken) throw new Error("PLAN_PREVIEW_STALE");
    const result = await client.query<any>(`SELECT * FROM public.update_bms_plan_catalog($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[])`,
      [proposal.code,proposal.expectedVersion,proposal.name,proposal.priceMonthly,proposal.maxProducts,proposal.maxChannels,
       proposal.maxOrdersMonth,proposal.maxUsers,proposal.maxBranches,proposal.maxDevices,proposal.maxAiMessagesMonth,
       proposal.aiCreditsMonthly,proposal.featureKeys]);
    if (!result.rowCount) throw new Error("PLAN_VERSION_CONFLICT");
    await writeAudit(client,ctx,"platform.plan_catalog.update",proposal.code,{ beforeVersion:proposal.expectedVersion,afterVersion:proposal.expectedVersion+1,...preview });
    return mapPlanRow(result.rows[0]);
  })).result;
}

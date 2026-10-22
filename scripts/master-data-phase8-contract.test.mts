import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { computePeriod, shouldSendNow, storeLocalNow } from "../apps/web/lib/bms/reportDigest.ts";
import { summarizePlanImpact, previewPlanCatalogChange, updatePlanCatalog } from "../apps/web/lib/bms/platformSettings.ts";

const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration=read("db/migrations/10.83__bms_platform_reference_settings.sql");
const corrections=read("db/migrations/10.84__bms_master_data_phase8_corrections.sql");
const issueSync=read("db/migrations/10.85__bms_store_reference_issue_sync.sql");
const usage=read("apps/web/lib/bms/aiUsage.ts");
const reports=read("apps/web/lib/bms/reports.ts");

test("catalogue preview and save reject unenforced order caps and conflicting AI allowances", async () => {
  const pool = (globalThis as any).__bmsPostgresPool;
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const calls: string[] = [];
  const ctx = { scope: "admin", admin: { id: "fixture-admin", tenant_id: "fixture-tenant" } };
  const input = { code: "pro", expectedVersion: 1, name: "Pro", priceMonthly: 599,
    maxProducts: -1, maxChannels: 3, maxOrdersMonth: -1, maxUsers: 5,
    maxBranches: 1, maxDevices: 3, maxAiMessagesMonth: 1000, aiCreditsMonthly: 1000,
    featureKeys: ["REPORT_SCHEDULE"] };
  pool.query = async (sql: string) => {
    calls.push(sql);
    if (sql.includes("SELECT is_platform_admin")) return { rows: [{ is_platform_admin: true }] };
    return { rows: [{ code: "pro", version: 1, name: "Pro", price_monthly: 599,
      max_products: -1, max_channels: 3, max_orders_month: -1, max_users: 5,
      max_branches: 1, max_devices: 3, max_ai_messages_month: 1000, ai_credits_monthly: 1000,
      feature_keys: ["REPORT_SCHEDULE"], tenant_count: 2, feature_tenant_count: 2 }] };
  };
  pool.connect = async () => { throw new Error("invalid catalogue input opened a write transaction"); };
  try {
    for (const [changes, message] of [
      [{ maxOrdersMonth: 100 }, /PLAN_ORDERS_MUST_BE_UNLIMITED/],
      [{ maxOrdersMonth: 0 }, /PLAN_ORDERS_MUST_BE_UNLIMITED/],
      [{ maxAiMessagesMonth: -1 }, /PLAN_AI_ALLOWANCE_MISMATCH/],
      [{ aiCreditsMonthly: 5000 }, /PLAN_AI_ALLOWANCE_MISMATCH/],
    ] as const) {
      calls.length = 0;
      await assert.rejects(previewPlanCatalogChange(ctx, { ...input, ...changes }), message);
      await assert.rejects(updatePlanCatalog(ctx, { ...input, ...changes }, "unused", true), message);
      assert.ok(calls.every(sql => sql.includes("SELECT is_platform_admin")), "deny before catalogue reads/writes");
    }
    for (const allowance of [0, 100, 1000, 5000, -1]) {
      const result = await previewPlanCatalogChange(ctx, {
        ...input, maxAiMessagesMonth: allowance, aiCreditsMonthly: allowance,
      });
      assert.equal(result.code, "pro");
      assert.match(result.previewToken, /^[a-f0-9]{64}$/);
    }
  } finally { pool.query = originalQuery; pool.connect = originalConnect; }
});

test("master-data tables contain horizontal overflow and country status is explicit",()=>{
  const page=read("apps/web/app/(admin)/admin/master-data/page.tsx");
  const tables=page.match(/<Table\b[\s\S]*?columns=\{/g)??[];
  assert.ok(tables.length>=10);
  for(const table of tables) assert.match(table,/scroll=\{\{x:\d+\}\}/);
  assert.doesNotMatch(page,/<Space align="start">/);
  const countries=page.slice(page.indexOf('<Card title={t("admin_master_data.countries")}'),page.indexOf('<Card title={t("admin_master_data.currencies_timezones")}'));
  assert.match(countries,/dataIndex:"active"/);
});

test("Thai digest period and schedule remain byte-for-byte compatible",()=>{
  const instant=new Date("2026-10-17T01:00:00.000Z");
  const local=storeLocalNow("Asia/Bangkok",instant);
  assert.deepEqual(local,{year:2026,month:10,day:17,hour:8,weekday:6});
  assert.equal(shouldSendNow({frequency:"DAILY",sendHour:8,sendWeekday:null,sendDayOfMonth:null},local),true);
  const daily=computePeriod("DAILY",local,"Asia/Bangkok");
  assert.equal(daily.periodStart.toISOString(),"2026-10-15T17:00:00.000Z");
  assert.equal(daily.periodEnd.toISOString(),"2026-10-16T17:00:00.000Z");
  assert.equal(daily.periodKey,"DAILY:2026-10-16");
});

test("store reports bind a validated store timezone while Thai stays the fallback",()=>{
  assert.match(reports,/resolveStoreTimezone\(tenantId\)/);
  assert.doesNotMatch(reports,/const r = range\(from, to\);/);
  assert.match(reports,/AT TIME ZONE \$6/);
  assert.doesNotMatch(reports,/AT TIME ZONE 'Asia\/Bangkok'/);
  assert.match(reports,/to_jsonb\(store_profile\)->>'timezone_code'/);
  assert.match(read("apps/web/lib/bms/storeLocale.ts"),/DEFAULT_STORE_TIMEZONE = "Asia\/Bangkok"/);
});

test("restaurant service days prefer the validated timezone code with the legacy field as fallback",()=>{
  for(const path of [
    "apps/web/lib/bms/restaurantOrdering.ts",
    "apps/web/lib/bms/menuAvailability.ts",
    "apps/web/lib/bms/restaurantWaitlist.ts",
    "apps/web/lib/bms/restaurantCustomer.ts",
    "apps/web/lib/bms/pharmacyCustomer.ts",
  ]) {
    const source=read(path);
    assert.match(source,/to_jsonb\(profile\)->>'timezone_code'/,path);
    assert.match(source,/Asia\/Bangkok/,path);
  }
});

test("AI rate cards resolve by immutable event date and finalized events stay one-shot",()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS bms_master_ai_rates/);
  assert.match(usage,/effective_from <= \$3/);
  assert.match(usage,/effective_to IS NULL OR effective_to > \$3/);
  assert.match(usage,/owner\.rows\[0\]\.created_at/);
  assert.match(usage,/if \(!row \|\| row\.completed_at\) return null/);
  assert.match(usage,/rate_card_source/);
  assert.doesNotMatch(usage,/UPDATE bms_ai_usage_events[\s\S]*WHERE completed_at IS NOT NULL/);
  assert.match(corrections,/pg_advisory_xact_lock/);
  assert.match(corrections,/lead\(effective_from\)/);
});

test("plan preview counts every tenant on the edited plan for grants and revocations",()=>{
  assert.deepEqual(summarizePlanImpact(7,["REPORT_SCHEDULE"],["REPORT_SCHEDULE","RETENTION_ENGINE"]),{
    affectedTenants:7,featureGrantedTenants:7,featureRevokedTenants:0,grantedFeatures:["RETENTION_ENGINE"],revokedFeatures:[],
  });
  assert.deepEqual(summarizePlanImpact(3,["REPORT_SCHEDULE","RETENTION_ENGINE"],[]),{
    affectedTenants:3,featureGrantedTenants:0,featureRevokedTenants:3,grantedFeatures:[],revokedFeatures:["REPORT_SCHEDULE","RETENTION_ENGINE"],
  });
});

test("multi-country postcode tables are structurally present but imports remain licence-gated",()=>{
  for(const table of ["bms_master_countries","bms_master_currencies","bms_master_timezones","bms_master_au_states","bms_master_au_suburbs","bms_master_uk_postcodes"]){
    assert.match(migration,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration,/address_dataset_status IN \('READY','REVIEW_REQUIRED','BLOCKED'\)/);
  assert.match(migration,/No AU\/UK locality rows may be imported until both residency/);
  assert.doesNotMatch(migration,/INSERT INTO bms_master_(?:au_states|au_suburbs|uk_postcodes)/);
  assert.match(corrections,/SELECT 'GB'/);
  assert.match(corrections,/SET country_code='GB' WHERE country_code='UK'/);
  assert.match(read("apps/web/lib/bms/platformSettings.ts"),/code: "GB"/);
  assert.match(issueSync,/bms_store_profile_reference_issues_trg/);
  assert.match(issueSync,/ON CONFLICT\(tenant_id,field,raw_value\) DO UPDATE SET resolved_at=NULL/);
});

test("Retail Local contract remains release-owned and plan edits cannot add operational sanctions",()=>{
  const capabilities=read("apps/web/lib/bms/storeCapabilities.ts");
  const archetypes=read("apps/web/lib/bms/shopArchetypes.ts");
  assert.match(archetypes,/shop-archetypes\.json/);
  assert.doesNotMatch(capabilities,/bms_master_archetype_presets/);
  assert.doesNotMatch(migration,/UPDATE bms_tenants SET active=false|UPDATE bms_pos_devices SET active=false/i);
});

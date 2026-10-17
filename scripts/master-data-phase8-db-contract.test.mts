import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Pool } from "./testing/pg.mjs";
import { upsertStoreProfile } from "../apps/web/lib/bms/storeProfile.ts";
import { closeDatabasePool } from "../apps/web/lib/db.ts";

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || "appdb",
  user: process.env.POSTGRES_USER || "app",
  password: process.env.POSTGRES_PASSWORD || "app",
  max: 1,
});

test.after(async () => pool.end());
test.after(async () => closeDatabasePool());

test("partial locale repairs preserve other unmapped legacy values and keep the issue ledger", async () => {
  const tenantId = randomUUID();
  try {
    await pool.query(`INSERT INTO bms_tenants(id,name,slug) VALUES($1,'FAKE locale repair',$2)`, [tenantId,`phase8-${tenantId}`]);
    await pool.query(`INSERT INTO bms_store_profile(tenant_id,country,currency,timezone)
      VALUES($1,'Atlantis','ZZZ','Mars/Olympus')`, [tenantId]);
    const profile = await upsertStoreProfile(tenantId,{currency:"THB"});
    assert.equal(profile.currency,"THB");
    assert.equal(profile.country,"Atlantis");
    assert.equal(profile.timezone,"Mars/Olympus");
    assert.deepEqual((await pool.query(`SELECT field FROM bms_master_reference_backfill_issues
      WHERE tenant_id=$1 AND resolved_at IS NULL ORDER BY field`,[tenantId])).rows,[{field:"country"},{field:"timezone"}]);
    await assert.rejects(() => upsertStoreProfile(tenantId,{timezone:"Mars/Olympus"}),/เขตเวลาไม่อยู่ในข้อมูลกลาง/);
  } finally {
    await pool.query(`DELETE FROM bms_tenants WHERE id=$1`,[tenantId]);
  }
});

test("report and service-day SQL falls back for unknown timezones and honors validated codes", async () => {
  for (const module of ["reports","menuAvailability","restaurantCustomer","restaurantOrdering","restaurantWaitlist","pharmacyCustomer"]) {
    const source = readFileSync(new URL(`../apps/web/lib/bms/${module}.ts`,import.meta.url),"utf8");
    const expression = source.match(/COALESCE\(\(SELECT tz\.name[\s\S]*?'Asia\/Bangkok'\)/)?.[0];
    assert.ok(expression,`${module} must validate the SQL timezone`);
    const tenantId=randomUUID();
    for (const [legacy,code,expected] of [
      ["Mars/Olympus",null,"Asia/Bangkok"],
      ["",null,"Asia/Bangkok"],
      ["Asia/Bangkok",null,"Asia/Bangkok"],
      ["Europe/London",null,"Europe/London"],
      [" Europe/London ",null,"Europe/London"],
      ["Mars/Olympus","Australia/Sydney","Australia/Sydney"],
    ]) {
      const result = await pool.query(`WITH bms_store_profile AS (
        SELECT $1::uuid AS tenant_id,$2::text AS timezone,$3::text AS timezone_code
      ) SELECT ${expression} AS zone,
        ('2026-10-17 00:00:00+00'::timestamptz AT TIME ZONE ${expression})::text AS local_time
        FROM bms_store_profile profile`,[tenantId,legacy,code]);
      assert.equal(result.rows[0].zone,expected,`${module}: ${legacy}/${code}`);
      const expectedTime = expected==="Asia/Bangkok" ? "2026-10-17 07:00:00" : expected==="Australia/Sydney" ? "2026-10-17 11:00:00" : "2026-10-17 01:00:00";
      assert.equal(result.rows[0].local_time,expectedTime,module);
    }
  }
});

test("phase 8 global references use ISO codes and remain read-only to bms_app", async () => {
  const tables = [
    "bms_master_countries", "bms_master_currencies", "bms_master_timezones",
    "bms_master_au_states", "bms_master_au_suburbs", "bms_master_uk_postcodes",
    "bms_master_ai_rates",
  ];
  const meta = await pool.query(`SELECT c.relname,c.relrowsecurity,
      EXISTS(SELECT 1 FROM information_schema.columns column_meta
        WHERE column_meta.table_schema='public' AND column_meta.table_name=c.relname
          AND column_meta.column_name='tenant_id') AS has_tenant
    FROM pg_class c WHERE c.relname=ANY($1::text[])`, [tables]);
  assert.equal(meta.rowCount, tables.length);
  for (const row of meta.rows) {
    assert.equal(row.relrowsecurity, false);
    assert.equal(row.has_tenant, false);
  }
  const codes = await pool.query(`SELECT code,active FROM bms_master_countries WHERE code IN ('TH','AU','GB','UK') ORDER BY code`);
  assert.deepEqual(codes.rows.filter(row => row.active).map(row => row.code).sort(), ["AU", "GB", "TH"]);
  assert.equal(codes.rows.find(row => row.code === "UK")?.active, false);

  const grants = await pool.query(`SELECT table_name,privilege_type FROM information_schema.role_table_grants
    WHERE grantee='bms_app' AND table_name=ANY($1::text[])`, [tables]);
  for (const table of tables) {
    assert.deepEqual(grants.rows.filter(row => row.table_name === table).map(row => row.privilege_type).sort(), ["SELECT"]);
  }
});

test("legacy United Kingdom text maps to GB and unknown profile values stay reportable", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const profile = await client.query(`SELECT tenant_id,country,currency,timezone FROM bms_store_profile ORDER BY tenant_id LIMIT 1 FOR UPDATE`);
    if (!profile.rowCount) return;
    const tenantId = profile.rows[0].tenant_id;
    await client.query(`UPDATE bms_store_profile SET country='UK',currency='GBP',timezone='Europe/London' WHERE tenant_id=$1`, [tenantId]);
    const mapped = await client.query(`SELECT country_code,currency_code,timezone_code FROM bms_store_profile WHERE tenant_id=$1`, [tenantId]);
    assert.deepEqual(mapped.rows[0], { country_code: "GB", currency_code: "GBP", timezone_code: "Europe/London" });

    await client.query(`UPDATE bms_store_profile SET country='Atlantis',currency='ZZZ',timezone='Mars/Olympus' WHERE tenant_id=$1`, [tenantId]);
    const unknown = await client.query(`SELECT country_code,currency_code,timezone_code FROM bms_store_profile WHERE tenant_id=$1`, [tenantId]);
    assert.deepEqual(unknown.rows[0], { country_code: null, currency_code: null, timezone_code: null });
    const issues = await client.query(`SELECT field,raw_value FROM bms_master_reference_backfill_issues
      WHERE tenant_id=$1 AND resolved_at IS NULL ORDER BY field`, [tenantId]);
    assert.deepEqual(issues.rows, [
      { field: "country", raw_value: "Atlantis" },
      { field: "currency", raw_value: "ZZZ" },
      { field: "timezone", raw_value: "Mars/Olympus" },
    ]);

    await client.query(`UPDATE bms_store_profile SET country='TH',currency='THB',timezone='Asia/Bangkok' WHERE tenant_id=$1`, [tenantId]);
    assert.equal(Number((await client.query(`SELECT count(*) FROM bms_master_reference_backfill_issues
      WHERE tenant_id=$1 AND resolved_at IS NULL`, [tenantId])).rows[0].count), 0);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});

test("bms_app AI-rate inserts create one non-overlapping effective timeline", async () => {
  const client = await pool.connect();
  const provider = `phase8-${randomUUID()}`;
  const model = "contract-model";
  const first = new Date(Date.now() + 60 * 60 * 1000);
  const second = new Date(first.getTime() + 60 * 60 * 1000);
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bms_app");
    await client.query(`SELECT * FROM public.add_bms_ai_rate($1,$2,1,2,1,1,$3,'contract','phase8')`, [provider, model, second]);
    await client.query(`SELECT * FROM public.add_bms_ai_rate($1,$2,3,4,1,1,$3,'contract','phase8')`, [provider, model, first]);
    const rows = await client.query(`SELECT effective_from,effective_to FROM bms_master_ai_rates
      WHERE provider=$1 AND model=$2 ORDER BY effective_from`, [provider, model]);
    assert.equal(rows.rowCount, 2);
    assert.equal(new Date(rows.rows[0].effective_to).toISOString(), second.toISOString());
    assert.equal(rows.rows[1].effective_to, null);
    await assert.rejects(
      () => client.query(`INSERT INTO bms_master_ai_rates(provider,model,input_usd_per_million,output_usd_per_million,effective_from,source,source_version)
        VALUES($1,$2,1,1,$3,'forbidden','phase8')`, [provider, model, new Date(second.getTime() + 60 * 60 * 1000)]),
      (error: any) => error?.code === "42501"
    );
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});

test("plan updates are version-checked and callable by bms_app only through the narrow function", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const plan = await client.query(`SELECT * FROM bms_plans ORDER BY sort,code LIMIT 1 FOR UPDATE`);
    assert.equal(plan.rowCount, 1);
    const row = plan.rows[0];
    await client.query("SET LOCAL ROLE bms_app");
    const args = [
      row.code, row.version, row.name, row.price_monthly, row.max_products,
      row.max_channels, row.max_orders_month, row.max_users, row.max_branches,
      row.max_devices, row.max_ai_messages_month, row.ai_credits_monthly, row.feature_keys,
    ];
    const updated = await client.query(`SELECT * FROM public.update_bms_plan_catalog(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[])`, args);
    assert.equal(updated.rowCount, 1);
    assert.equal(updated.rows[0].version, row.version + 1);
    const stale = await client.query(`SELECT * FROM public.update_bms_plan_catalog(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[])`, args);
    assert.equal(stale.rowCount, 0);
    await assert.rejects(
      () => client.query(`UPDATE bms_plans SET name=name WHERE code=$1`, [row.code]),
      (error: any) => error?.code === "42501"
    );
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});

test("the unresolved-reference ledger is tenant isolated", async () => {
  const meta = await pool.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class
    WHERE relname='bms_master_reference_backfill_issues'`);
  assert.deepEqual(meta.rows[0], { relrowsecurity: true, relforcerowsecurity: true });
  const policy = await pool.query(`SELECT qual,with_check FROM pg_policies
    WHERE schemaname='public' AND tablename='bms_master_reference_backfill_issues'`);
  assert.equal(policy.rowCount, 1);
  assert.match(String(policy.rows[0].qual), /bms\.tenant_id/);
  assert.match(String(policy.rows[0].with_check), /bms\.tenant_id/);
});

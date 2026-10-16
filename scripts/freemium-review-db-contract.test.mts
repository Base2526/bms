import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from '../apps/web/node_modules/pg/lib/index.js';

test('freemium review: admission races, rollback and sample quota on disposable PostgreSQL', async t => {
  assert.ok(['localhost','127.0.0.1'].includes(process.env.POSTGRES_HOST ?? ''));
  assert.equal(process.env.POSTGRES_DB, 'bms_freemium_test');
  const schema = `review_test_${randomUUID().replaceAll('-','')}`;
  const pool = new pg.Pool({ host:process.env.POSTGRES_HOST, port:Number(process.env.POSTGRES_PORT),
    database:process.env.POSTGRES_DB, user:process.env.POSTGRES_USER, password:process.env.POSTGRES_PASSWORD,
    options:`-c search_path=${schema},public`, application_name:schema });
  const dbGlobal=globalThis as any, previousPool=dbGlobal.__bmsPostgresPool;
  const deployment=process.env.BMS_DEPLOYMENT_MODE;
  delete process.env.BMS_DEPLOYMENT_MODE;
  dbGlobal.__bmsPostgresPool=pool;
  try {
    await pool.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bms_app') THEN
      CREATE ROLE bms_app NOLOGIN NOBYPASSRLS; END IF; END $$`);
    await pool.query(`CREATE SCHEMA ${schema}; GRANT USAGE ON SCHEMA ${schema} TO bms_app;
      CREATE TABLE bms_tenants(id uuid PRIMARY KEY,plan text NOT NULL,feature_policy_version smallint DEFAULT 1);
      CREATE TABLE bms_plans(code text PRIMARY KEY,name text,price_monthly numeric,max_products int,
        max_channels int,max_orders_month int,max_users int,max_ai_messages_month int,sort int);
      CREATE TABLE bms_ai_usage_monthly(tenant_id uuid,year_month text,count int DEFAULT 0,updated_at timestamptz,
        PRIMARY KEY(tenant_id,year_month));
      CREATE TABLE users(id uuid PRIMARY KEY,tenant_id uuid,role_id uuid);
      CREATE TABLE roles(id uuid PRIMARY KEY,name text);
      CREATE TABLE notifications(id uuid,user_id uuid,type text,title text,message text,entity_type text,
        entity_id uuid,data jsonb,is_read boolean,created_at timestamptz);
      CREATE TABLE bms_audit_log(id bigserial PRIMARY KEY,tenant_id uuid,actor text,action text,target text,meta jsonb);
      CREATE TABLE bms_products(tenant_id uuid,sku text);
      CREATE TABLE bms_sample_runs(id uuid,tenant_id uuid,status text);
      CREATE TABLE bms_store_profile(tenant_id uuid,business_archetype text);
      INSERT INTO bms_plans VALUES ('free','Free',0,100,-1,-1,2,100,1),('pro','Pro',599,-1,-1,-1,5,1000,2),
        ('business','Business',1990,-1,-1,-1,20,-1,3);`);
    for (const file of ['7.27__bms_ai_credit_usage.sql','7.82__bms_ai_usage_accounting.sql',
      '10.54__bms_ai_cost_budget.sql','10.55__bms_ai_limit_notices.sql']) {
      await pool.query(await readFile(new URL(`../db/migrations/${file}`,import.meta.url),'utf8'));
    }
    await pool.query(`UPDATE bms_plans SET ai_credits_monthly=max_ai_messages_month;
      GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA ${schema} TO bms_app;
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO bms_app;`);
    const { getAiUsage,tryConsumeAiQuota,recordByokAiUsage,recordSharedAiRetryUsage,recordAiFallback,adjustAiCredits } =
      await import('../apps/web/lib/bms/aiUsage');
    const { changePlan,enforceProductQuota }=await import('../apps/web/lib/bms/plans');
    const { createStarterCatalog }=await import('../apps/web/lib/bms/sampleData');
    const { beginTenantTx }=await import('../apps/web/lib/bms/tenant');
    const tenant=randomUUID(), other=randomUUID(), actor=randomUUID();
    await pool.query("INSERT INTO bms_tenants(id,plan) VALUES($1,'pro'),($2,'free')",[tenant,other]);
    await t.test('plan mutation is tenant-scoped, preserves legacy and rolls back if its audit fails',async()=>{
      await pool.query("ALTER TABLE bms_audit_log ADD CONSTRAINT reject_plan CHECK(action <> 'plan.change') NOT VALID");
      await assert.rejects(changePlan(tenant,'business',actor),(e:any)=>e.code==='23514');
      assert.equal((await pool.query('SELECT plan FROM bms_tenants WHERE id=$1',[tenant])).rows[0].plan,'pro');
      await pool.query('ALTER TABLE bms_audit_log DROP CONSTRAINT reject_plan');
      assert.equal(await changePlan(tenant,'business',actor),true);
      assert.equal((await pool.query('SELECT feature_policy_version FROM bms_tenants WHERE id=$1',[tenant])).rows[0].feature_policy_version,1);
      assert.equal((await pool.query('SELECT plan FROM bms_tenants WHERE id=$1',[other])).rows[0].plan,'free');
      assert.equal((await pool.query('SELECT actor FROM bms_audit_log WHERE tenant_id=$1',[tenant])).rows[0].actor,actor);
    });
    // Every grant-writing path must wait for a concurrent plan change, then read its committed plan.
    const operations = {
      consume:()=>tryConsumeAiQuota(tenant), usage:()=>getAiUsage(tenant),
      byok:()=>recordByokAiUsage(tenant), retry:()=>recordSharedAiRetryUsage(tenant),
      fallback:()=>recordAiFallback(tenant,'quota_exhausted'), adjustment:()=>adjustAiCredits(tenant,1),
    };
    for (const [name,operation] of Object.entries(operations)) {
      await t.test(`${name} cannot reconcile stale Business allowance after downgrade`,async()=>{
        await changePlan(tenant,'business',actor);
        await getAiUsage(tenant);
        await pool.query('UPDATE bms_ai_usage_monthly SET credits_consumed=100,credits_adjusted=0 WHERE tenant_id=$1',[tenant]);
        const blocker=await pool.connect();
        let pending:Promise<any>|undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query("UPDATE bms_tenants SET plan='free' WHERE id=$1",[tenant]);
          pending=operation();
          // Observe a real row-lock wait, not a timing assumption about JS scheduling.
          let waiting=false;
          for(let attempt=0;attempt<100;attempt++) {
            waiting=(await pool.query(`SELECT 1 FROM pg_stat_activity WHERE application_name=$1
              AND wait_event_type='Lock' AND query LIKE '%bms_tenants%'`,[schema])).rowCount!>0;
            if(waiting) break;
            await new Promise(resolve=>setTimeout(resolve,10));
          }
          assert.ok(waiting,'admission must lock the tenant before reading the plan');
          await blocker.query('COMMIT');
          const result=await pending;
          if(name==='consume') assert.equal(result.ok,false);
          if(name==='usage') {assert.equal(result.planCode,'free');assert.equal(result.remaining,0);}
          const row=(await pool.query('SELECT * FROM bms_ai_usage_monthly WHERE tenant_id=$1',[tenant])).rows[0];
          assert.equal(row.credits_granted,100);
          assert.equal(row.credits_consumed,100,'old consumption must never reset');
          assert.equal(row.credits_adjusted,name==='adjustment'?1:0);
        } finally {
          await blocker.query('ROLLBACK'); blocker.release();
          await pending?.catch(()=>undefined);
        }
      });
    }
    await t.test('new Starter Catalog cannot exceed Cloud capacity or leave partial sample rows',async()=>{
      await pool.query("INSERT INTO bms_store_profile VALUES($1,'mini_mart')",[other]);
      await pool.query('INSERT INTO bms_products SELECT $1,n::text FROM generate_series(1,99) n',[other]);
      await assert.rejects(createStarterCatalog(other,actor),(e:any)=>e.code==='QUOTA_EXCEEDED');
      assert.equal((await pool.query('SELECT count(*)::int n FROM bms_products WHERE tenant_id=$1',[other])).rows[0].n,99);
      assert.equal((await pool.query('SELECT count(*)::int n FROM bms_sample_runs')).rows[0].n,0);
      const client=await pool.connect();
      try {
        await beginTenantTx(client,other);
        await client.query('SELECT id FROM bms_tenants WHERE id=$1 FOR UPDATE',[other]);
        await enforceProductQuota(other,client,1);
        await assert.rejects(enforceProductQuota(other,client,4),/100/);
      } finally {await client.query('ROLLBACK');client.release();}
    });
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end(); dbGlobal.__bmsPostgresPool=previousPool;
    if(deployment==null) delete process.env.BMS_DEPLOYMENT_MODE; else process.env.BMS_DEPLOYMENT_MODE=deployment;
  }
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from '../apps/web/node_modules/pg/lib/index.js';

test('phase two migration and real services on an isolated PostgreSQL schema', async t => {
  assert.ok(['localhost','127.0.0.1'].includes(process.env.POSTGRES_HOST ?? ''));
  assert.equal(process.env.POSTGRES_DB, 'bms_freemium_test', 'dedicated disposable database only');
  const schema = `feature_test_${randomUUID().replaceAll('-','')}`;
  const pool = new pg.Pool({ host:process.env.POSTGRES_HOST, port:Number(process.env.POSTGRES_PORT),
    database:process.env.POSTGRES_DB, user:process.env.POSTGRES_USER, password:process.env.POSTGRES_PASSWORD,
    options:`-c search_path=${schema},public` });
  const dbGlobal=globalThis as any, previousPool=dbGlobal.__bmsPostgresPool;
  dbGlobal.__bmsPostgresPool=pool;
  const legacy=randomUUID(), free=randomUUID(), pro=randomUUID(), business=randomUUID(), actor=randomUUID();
  const migration=await readFile(new URL('../db/migrations/10.74__bms_feature_access.sql',import.meta.url),'utf8');
  try {
    await pool.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bms_app') THEN
      CREATE ROLE bms_app NOLOGIN NOBYPASSRLS; END IF; END $$`);
    await pool.query(`CREATE SCHEMA ${schema}; GRANT USAGE ON SCHEMA ${schema} TO bms_app;
      CREATE TABLE bms_tenants(id uuid PRIMARY KEY,plan text NOT NULL);
      CREATE TABLE users(id uuid PRIMARY KEY);
      CREATE TABLE roles(id uuid PRIMARY KEY,name text);
      CREATE TABLE bms_role_permissions(tenant_id uuid,role_id uuid,permission text,UNIQUE(tenant_id,role_id,permission));
      CREATE TABLE bms_customers(id uuid PRIMARY KEY,tenant_id uuid,name text,phone text,deleted_at timestamptz);
      CREATE TABLE bms_orders(id uuid PRIMARY KEY,tenant_id uuid,customer_id uuid,channel text,total_amount numeric,status text,created_at timestamptz);
      CREATE TABLE bms_order_items(order_id uuid,product_sku text);
      CREATE TABLE bms_customer_identities(tenant_id uuid,customer_id uuid,channel text,created_at timestamptz);
      CREATE TABLE bms_audit_log(id bigserial PRIMARY KEY,tenant_id uuid,actor text,action text,target text,meta jsonb);
      GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA ${schema} TO bms_app;
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO bms_app;`);
    for (const file of ['7.37__bms_report_subscriptions.sql','9.14__bms_retention_engine.sql']) {
      await pool.query(await readFile(new URL(`../db/migrations/${file}`,import.meta.url),'utf8'));
    }
    await pool.query('INSERT INTO users VALUES($1)',[actor]);
    await pool.query("INSERT INTO bms_tenants VALUES($1,'free')",[legacy]);
    const {getTenantFeatureAccess,requirePackageFeature}=await import('../apps/web/lib/bms/featureAccess');
    const {upsertReportSubscription,getReportSubscription}=await import('../apps/web/lib/bms/reportDigest');
    const {refreshRetentionCases,listRetentionCases,transitionRetentionCase,getRetentionAnalytics}=await import('../apps/web/lib/bms/retention');
    const {beginTenantTx}=await import('../apps/web/lib/bms/tenant');
    await t.test('pre-migration code preserves access; rerunning freezes only original shops',async()=>{
      assert.ok((await getTenantFeatureAccess(legacy)).every(f=>f.source==='LEGACY'));
      await pool.query(migration);
      for(const [id,plan] of [[free,'free'],[pro,'pro'],[business,'business']]) {
        await pool.query('INSERT INTO bms_tenants(id,plan) VALUES($1,$2)',[id,plan]);
      }
      await pool.query(migration);
      const versions=(await pool.query('SELECT id,feature_policy_version AS v FROM bms_tenants')).rows;
      assert.equal(versions.find(r=>r.id===legacy).v,1);
      assert.ok(versions.filter(r=>r.id!==legacy).every(r=>r.v===2));
      assert.ok((await getTenantFeatureAccess(legacy)).every(f=>f.allowed));
      assert.ok((await getTenantFeatureAccess(free)).every(f=>!f.allowed));
      assert.deepEqual((await getTenantFeatureAccess(pro)).map(f=>f.allowed),[true,false]);
      assert.ok((await getTenantFeatureAccess(business)).every(f=>f.allowed));
      await assert.rejects(getTenantFeatureAccess(randomUUID()),/Tenant not found/);
    });
    await t.test('Free cannot create a schedule; legacy can; downgrade preserves the existing row',async()=>{
      const input={emailEnabled:false,enabled:false};
      await assert.rejects(upsertReportSubscription(free,input,actor),(e:any)=>e.code==='FEATURE_NOT_INCLUDED');
      await upsertReportSubscription(legacy,input,actor);
      await upsertReportSubscription(pro,input,actor);
      await pool.query("UPDATE bms_tenants SET plan='free' WHERE id=$1",[pro]);
      await upsertReportSubscription(pro,{sendHour:9},actor);
      assert.equal((await getReportSubscription(pro)).sendHour,9);
      assert.equal((await getTenantFeatureAccess(pro))[0].source,'EXISTING_WORK');
      assert.equal((await getTenantFeatureAccess(free))[0].allowed,false);
      assert.equal((await pool.query('SELECT count(*)::int n FROM bms_audit_log WHERE action=$1',['report.subscription.upsert'])).rows[0].n,3);
    });
    await t.test('failed audit rolls back the real subscription update',async()=>{
      await pool.query("ALTER TABLE bms_audit_log ADD CONSTRAINT test_audit_reject CHECK(action <> 'report.subscription.upsert') NOT VALID");
      try {
        await assert.rejects(upsertReportSubscription(pro,{sendHour:10},actor),(e:any)=>e.code==='23514');
        assert.equal((await getReportSubscription(pro)).sendHour,9);
      } finally {await pool.query('ALTER TABLE bms_audit_log DROP CONSTRAINT test_audit_reject');}
    });
    await t.test('Business generates cases; downgrade retains reads, transitions and reconciliation, not new cases',async()=>{
      const customer=randomUUID();
      await pool.query('INSERT INTO bms_customers(id,tenant_id,name) VALUES($1,$2,$3)',[customer,business,'FAKE Customer']);
      await pool.query("INSERT INTO bms_orders VALUES($1,$2,$3,'pos',100,'COMPLETED',now()-interval '10 days')",[randomUUID(),business,customer]);
      assert.equal(await refreshRetentionCases(business,false,actor),1);
      const cases=await listRetentionCases(business);
      assert.equal(cases.length,1);
      await pool.query("UPDATE bms_tenants SET plan='free' WHERE id=$1",[business]);
      await assert.rejects(refreshRetentionCases(business,false,actor),(e:any)=>e.code==='FEATURE_NOT_INCLUDED');
      assert.equal(await refreshRetentionCases(business,true,actor),0);
      const item=cases[0];
      // Deterministic treatment fixture, regardless of the random customer's holdout hash.
      await pool.query("UPDATE bms_retention_cases SET cohort='TREATMENT' WHERE id=$1",[item.id]);
      await transitionRetentionCase(business,item.id,actor,'ACCEPTED');
      await transitionRetentionCase(business,item.id,actor,'CONTACTED');
      await pool.query("INSERT INTO bms_orders VALUES($1,$2,$3,'pos',250,'COMPLETED',now())",[randomUUID(),business,customer]);
      await refreshRetentionCases(business,true,actor);
      assert.equal((await listRetentionCases(business))[0].status,'CONVERTED');
      const analytics=await getRetentionAnalytics(business);
      assert.equal(analytics.treatmentTotal+analytics.holdoutTotal,1);
      assert.equal(analytics.retentionRevenue,250);
      assert.equal((await listRetentionCases(free)).length,0);
      await assert.rejects(transitionRetentionCase(free,item.id,actor,'ACCEPTED'),/case not found/);
    });
    await t.test('tenant transaction locks plan admission and RLS still denies foreign schedule writes',async()=>{
      const client=await pool.connect(), other=await pool.connect();
      try {
        await beginTenantTx(client,legacy);
        await requirePackageFeature(legacy,'REPORT_SCHEDULE',client);
        await other.query("SET lock_timeout='100ms'");
        await assert.rejects(other.query("UPDATE bms_tenants SET plan='business' WHERE id=$1",[legacy]),(e:any)=>e.code==='55P03');
        await assert.rejects(client.query('UPDATE bms_report_subscriptions SET tenant_id=$1 WHERE tenant_id=$2',[free,legacy]),(e:any)=>e.code==='42501');
      } finally { await client.query('ROLLBACK'); client.release(); await other.query("SET lock_timeout='0'"); other.release(); }
    });
    await t.test('migration rerun after activity cannot grant new Free shops legacy access',async()=>{
      await pool.query(migration);
      assert.ok((await getTenantFeatureAccess(free)).every(f=>!f.allowed));
      assert.equal((await getTenantFeatureAccess(business))[1].allowed,false);
      assert.ok((await getTenantFeatureAccess(legacy)).every(f=>f.source==='LEGACY'));
    });
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end(); dbGlobal.__bmsPostgresPool=previousPool;
  }
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from '../apps/web/node_modules/pg/lib/index.js';

test('capacity and package evidence: real services in disposable PostgreSQL only', async t => {
  assert.ok(['localhost','127.0.0.1'].includes(process.env.POSTGRES_HOST ?? ''));
  assert.equal(process.env.POSTGRES_DB,'bms_freemium_test');
  const schema=`capacity_test_${randomUUID().replaceAll('-','')}`;
  const pool=new pg.Pool({host:process.env.POSTGRES_HOST,port:Number(process.env.POSTGRES_PORT),database:process.env.POSTGRES_DB,
    user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,options:`-c search_path=${schema},public`});
  const globals=globalThis as any,previous=globals.__bmsPostgresPool;
  globals.__bmsPostgresPool=pool;
  const actor=randomUUID(),legacy=randomUUID(),free=randomUUID(),pro=randomUUID(),business=randomUUID();
  const migration=await readFile(new URL('../db/migrations/10.75__bms_capacity_and_package_metrics.sql',import.meta.url),'utf8');
  try {
    await pool.query(`CREATE SCHEMA ${schema}; GRANT USAGE ON SCHEMA ${schema} TO bms_app;
      CREATE TABLE bms_plans(code text PRIMARY KEY,name text,price_monthly numeric,max_products int,max_users int,max_channels int,max_orders_month int,max_ai_messages_month int,sort int);
      INSERT INTO bms_plans VALUES('free','Free',0,100,2,1,-1,100,0),('pro','Pro',599,-1,5,3,-1,1000,1),('business','Business',1990,-1,20,-1,-1,5000,2);
      CREATE TABLE bms_tenants(id uuid PRIMARY KEY,plan text,slug text,feature_policy_version int DEFAULT 2,created_at timestamptz DEFAULT now());
      CREATE TABLE bms_locations(id uuid PRIMARY KEY,tenant_id uuid,code text,name text,branch_code text,address text,phone text,active boolean,
        is_head_office boolean,parking_info jsonb,updated_at timestamptz,
        province_code text,district_code text,subdistrict_code text,province text,district text,subdistrict text,postcode text,
        UNIQUE(tenant_id,code),UNIQUE(tenant_id,id));
      CREATE TABLE bms_user_allowed_locations(tenant_id uuid,user_id uuid,location_id uuid);
      CREATE TABLE bms_pos_devices(id uuid PRIMARY KEY,tenant_id uuid,location_id uuid,code text,name text,registered_pos_no text,receipt_prefix text,
        scanner_mode text,scanner_prefix_key text,scanner_suffix_key text,scanner_max_gap_ms int,active boolean,updated_at timestamptz,UNIQUE(tenant_id,code),
        FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id));
      CREATE TABLE bms_tenant_channels(tenant_id uuid,channel text,access_token text,channel_secret text,active boolean,extra jsonb,updated_at timestamptz,UNIQUE(tenant_id,channel));
      CREATE TABLE bms_report_subscriptions(tenant_id uuid);
      CREATE TABLE bms_audit_log(tenant_id uuid,actor text,action text,target text,meta jsonb,created_at timestamptz DEFAULT now());
      CREATE TABLE bms_ai_usage_events(tenant_id uuid,provider text,source text,provider_calls int,unpriced_provider_calls int,actual_cost_usd numeric,created_at timestamptz);
      GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA ${schema} TO bms_app;`);
    await pool.query("INSERT INTO bms_tenants(id,plan,slug) VALUES($1,'free','fixture-legacy')",[legacy]);
    const {upsertLocation}=await import('../apps/web/lib/bms/locations');
    const {upsertPosDevice}=await import('../apps/web/lib/bms/pos');
    const {upsertChannel}=await import('../apps/web/lib/bms/channels');
    const {getTenantEntitlements,changePlan}=await import('../apps/web/lib/bms/entitlements');
    const {recordPackageSignup,getPackageMetrics}=await import('../apps/web/lib/bms/packageMetrics');
    const {beginTenantTx}=await import('../apps/web/lib/bms/tenant');
    const branch=(tid:string,key:string)=>upsertLocation(tid,{code:key,name:key,branchCode:key,active:false},actor);
    const device=(tid:string,locationId:string,key:string)=>upsertPosDevice(tid,{locationId,code:key,active:false},{editorId:actor,auditActor:actor});
    const channel=(tid:string,key:string)=>upsertChannel(tid,key,{active:false},actor);
    const oldBranch=await branch(legacy,'L1');
    await device(legacy,oldBranch.id,'D1'); await channel(legacy,'web');
    const fingerprint=async()=>JSON.stringify((await pool.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY code) FROM bms_locations l WHERE tenant_id=$1) locations,
      (SELECT jsonb_agg(to_jsonb(d) ORDER BY code) FROM bms_pos_devices d WHERE tenant_id=$1) devices,
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY channel) FROM bms_tenant_channels c WHERE tenant_id=$1) channels`,[legacy])).rows);
    const before=await fingerprint();
    await t.test('migration preserves every old resource byte; repeat never re-grandfathers',async()=>{
      await pool.query(migration);
      for(const [id,plan] of [[free,'free'],[pro,'pro'],[business,'business']]) await pool.query('INSERT INTO bms_tenants(id,plan,slug) VALUES($1::uuid,$2,$3)',[id,plan,id]);
      await pool.query(migration);
      assert.equal(await fingerprint(),before);
      const rows=(await pool.query('SELECT id,capacity_policy_version v FROM bms_tenants')).rows;
      assert.equal(rows.find(r=>r.id===legacy).v,1);assert.ok(rows.filter(r=>r.id!==legacy).every(r=>r.v===2));
      assert.equal((await pool.query('SELECT count(*)::int n FROM bms_package_events')).rows[0].n,1);
    });
    await t.test('legacy retains all three categories; fresh Free denies only extra registrations',async()=>{
      await branch(legacy,'L2'); await device(legacy,oldBranch.id,'D2');await channel(legacy,'line');
      assert.ok((await getTenantEntitlements(legacy)).capacities.every(r=>r.source==='LEGACY'&&r.limit===-1));
      const b=await branch(free,'L1');await device(free,b.id,'D1');await channel(free,'web');
      for(const action of [()=>branch(free,'L2'),()=>device(free,b.id,'D2'),()=>channel(free,'line')]) {
        await assert.rejects(action,(e:any)=>e.code==='PACKAGE_CAPACITY_EXCEEDED');
      }
      await upsertLocation(free,{id:b.id,code:'L1',name:'Updated',branchCode:'L1',active:true},actor);
      await upsertPosDevice(free,{locationId:b.id,code:'D1',active:true});await upsertChannel(free,'web',{active:true},actor);
      assert.ok((await getTenantEntitlements(free)).capacities.every(r=>r.used===1&&!r.canAdd));
    });
    await t.test('parallel admissions cannot overrun Pro; Business uses the agreed matrix',async()=>{
      const p=await branch(pro,'L1');await assert.rejects(branch(pro,'L2'));
      const attempts=await Promise.allSettled(Array.from({length:8},(_,i)=>device(pro,p.id,`D${i}`)));
      assert.equal(attempts.filter(r=>r.status==='fulfilled').length,3);
      const channels=await Promise.allSettled(['web','line','facebook','instagram','tiktok'].map(c=>channel(pro,c)));
      assert.equal(channels.filter(r=>r.status==='fulfilled').length,3);
      const branches=await Promise.allSettled(Array.from({length:8},(_,i)=>branch(business,`L${i}`)));
      assert.equal(branches.filter(r=>r.status==='fulfilled').length,5);
      const b=(branches.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value;
      const devices=await Promise.allSettled(Array.from({length:13},(_,i)=>device(business,b.id,`D${i}`)));
      assert.equal(devices.filter(r=>r.status==='fulfilled').length,10);
      for(const c of ['web','line','facebook','instagram','tiktok','shopee','lazada']) await channel(business,c);
      const limits=(await getTenantEntitlements(business)).capacities.map(r=>r.limit);assert.deepEqual(limits,[5,10,-1]);
    });
    await t.test('downgrade keeps registrations editable and isolated; audit and plan change are atomic',async()=>{
      await changePlan(business,'free',actor);
      const b=(await pool.query('SELECT id,code FROM bms_locations WHERE tenant_id=$1 LIMIT 1',[business])).rows[0];
      await upsertLocation(business,{id:b.id,code:b.code,name:'Still works',branchCode:b.code,active:true},actor);
      await device(business,b.id,'D0');await channel(business,'line');
      await assert.rejects(device(business,b.id,'NEW'),(e:any)=>e.code==='PACKAGE_CAPACITY_EXCEEDED');
      await assert.rejects(device(free,b.id,'D1'),(e:any)=>e.code==='23503');
      await pool.query("ALTER TABLE bms_audit_log ADD CONSTRAINT reject_audit CHECK(action<>'plan.change') NOT VALID");
      try {await assert.rejects(changePlan(business,'pro',actor));} finally {await pool.query('ALTER TABLE bms_audit_log DROP CONSTRAINT reject_audit');}
      assert.equal((await pool.query('SELECT plan FROM bms_tenants WHERE id=$1',[business])).rows[0].plan,'free');
    });
    await t.test('cohorts deduplicate retries, distinguish legacy, and never confuse payment/cost with grants',async()=>{
      await recordPackageSignup(free);await recordPackageSignup(free);
      await Promise.all([changePlan(free,'pro',actor),changePlan(free,'pro',actor)]);
      await changePlan(free,'free',actor);await changePlan(free,'business',actor);
      await changePlan(legacy,'pro',actor);
      // A blocked zero-call event must not mask unknown cost on a real provider attempt.
      await pool.query(`INSERT INTO bms_ai_usage_events VALUES($1,'fake','shared',1,1,NULL,now()),($1,'fake','shared',2,1,0.25,now()),
        ($1,'fake','byok',1,1,NULL,now()),($1,'fake','byok',0,0,0,now())`,[free]);
      const report=await getPackageMetrics(new Date(Date.now()-86400000).toISOString(),new Date(Date.now()+86400000).toISOString());
      assert.equal(report.cohorts.find(r=>r.kind==='SIGNUP')?.shops,1);
      assert.equal(report.cohorts.find(r=>r.kind==='SIGNUP')?.converted,1);
      assert.equal(report.cohorts.find(r=>r.kind==='BASELINE')?.converted,1);
      assert.equal(report.costs.find(r=>r.source==='shared')?.knownCostUsd,0.25);
      assert.equal(report.costs.find(r=>r.source==='shared')?.unpricedProviderCalls,2);
      assert.equal(report.costs.find(r=>r.source==='byok')?.knownCostUsd,null);
      assert.equal((await pool.query("SELECT count(*)::int n FROM bms_package_events WHERE tenant_id=$1 AND kind='PLAN_CHANGE'",[free])).rows[0].n,3);
      await assert.rejects(getPackageMetrics('invalid','also invalid'));
    });
    await t.test('event RLS and append-only grants reject cross-tenant writes and updates',async()=>{
      const client=await pool.connect();
      try {
        await beginTenantTx(client,free);
        assert.ok((await client.query('SELECT tenant_id FROM bms_package_events')).rows.every(r=>r.tenant_id===free));
        await assert.rejects(client.query("INSERT INTO bms_package_events(tenant_id,kind,to_plan) VALUES($1,'SIGNUP','free')",[pro]),(e:any)=>e.code==='42501');
        await client.query('ROLLBACK');await beginTenantTx(client,free);
        await assert.rejects(client.query("UPDATE bms_package_events SET to_plan='business' WHERE tenant_id=$1",[free]),(e:any)=>e.code==='42501');
        await client.query('ROLLBACK');
      } finally {client.release();}
    });
    await t.test('telemetry failure cannot undo a plan change; authoritative audit preserves conversion evidence',async()=>{
      await recordPackageSignup(pro);
      await changePlan(pro,'free',actor);
      await pool.query("ALTER TABLE bms_package_events ADD CONSTRAINT reject_telemetry CHECK(kind<>'PLAN_CHANGE') NOT VALID");
      try {await changePlan(pro,'business',actor);} finally {await pool.query('ALTER TABLE bms_package_events DROP CONSTRAINT reject_telemetry');}
      assert.equal((await pool.query('SELECT plan FROM bms_tenants WHERE id=$1',[pro])).rows[0].plan,'business');
      const report=await getPackageMetrics(new Date(Date.now()-86400000).toISOString(),new Date(Date.now()+86400000).toISOString());
      assert.equal(report.cohorts.find(r=>r.kind==='SIGNUP')?.converted,2);
    });
  } finally {
    globals.__bmsPostgresPool=previous;
    assert.match(schema,/^capacity_test_[a-f0-9]{32}$/);
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();
  }
});

// Opt-in integration rehearsal on a COPY of the restored database, never a synthetic schema.
// Retains fixture rows in this disposable copy for inspection. Never runs a migration itself.
import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import net from 'node:net';

test('freemium workflows on restored schema', {skip: process.env.BMS_RESTORED_REHEARSAL !== '1'}, async t => {
  assert.equal(process.env.POSTGRES_HOST, '127.0.0.1');
  assert.equal(process.env.POSTGRES_PORT, '55476');
  assert.ok(['bms_rehearsal_workflow_before','bms_rehearsal_workflow_after'].includes(process.env.POSTGRES_DB ?? ''));
  assert.equal(process.env.BMS_DEPLOYMENT_MODE, 'cloud');
  // Do not let restored credentials or indirect Redis/HTTP helpers reach another host.
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: any[]) {
    const raw = Array.isArray(args[0]) ? args[0][0] : args[0];
    const host = typeof raw === 'object' ? raw.host : typeof args[1] === 'string' ? args[1] : 'localhost';
    const port = Number(typeof raw === 'object' ? raw.port : raw);
    assert.ok(['127.0.0.1','localhost','::1'].includes(host ?? 'localhost') && [55476,1].includes(port), 'Non-local network prohibited');
    return connect.apply(this, args as any);
  } as any;
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('HTTP prohibited during restored rehearsal'); };
  t.after(() => { net.Socket.prototype.connect = connect; globalThis.fetch = fetchBefore; });

  const {query, getClient} = await import('../apps/web/lib/db');
  const {beginTenantTx} = await import('../apps/web/lib/bms/tenant');
  const {getTenantEntitlements, changePlan, getTenantPlan} = await import('../apps/web/lib/bms/entitlements');
  const {upsertLocation} = await import('../apps/web/lib/bms/locations');
  const {upsertChannel} = await import('../apps/web/lib/bms/channels');
  const {upsertPosDevice, openPosShift, recordPosSale, closePosShift, getPosShiftReport, issuePosDeviceToken} = await import('../apps/web/lib/bms/pos');
  const {upsertReportSubscription, getReportSubscription, computeSalesSummary} = await import('../apps/web/lib/bms/reportDigest');
  const {refreshRetentionCases, listRetentionCases, transitionRetentionCase} = await import('../apps/web/lib/bms/retention');
  const {getPackageMetrics, recordPackageSignup, recordPackageEventInTx} = await import('../apps/web/lib/bms/packageMetrics');
  assert.equal((await query("SELECT current_setting('bms.rehearsal',true) AS marker")).rows[0].marker, 'isolated-restored-copy');
  const rolled = !!(await query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bms_tenants' AND column_name='capacity_policy_version'")).rowCount;
  const old = (await query("SELECT id FROM bms_tenants WHERE slug NOT LIKE 'test-restored-%' AND slug NOT LIKE 'fixture-restored-%' ORDER BY id")).rows;
  await t.test('every restored shop keeps both legacy features and unlimited registered capacity', async () => {
    assert.ok(old.length > 0);
    for (const shop of old) {
      const result = await getTenantEntitlements(shop.id);
      assert.ok(result.features.every(f => f.allowed && f.source === 'LEGACY'));
      assert.ok(result.capacities.every(c => c.limit === -1 && c.source === 'LEGACY'));
    }
    t.diagnostic(`Restored shops checked: ${old.length}`);
  });

  async function shop(plan = 'free', legacy = false) {
    const id = (await query("INSERT INTO bms_tenants(name,slug,plan) VALUES('FAKE restored rehearsal',$1,$2) RETURNING id", [`test-restored-${randomUUID()}`,plan])).rows[0].id;
    if (legacy && rolled) await query('UPDATE bms_tenants SET feature_policy_version=1,capacity_policy_version=1 WHERE id=$1',[id]);
    const actor = (await query(`INSERT INTO users(tenant_id,role_id,role,name,email,password_hash,fake_test)
      SELECT $1,id,'Administrator','FAKE rehearsal owner',$2,'not-a-login',true FROM roles WHERE name='Administrator' LIMIT 1 RETURNING id`,[id,`fixture-${randomUUID()}@example.invalid`])).rows[0].id;
    return {id,actor};
  }
  const legacy = await shop('free', true);
  let branch: any, device: any;
  const sku = `FAKE-REHEARSAL-${randomUUID()}`;
  await t.test('legacy over-limit registrations remain editable and device pairing still works', async () => {
    branch = await upsertLocation(legacy.id,{code:'MAIN',name:'FAKE branch',branchCode:'00001',active:true},legacy.actor);
    await upsertLocation(legacy.id,{code:'SECOND',name:'FAKE second',branchCode:'00002',active:false},legacy.actor);
    device = await upsertPosDevice(legacy.id,{locationId:branch.id,code:'REG',active:false},{editorId:legacy.actor,auditActor:legacy.actor});
    await upsertPosDevice(legacy.id,{locationId:branch.id,code:'REG2',active:false},{editorId:legacy.actor,auditActor:legacy.actor});
    await upsertPosDevice(legacy.id,{locationId:branch.id,code:'REG',active:true},{editorId:legacy.actor,auditActor:legacy.actor});
    await upsertChannel(legacy.id,'web',{active:false},legacy.actor);
    await upsertChannel(legacy.id,'line',{active:false},legacy.actor);
    await upsertChannel(legacy.id,'web',{active:true},legacy.actor);
    await issuePosDeviceToken(legacy.id,device.id); // Never printed or used outside this DB.
    assert.ok((await getTenantEntitlements(legacy.id)).capacities.every(c=>c.used===2 && c.canAdd));
  });
  await t.test('sale, payment, stock, audit, outbox, replay and shift close remain operational', async () => {
    await query("INSERT INTO bms_store_profile(tenant_id,cash_rounding,pos_blind_close) VALUES($1,'NONE',false) ON CONFLICT(tenant_id) DO UPDATE SET cash_rounding='NONE',pos_blind_close=false",[legacy.id]);
    const seed = await getClient();
    try {
      await beginTenantTx(seed,legacy.id,{editorId:legacy.actor});
      await seed.query("INSERT INTO bms_products(tenant_id,sku,name,price,active,vat_category) VALUES($1,$2,'FAKE rehearsal item',100,true,'N')",[legacy.id,sku]);
      await seed.query("INSERT INTO bms_product_sales_surfaces(tenant_id,product_sku,surface) VALUES($1,$2,'RETAIL_POS')",[legacy.id,sku]);
      await seed.query("INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock) VALUES($1,$2,$3,'M',10,0)",[legacy.id,branch.id,sku]);
      await seed.query('COMMIT');
    } catch(e) { await seed.query('ROLLBACK'); throw e; } finally {seed.release();}
    const opened = await openPosShift({tenantId:legacy.id,deviceId:device.id,openedBy:legacy.actor,openingFloat:100});
    assert.equal(opened.status,'OPENED');
    if (opened.status !== 'OPENED') return;
    const input = {tenantId:legacy.id,deviceId:device.id,shiftId:opened.shift.id,cashierUserId:legacy.actor,
      idempotencyKey:randomUUID(),lines:[{sku,size:'M',packQty:2}],payments:[{method:'CASH' as const,amount:200,cashTendered:200}]};
    const sale = await recordPosSale(input);
    assert.equal(sale.status,'SOLD',JSON.stringify(sale));
    if(sale.status !== 'SOLD') return;
    const replay = await recordPosSale(input);
    assert.equal(replay.status,'SOLD');
    if(replay.status === 'SOLD') {assert.equal(replay.orderId,sale.orderId);assert.equal(replay.replayed,true);}
    assert.equal(Number((await query('SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3',[legacy.id,branch.id,sku])).rows[0].current_stock),8);
    for(const table of ['bms_payments','bms_stock_movements','bms_audit_log','bms_realtime_outbox']) {
      assert.ok(Number((await query(`SELECT count(*) AS n FROM ${table} WHERE tenant_id=$1`,[legacy.id])).rows[0].n)>0,table);
    }
    const report = await getPosShiftReport(legacy.id,opened.shift.id);
    assert.equal(report?.expectedCash,300);
    const closed = await closePosShift({tenantId:legacy.id,shiftId:opened.shift.id,closedBy:legacy.actor,countedCash:300});
    assert.equal(closed.status,'CLOSED');
  });
  await t.test('legacy report schedules save and render without delivering messages', async () => {
    await upsertReportSubscription(legacy.id,{enabled:false,emailEnabled:false,slackEnabled:false,lineEnabled:false},legacy.actor);
    await upsertReportSubscription(legacy.id,{sendHour:9},legacy.actor);
    assert.equal((await getReportSubscription(legacy.id)).sendHour,9);
    await computeSalesSummary(legacy.id,new Date(Date.now()-86400000),new Date(Date.now()+86400000));
  });
  await t.test('paid-to-free downgrade preserves existing reports and Retention actions', async () => {
    const paid = await shop('business');
    await upsertReportSubscription(paid.id,{enabled:false,emailEnabled:false},paid.actor);
    const paidBranch=await upsertLocation(paid.id,{code:'MAIN',name:'FAKE retention branch',branchCode:'00001'},paid.actor);
    const customer=(await query("INSERT INTO bms_customers(tenant_id,name) VALUES($1,'FAKE retention customer') RETURNING id",[paid.id])).rows[0].id;
    await query("INSERT INTO bms_orders(tenant_id,customer_id,location_id,channel,status,total_amount,created_at) VALUES($1,$2,$3,'test','COMPLETED',100,now()-interval '10 days')",[paid.id,customer,paidBranch.id]);
    assert.equal(await refreshRetentionCases(paid.id,false,paid.actor),1);
    const item=(await listRetentionCases(paid.id))[0];
    await query("UPDATE bms_retention_cases SET cohort='TREATMENT' WHERE tenant_id=$1 AND id=$2",[paid.id,item.id]);
    await changePlan(paid.id,'free',paid.actor);
    await upsertReportSubscription(paid.id,{sendHour:10},paid.actor);
    assert.equal((await getReportSubscription(paid.id)).sendHour,10);
    if(rolled) await assert.rejects(refreshRetentionCases(paid.id,false,paid.actor),(e:any)=>e.code==='FEATURE_NOT_INCLUDED');
    await transitionRetentionCase(paid.id,item.id,paid.actor,'ACCEPTED');
    await transitionRetentionCase(paid.id,item.id,paid.actor,'CONTACTED');
    await refreshRetentionCases(paid.id,true,paid.actor);
    assert.equal((await listRetentionCases(paid.id))[0].status,'CONTACTED');
  });
  await t.test('new Free admission and missing-migration compatibility are distinct', async () => {
    const fresh = await shop();
    const b=await upsertLocation(fresh.id,{code:'MAIN',name:'FAKE new branch',branchCode:'00001'},fresh.actor);
    const attempts=await Promise.allSettled(['REG1','REG2','REG3'].map(code=>upsertPosDevice(fresh.id,{locationId:b.id,code,active:false})));
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,rolled?1:3);
    if(rolled) {
      await assert.rejects(upsertReportSubscription(fresh.id,{enabled:false,emailEnabled:false},fresh.actor),(e:any)=>e.code==='FEATURE_NOT_INCLUDED');
      assert.ok((await getTenantEntitlements(fresh.id)).features.every(f=>!f.allowed));
      await recordPackageSignup(fresh.id);
      await changePlan(fresh.id,'pro',fresh.actor);
      await changePlan(fresh.id,'pro',fresh.actor);
      assert.equal((await query("SELECT count(*)::int n FROM bms_package_events WHERE tenant_id=$1 AND kind='PLAN_CHANGE'",[fresh.id])).rows[0].n,1);
      const client=await getClient();
      try {
        await beginTenantTx(client,fresh.id);
        assert.equal((await client.query('SELECT 1 FROM bms_package_events WHERE tenant_id=$1',[legacy.id])).rowCount,0);
        await assert.rejects(client.query("INSERT INTO bms_package_events(tenant_id,kind,to_plan) VALUES($1,'SIGNUP','free')",[legacy.id]),(e:any)=>e.code==='42501');
        await client.query('ROLLBACK');
      } finally {client.release();}
    }
    const metrics=await getPackageMetrics(new Date(Date.now()-86400000).toISOString(),new Date(Date.now()+86400000).toISOString());
    assert.equal(metrics.available,rolled);
  });
  await t.test('telemetry restores transaction timeouts and cannot undo the parent write on a table lock', {skip:!rolled}, async () => {
    const blocker=await getClient(),client=await getClient();
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE bms_package_events IN ACCESS EXCLUSIVE MODE');
      await beginTenantTx(client,legacy.id);
      await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='2s'");
      await client.query("UPDATE bms_tenants SET name='FAKE telemetry survived' WHERE id=$1",[legacy.id]);
      const started=Date.now();
      await recordPackageEventInTx(client,legacy.id,'SIGNUP','free');
      assert.ok(Date.now()-started<3000);
      assert.equal((await client.query('SHOW statement_timeout')).rows[0].statement_timeout,'5s');
      assert.equal((await client.query('SHOW lock_timeout')).rows[0].lock_timeout,'2s');
      await client.query('COMMIT');
      assert.equal((await query('SELECT name FROM bms_tenants WHERE id=$1',[legacy.id])).rows[0].name,'FAKE telemetry survived');
    } finally {await client.query('ROLLBACK');await blocker.query('ROLLBACK');client.release();blocker.release();}
    const business=(await query("SELECT * FROM bms_plans WHERE code='business'")).rows[0];
    const at=new Date(business.ai_credits_effective_at).getTime();
    const trial=await shop('business');
    assert.equal((await getTenantPlan(trial.id,undefined,at-1)).ai_credits_monthly,business.ai_credits_previous_monthly);
    assert.equal((await getTenantPlan(trial.id,undefined,at)).ai_credits_monthly,5000);
  });
  await t.test('real metrics count a signup conversion once and keep unknown cost null beside zero-call events', {skip:!rolled}, async () => {
    const from=new Date(Date.now()-86400000).toISOString(),to=new Date(Date.now()+86400000).toISOString();
    const before=await getPackageMetrics(from,to);
    const fixture=await shop();
    await query('UPDATE bms_tenants SET slug=$2 WHERE id=$1',[fixture.id,`fixture-restored-${randomUUID()}`]);
    await recordPackageSignup(fixture.id);
    await changePlan(fixture.id,'pro',fixture.actor);
    await changePlan(fixture.id,'free',fixture.actor);
    await changePlan(fixture.id,'pro',fixture.actor);
    await query(`INSERT INTO bms_ai_usage_events(tenant_id,year_month,source,surface,feature,provider,model,status,
      credits_used,billable_credits,provider_calls,unpriced_provider_calls,actual_cost_usd)
      VALUES($1,to_char(now() AT TIME ZONE 'Asia/Bangkok','YYYY-MM'),'byok','customer','chat','fake','fake','failed',0,0,1,1,NULL),
      ($1,to_char(now() AT TIME ZONE 'Asia/Bangkok','YYYY-MM'),'byok','customer','chat','fake','fake','blocked',0,0,0,0,0)`,[fixture.id]);
    const after=await getPackageMetrics(from,to);
    assert.equal(after.cohorts.find(c=>c.kind==='SIGNUP')?.shops,(before.cohorts.find(c=>c.kind==='SIGNUP')?.shops??0)+1);
    assert.equal(after.cohorts.find(c=>c.kind==='SIGNUP')?.converted,(before.cohorts.find(c=>c.kind==='SIGNUP')?.converted??0)+1);
    const cost=after.costs.find(c=>c.tenantId===fixture.id&&c.source==='byok');
    assert.equal(cost?.knownCostUsd,null);assert.equal(cost?.providerCalls,1);assert.equal(cost?.unpricedProviderCalls,1);
  });
});

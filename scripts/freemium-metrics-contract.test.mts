import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

test('restored rehearsal evidence is read-only, isolated, and refuses RLS-filtered snapshots',async()=>{
  const sql=await readFile(new URL('../db/checks/freemium-rehearsal-snapshot.sql',import.meta.url),'utf8');
  assert.match(sql,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(sql,/current_database\(\) <> 'bms_realtime_test'/);
  assert.match(sql,/rolname=current_user AND rolsuper/);
  assert.match(sql,/NOT rolbypassrls AND NOT rolsuper/);
  assert.match(sql,/FOREACH privilege IN ARRAY r.privileges/);
  assert.match(sql,/FINGERPRINT/);
  assert.match(sql,/c\.relkind IN \('r','p'\)/);
  assert.match(sql,/c\.relname NOT IN \('bms_plans','bms_package_events'\)/);
  assert.match(sql,/pg_get_triggerdef/);
  assert.match(sql,/ROLLBACK;\s*$/);
  // Source contract only: SQL execution against a restored schema is still required.
});

test('package telemetry is bounded, restores caller settings, and rolls back only its own work', async t => {
  const {recordPackageEventInTx}=await import('../apps/web/lib/bms/packageMetrics');
  for (const [statement,lock] of [['0','0'],['50','20'],['60000','5000']]) {
    await t.test(`success preserves caller timeouts ${statement}/${lock}`,async()=>{
      const calls:{sql:string;params:any[]}[]=[];
      const client={query:async(sql:string,params:any[]=[])=>{
        calls.push({sql,params});
        return {rows:sql.includes('FROM pg_settings')?[{name:'statement_timeout',setting:statement},{name:'lock_timeout',setting:lock}]
          :sql.includes('AS ready')?[{ready:true}]:[]};
      }} as any;
      await recordPackageEventInTx(client,'server-tenant','PLAN_CHANGE','pro','free','actor');
      const settings=calls.filter(c=>c.sql.includes("set_config('statement_timeout'"));
      assert.deepEqual(settings[0].params,[String(Number(statement)?Math.min(Number(statement),1000):1000),String(Number(lock)?Math.min(Number(lock),250):250)]);
      assert.deepEqual(settings[1].params,[statement,lock]);
      assert.deepEqual(calls.find(c=>c.sql.includes('INSERT INTO'))?.params,['server-tenant','PLAN_CHANGE','free','pro','actor']);
      assert.equal(calls.at(-1)?.sql,'RELEASE SAVEPOINT package_telemetry');
      assert.ok(!calls.some(c=>c.sql==='COMMIT'||c.sql==='ROLLBACK'));
    });
  }
  await t.test('lock timeout preserves the caller transaction and restores settings via savepoint',async()=>{
    const calls:string[]=[];
    const client={query:async(sql:string)=>{
      calls.push(sql);
      if(sql.includes('INSERT INTO'))throw Object.assign(Error('fixture lock timeout'),{code:'55P03'});
      return{rows:sql.includes('FROM pg_settings')?[{name:'statement_timeout',setting:'0'},{name:'lock_timeout',setting:'0'}]
        :sql.includes('AS ready')?[{ready:true}]:[]};
    }} as any;
    await recordPackageEventInTx(client,'server-tenant','SIGNUP','free');
    assert.deepEqual(calls.slice(-2),['ROLLBACK TO SAVEPOINT package_telemetry','RELEASE SAVEPOINT package_telemetry']);
    assert.ok(!calls.includes('ROLLBACK'));
  });
});

test('metrics boundary keeps missing migration and unknown cost distinct from zero',async()=>{
  // This module was imported above: replace the existing pool method, not a new global pool.
  const pool=(globalThis as any).__bmsPostgresPool;
  assert.ok(pool);
  const previous=pool.query;
  const {getPackageMetrics}=await import('../apps/web/lib/bms/packageMetrics');
  let ready=false;const calls:string[]=[];
  (pool as any).query=async(sql:string)=>{
    calls.push(sql);
    return{rows:sql.includes('AS ready')?[{ready}]:sql.includes('WITH transitions')?[]
      :sql.includes('SUM(e.provider_calls)')?[{tenant_id:'fixture',source:'shared',calls:1,unpriced:1,cost:null},
        {tenant_id:'fixture',source:'byok',calls:0,unpriced:0,cost:0}]:[{n:1}]};
  };
  try {
    const missing=await getPackageMetrics('2026-10-01T00:00:00Z','2026-11-01T00:00:00Z');
    assert.equal(missing.available,false);assert.equal(missing.untrackedTenants,null);assert.equal(calls.length,1);
    ready=true;calls.length=0;
    const report=await getPackageMetrics('2026-10-01T00:00:00Z','2026-11-01T00:00:00Z');
    assert.equal(report.costs[0].knownCostUsd,null);assert.equal(report.costs[1].knownCostUsd,0);
    assert.equal(report.costs[0].unpricedProviderCalls,1);
    assert.match(calls.find(s=>s.includes('SUM(e.provider_calls)'))!,/SUM\(e\.actual_cost_usd\) FILTER \(WHERE e\.provider_calls>0\)/);
    await assert.rejects(getPackageMetrics('2026-11-01','2026-10-01'),RangeError);
  } finally {(pool as any).query=previous;}
});

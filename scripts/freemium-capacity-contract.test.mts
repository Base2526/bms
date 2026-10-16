import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('capacity authority fails closed, preserves legacy/local, and uses server tenant',async()=>{
  const calls:{sql:string,args:any[]}[]=[];
  let version=2,exists=false,missing=false,fail=false;
  const run=async(sql:string,args:any[]=[])=>{
    calls.push({sql,args});if(fail)throw Error('database unavailable');
    const rows=sql.includes('capacity_policy_version')?(missing?[]:[{version}])
      :sql.includes('SELECT 1 FROM bms_pos_devices')?(exists?[{}]:[])
      :sql.includes('SELECT p.*')?[{code:'free',name:'Free',max_devices:1,max_ai_messages_month:100}]
      :sql.includes('COUNT(*)')?[{n:1}]:[];
    return{rows,rowCount:rows.length};
  };
  const globals=globalThis as any,prev=globals.__bmsPostgresPool,mode=process.env.BMS_DEPLOYMENT_MODE;
  globals.__bmsPostgresPool={query:run,connect:async()=>({query:run,release(){}})};
  const client={query:run} as any;
  try {
    delete process.env.BMS_DEPLOYMENT_MODE;
    const {requireCapacityForUpsert}=await import('../apps/web/lib/bms/entitlements');
    await assert.rejects(requireCapacityForUpsert('server-tenant','devices','NEW',client),(e:any)=>e.code==='PACKAGE_CAPACITY_EXCEEDED');
    assert.ok(calls.every(c=>c.args[0]==='server-tenant'));
    assert.match(calls[0].sql,/FOR UPDATE/);
    exists=true;calls.length=0;await requireCapacityForUpsert('server-tenant','devices','EXISTING',client);
    assert.equal(calls.length,2,'existing identity needs no current plan allowance');
    exists=false;version=1;calls.length=0;await requireCapacityForUpsert('server-tenant','devices','NEW',client);assert.equal(calls.length,1);
    version=2;process.env.BMS_DEPLOYMENT_MODE='retail-local';calls.length=0;
    await requireCapacityForUpsert('server-tenant','devices','NEW',client);assert.equal(calls.length,1);
    missing=true;await assert.rejects(requireCapacityForUpsert('missing','devices','NEW',client),/Tenant not found/);
    missing=false;fail=true;await assert.rejects(requireCapacityForUpsert('server-tenant','devices','NEW',client),/database unavailable/);
    fail=false;
    const {bmsSaasResolvers}=await import('../apps/web/graphql/bmsSaas');
    calls.length=0;
    await assert.rejects(bmsSaasResolvers.Query.bmsEntitlements(null,{},{}));assert.equal(calls.length,0);
    for(const ctx of [{},{scope:'admin',admin:{id:'actor',tenant_id:'server-tenant',is_platform_admin:true}}]) {
      await assert.rejects(bmsSaasResolvers.Query.bmsPackageMetrics(null,{from:'2026-10-01',to:'2026-11-01'},ctx));
    }
    assert.ok(!calls.some(c=>c.sql.includes('FROM bms_package_events')),'spoofed admin flag never reaches fleet metrics');
  } finally {
    globals.__bmsPostgresPool=prev;
    if(mode==null)delete process.env.BMS_DEPLOYMENT_MODE;else process.env.BMS_DEPLOYMENT_MODE=mode;
  }
});

test('central compatibility facades and all registration paths preserve operational paths',()=>{
  const read=(path:string)=>readFileSync(new URL(`../apps/web/lib/bms/${path}.ts`,import.meta.url),'utf8');
  for(const facade of ['plans','featureAccess']){assert.match(read(facade),/from "\.\/entitlements"/);assert.doesNotMatch(read(facade),/SELECT|UPDATE/);}
  for(const [file,resource] of [['locations','branches'],['pos','devices'],['channels','channels']]) {
    const source=read(file);assert.match(source,new RegExp(`requireCapacityForUpsert\\(tenantId, "${resource}"`));
    assert.equal(source.split('await requireCapacityForUpsert').length,2,'one admission gate, not a gate on existing operational actions');
  }
  assert.equal(read('signup').split('await recordPackageSignup(created.tenantId, client)').length,3,'both verified signup flows capture cohorts');
  assert.doesNotMatch(read('packageMetrics'),/COALESCE\(SUM\(e\.actual_cost_usd\),\s*0\)/);
});

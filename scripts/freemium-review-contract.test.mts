import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('all AI grant writers read the plan in the transaction before the month lock',()=>{
  const source=read('apps/web/lib/bms/aiUsage.ts');
  assert.doesNotMatch(source,/getTenantPlan\(tenantId, undefined/);
  assert.match(source,/async function getAccountingPlan[\s\S]*?FOR SHARE[\s\S]*?return getTenantPlan\(tenantId, client, at.getTime\(\)\)/);
  assert.equal((source.match(/const plan = await getAccountingPlan\(client, tenantId, at\)/g)??[]).length,6);
  assert.equal((source.match(/getAccountingPlan\(client, tenantId, at\);\s*(?:const unlimited[^;]+;\s*)?(?:const row = )?await ensureMonthlySummary/g)??[]).length,6);
});

test('Starter Catalog denial is atomic and cannot become an alternate product quota path',async()=>{
  const dbGlobal=globalThis as any,saved=dbGlobal.__bmsPostgresPool;
  const deployment=process.env.BMS_DEPLOYMENT_MODE;
  delete process.env.BMS_DEPLOYMENT_MODE;
  const calls:string[]=[];
  const query=async(sql:string)=>{
    calls.push(sql);
    const rows=sql.includes('business_archetype FROM bms_store_profile')?[{business_archetype:'mini_mart'}]
      :sql.includes('SELECT p.*')?[{code:'free',name:'Free',max_products:100,max_ai_messages_month:100}]
      :sql.includes('COUNT(*)')?[{c:99}]:[];
    return {rows,rowCount:rows.length};
  };
  dbGlobal.__bmsPostgresPool={query,connect:async()=>({query,release(){}})};
  try {
    const {createStarterCatalog}=await import('../apps/web/lib/bms/sampleData');
    await assert.rejects(createStarterCatalog('fixture'),(error:any)=>error.code==='QUOTA_EXCEEDED');
    assert.equal(calls.at(-1),'ROLLBACK');
    assert.ok(!calls.some(sql=>sql.includes('INSERT INTO')));
    const tenant=calls.findIndex(sql=>sql.includes('FROM bms_tenants')&&sql.includes('FOR UPDATE'));
    const profile=calls.findIndex(sql=>sql.includes('FROM bms_store_profile'));
    const count=calls.findIndex(sql=>sql.includes('COUNT(*)'));
    assert.ok(tenant>=0&&tenant<profile&&profile<count,'tenant -> profile -> quota matches store-profile lock order');
  } finally {
    dbGlobal.__bmsPostgresPool=saved;
    if(deployment==null) delete process.env.BMS_DEPLOYMENT_MODE; else process.env.BMS_DEPLOYMENT_MODE=deployment;
  }
});

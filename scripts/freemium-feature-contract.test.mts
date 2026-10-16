import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFeatureAccess, planFeatureKeys } from '../apps/web/lib/bms/featurePolicy';

test('phase two package matrix, legacy grants and work continuity are separate', () => {
  assert.deepEqual(planFeatureKeys('free'), []);
  assert.deepEqual(planFeatureKeys('pro'), ['REPORT_SCHEDULE']);
  assert.deepEqual(planFeatureKeys('business'), ['REPORT_SCHEDULE', 'RETENTION_ENGINE']);
  assert.deepEqual(planFeatureKeys('spoofed'), []);
  for (const plan of ['free', 'pro', 'business']) {
    assert.ok(resolveFeatureAccess(plan, 1).every(f => f.allowed && f.source === 'LEGACY'));
    assert.ok(resolveFeatureAccess(plan, 2, true).every(f => f.allowed && f.source === 'RETAIL_LOCAL'));
    assert.deepEqual(resolveFeatureAccess(plan, 2).filter(f => f.allowed).map(f => f.feature), planFeatureKeys(plan));
  }
  const existing = resolveFeatureAccess('free', 2, false, true);
  assert.equal(existing[0].source, 'EXISTING_WORK');
  assert.equal(existing[1].allowed, false);
});

test('services and GraphQL enforce admission, preserve old work and roll back on denial', async t => {
  const calls: { sql: string; params: any[] }[] = [];
  let plan = 'free', version = 2, hasReport = false, failAudit = false;
  const row = () => ({ tenant_id: 'tenant-a', frequency: 'DAILY', send_hour: 8, enabled: false, email_enabled: false });
  const fakeQuery = async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (failAudit && sql.includes('INSERT INTO bms_audit_log')) throw Error('audit failed');
    const rows = sql.includes('AS has_report_schedule') ? [{ plan, version, has_report_schedule: hasReport }]
      : sql.includes('SELECT * FROM bms_report_subscriptions') ? hasReport ? [row()] : []
      : sql.includes('INSERT INTO bms_report_subscriptions') ? [row()] : [];
    return { rows, rowCount: rows.length };
  };
  const dbGlobal = globalThis as any, saved = dbGlobal.__bmsPostgresPool;
  dbGlobal.__bmsPostgresPool = { query: fakeQuery, connect: async () => ({ query: fakeQuery, release() {} }) };
  try {
    const { upsertReportSubscription } = await import('../apps/web/lib/bms/reportDigest');
    const { refreshRetentionCases } = await import('../apps/web/lib/bms/retention');
    const { bmsReportScheduleResolvers } = await import('../apps/web/graphql/bmsReportSchedule');
    const { bmsFollowupsResolvers } = await import('../apps/web/graphql/bmsFollowups');
    const { bmsSaasResolvers } = await import('../apps/web/graphql/bmsSaas');
    const ctx = { scope: 'admin', admin: { id: 'actor', tenant_id: 'tenant-a' }, __bmsPerms: new Set(['retention.manage','report.view','report.email']) };
    await t.test('Free cannot reserve a disabled schedule to bypass the paywall', async () => {
      calls.length = 0;
      await assert.rejects(upsertReportSubscription('tenant-a', { enabled: false, emailEnabled: false }, 'actor'), (e:any) => e.code === 'FEATURE_NOT_INCLUDED');
      assert.ok(!calls.some(c => c.sql.includes('INSERT INTO')));
      assert.equal(calls.at(-1)?.sql, 'ROLLBACK');
    });
    await t.test('new non-Business generation denies before scanning orders; legacy and Business work', async () => {
      for (const p of ['free','pro']) {
        plan = p; calls.length = 0;
        await assert.rejects(refreshRetentionCases('tenant-a'), (e:any) => e.code === 'FEATURE_NOT_INCLUDED');
        assert.ok(!calls.some(c => c.sql.includes('WITH paid AS')));
      }
      for (const [p,v] of [['business',2],['free',1]] as const) {
        plan=p; version=v; calls.length=0;
        await refreshRetentionCases('tenant-a', false, 'actor');
        assert.ok(calls.some(c => c.sql.includes('WITH paid AS')));
        assert.equal(calls.at(-1)?.sql, 'COMMIT');
      }
      version=2; plan='free';
    });
    await t.test('downgrade allows old-case reconciliation with no recommendation scan or insertion', async () => {
      calls.length = 0;
      await refreshRetentionCases('tenant-a', true, 'actor');
      assert.ok(!calls.some(c => /WITH paid AS|INSERT INTO bms_retention_cases/.test(c.sql)));
      assert.ok(calls.some(c => c.sql.includes("status='EXPIRED'")));
      assert.ok(calls.some(c => c.sql.includes("status='CONVERTED'")));
      assert.equal(calls.at(-1)?.sql, 'COMMIT');
    });
    await t.test('existing schedules and legacy shops may edit; audit failure rolls back', async () => {
      hasReport=true; calls.length=0;
      await upsertReportSubscription('tenant-a', { emailEnabled:false }, 'actor');
      assert.ok(calls.some(c => c.sql.includes('INSERT INTO bms_report_subscriptions')));
      assert.equal(calls.at(-1)?.sql, 'COMMIT');
      failAudit=true;
      await assert.rejects(upsertReportSubscription('tenant-a', { emailEnabled:false }, 'actor'), /audit failed/);
      assert.equal(calls.at(-1)?.sql, 'ROLLBACK');
      failAudit=false; hasReport=false; version=1;
      await upsertReportSubscription('tenant-a', { emailEnabled:false }, 'actor');
      version=2;
    });
    await t.test('adapters preserve auth, permissions, server tenant and feature error codes', async () => {
      calls.length=0;
      await assert.rejects(bmsSaasResolvers.Query.bmsFeatureAccess(null, {}, {}));
      await assert.rejects(bmsReportScheduleResolvers.Mutation.bmsUpsertReportSubscription(null, {input:{}}, {}));
      await assert.rejects(bmsFollowupsResolvers.Mutation.bmsRefreshRetention(null, {existingOnly:true}, {...ctx,__bmsPerms:new Set()}), (e:any)=>e.extensions?.code==='FORBIDDEN');
      assert.equal(calls.length,0);
      const denied={...ctx,__bmsPerms:new Set()};
      for(const read of [bmsReportScheduleResolvers.Query.bmsReportSubscription,bmsReportScheduleResolvers.Query.bmsReportDeliveries]) {
        await assert.rejects(read(null,{},denied),(e:any)=>e.extensions?.code==='FORBIDDEN');
      }
      for(const v of [1,2]) {
        version=v;
        const readOnly={...ctx,__bmsPerms:new Set(['report.view'])};
        await assert.rejects(bmsReportScheduleResolvers.Mutation.bmsUpsertReportSubscription(null,{input:{}},readOnly),(e:any)=>e.extensions?.code==='FORBIDDEN');
        await assert.rejects(bmsReportScheduleResolvers.Mutation.bmsSendTestReportNow(null,{},readOnly),(e:any)=>e.extensions?.code==='FORBIDDEN');
      }
      version=2;
      assert.equal(calls.length,0,'even legacy feature access must not bypass RBAC');
      await assert.rejects(bmsFollowupsResolvers.Mutation.bmsRefreshRetention(null, {}, ctx), (e:any)=>e.extensions?.code==='FEATURE_NOT_INCLUDED');
      await assert.rejects(bmsReportScheduleResolvers.Mutation.bmsUpsertReportSubscription(null, {input:{}}, ctx), (e:any)=>e.extensions?.code==='FEATURE_NOT_INCLUDED');
      calls.length=0;
      await bmsSaasResolvers.Query.bmsFeatureAccess(null, {tenantId:'foreign',plan:'business'},ctx);
      assert.deepEqual(calls[0].params,['tenant-a']);
      assert.match(calls[0].sql,/WHERE t.id=\$1/);
      version=1;
      await bmsReportScheduleResolvers.Query.bmsReportSubscription(null,{},ctx);
      await bmsReportScheduleResolvers.Mutation.bmsUpsertReportSubscription(null,{input:{emailEnabled:false}},ctx);
      assert.equal(calls.at(-1)?.sql,'COMMIT','authorized legacy staff retain schedule editing');
      version=2;
    });
    await t.test('tenant staff cannot self-upgrade using spoofed platform flags',async()=>{
      calls.length=0;
      const spoofed={...ctx,admin:{...ctx.admin,role:'Administrator',is_platform_admin:true},isPlatformAdmin:true};
      for(const operation of [
        ()=>bmsSaasResolvers.Mutation.bmsChangePlan(null,{planCode:'business'},spoofed),
        ()=>bmsSaasResolvers.Mutation.bmsSetTenantPlan(null,{tenantId:'foreign',planCode:'business'},spoofed),
      ]) await assert.rejects(operation(),(e:any)=>e.extensions?.code==='FORBIDDEN');
      assert.ok(!calls.some(c=>/INSERT|UPDATE/.test(c.sql)));
    });
  } finally { dbGlobal.__bmsPostgresPool=saved; }
});

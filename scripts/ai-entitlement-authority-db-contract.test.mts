// Isolated local database only. No provider requests or customer billing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { query } from '../apps/web/lib/db';
import { bmsSaasResolvers } from '../apps/web/graphql/bmsSaas';
import { bmsAiConfigResolvers } from '../apps/web/graphql/bmsAiConfig';
import { getAiUsage, tryConsumeAiQuota, recordAiProviderAttempt, finalizeAiUsageEvent } from '../apps/web/lib/bms/aiUsage';

test('AI entitlements cannot be self-issued and finite balances serialize concurrent admission', async t => {
  assert.ok(['localhost', '127.0.0.1', '::1', 'postgres', 'db'].includes(process.env.POSTGRES_HOST ?? ''));
  const tenants: string[] = [], users: string[] = [];
  const deployment = process.env.BMS_DEPLOYMENT_MODE;
  delete process.env.BMS_DEPLOYMENT_MODE;
  t.after(async () => {
    if (deployment == null) delete process.env.BMS_DEPLOYMENT_MODE; else process.env.BMS_DEPLOYMENT_MODE = deployment;
    await query('DELETE FROM notifications WHERE user_id=ANY($1::uuid[])', [users]);
    await query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
    await query('DELETE FROM bms_audit_log WHERE tenant_id=ANY($1::uuid[])', [tenants]);
    await query('DELETE FROM bms_tenants WHERE id=ANY($1::uuid[])', [tenants]);
  });
  async function shop(plan = 'free') {
    const id = (await query("INSERT INTO bms_tenants(name,slug,plan) VALUES('FAKE entitlement audit',$1,$2) RETURNING id", [`fake-entitlement-${crypto.randomUUID()}`,plan])).rows[0].id;
    tenants.push(id); return id as string;
  }
  const tenant = await shop(), other = await shop();
  const user = (await query("INSERT INTO users(tenant_id,role_id,name,email,is_platform_admin,password_hash,fake_test) SELECT $1,id,'FAKE owner',$2,false,'x',true FROM roles WHERE name='Administrator' RETURNING id", [tenant,`fake-${crypto.randomUUID()}@example.test`])).rows[0].id;
  users.push(user);
  const ctx = { scope: 'admin', admin: { id: user, tenant_id: tenant, role: 'Administrator', is_platform_admin: true }, isPlatformAdmin: true };
  const change = () => bmsSaasResolvers.Mutation.bmsChangePlan(null, { planCode: 'business' }, ctx);
  const adjust = () => bmsAiConfigResolvers.Mutation.bmsAdjustAiCredits(null, { amount: 1000, note: 'FAKE authorized adjustment' }, ctx);
  const forbidden = (error: any) => error.extensions?.code === 'FORBIDDEN';
  await t.test('tenant Administrator cannot grant unlimited or top up points, even with spoofed context flags', async () => {
    await assert.rejects(change(), forbidden);
    await assert.rejects(adjust(), forbidden);
    assert.equal((await getAiUsage(tenant)).remaining, 100);
    assert.equal((await getAiUsage(tenant)).planCode, 'free');
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM bms_audit_log WHERE tenant_id=$1', [tenant])).rows[0].n, 0);
  });
  await t.test('database-granted platform authority works, stays tenant-scoped, and revocation applies immediately', async () => {
    await query('UPDATE users SET is_platform_admin=true WHERE id=$1', [user]);
    assert.equal(await adjust(), true);
    assert.equal((await getAiUsage(tenant)).remaining, 1100);
    assert.equal(await change(), true);
    assert.equal((await getAiUsage(tenant)).unlimited, true);
    assert.equal((await getAiUsage(other)).remaining, 100);
    assert.equal((await getAiUsage(other)).planCode, 'free');
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM bms_audit_log WHERE tenant_id=$1', [tenant])).rows[0].n, 2);
    await query('UPDATE users SET is_platform_admin=false WHERE id=$1', [user]);
    await assert.rejects(adjust(), forbidden);
    await assert.rejects(change(), forbidden);
  });
  for (const [plan, limit] of [['free',100],['pro',1000]] as const) {
    await t.test(`${plan}: twenty simultaneous requests at the last point admit exactly one`, async () => {
      const id = await shop(plan);
      assert.equal((await getAiUsage(id)).remaining, limit);
      await query('UPDATE bms_ai_usage_monthly SET credits_consumed=$2 WHERE tenant_id=$1', [id,limit-1]);
      const results = await Promise.all(Array.from({length:20}, () => tryConsumeAiQuota(id, { provider:'fake-test-provider',model:'claude-haiku-4-5-fake' })));
      assert.equal(results.filter(r => r.ok).length, 1);
      const admitted = results.find(r => r.ok)!.eventId!;
      await recordAiProviderAttempt(admitted);
      await finalizeAiUsageEvent(admitted, {status:'failed'});
      const usage = await getAiUsage(id);
      assert.equal(usage.count, limit);
      assert.equal(usage.remaining, 0);
      assert.equal(usage.creditStatus, 'PAUSED_CREDITS');
      assert.equal(usage.providerCalls, 1);
      assert.equal(usage.unpricedProviderCalls, 1);
      assert.equal((await tryConsumeAiQuota(id)).ok, false, 'provider failure with an actual attempt must not refund paid usage');
    });
  }
});

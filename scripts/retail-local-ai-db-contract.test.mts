import assert from 'node:assert/strict';
import test from 'node:test';
import { query } from '../apps/web/lib/db';
import { getAiBillingContext, setTenantAiKey, removeTenantAiKey } from '../apps/web/lib/bms/aiConfig';
import { getAiUsage, tryConsumeAiQuota, recordAiProviderAttempt, finalizeAiUsageEvent, adjustAiCredits } from '../apps/web/lib/bms/aiUsage';
import { changePlan } from '../apps/web/lib/bms/plans';
import { listAiLimitNotifications } from '../apps/web/lib/bms/aiLimitNotices';

test('Retail Local AI uses owner credentials independently of cloud plan points', async t => {
  assert.ok(['localhost', '127.0.0.1', '::1', 'postgres', 'db'].includes(process.env.POSTGRES_HOST ?? ''));
  const keys = ['BMS_DEPLOYMENT_MODE', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'BMS_AI_PROVIDER'];
  const saved = keys.map(k => process.env[k]);
  keys.forEach(k => delete process.env[k]);
  const tenants: string[] = [];
  t.after(async () => {
    keys.forEach((k, i) => { if (saved[i] == null) delete process.env[k]; else process.env[k] = saved[i]; });
    await query('DELETE FROM bms_tenants WHERE id=ANY($1::uuid[])', [tenants]);
  });
  async function shop() {
    const id = (await query("INSERT INTO bms_tenants(name,slug,plan) VALUES('FAKE local AI',$1,'free') RETURNING id", [`fake-local-ai-${crypto.randomUUID()}`])).rows[0].id;
    tenants.push(id); return id as string;
  }
  const tenant = await shop();
  await t.test('cloud retains plan points even without configured credentials', async () => {
    const usage = await getAiUsage(tenant);
    assert.equal(usage.billingMode, 'PLAN_POINTS');
    assert.equal(usage.limit, 100);
    assert.equal(usage.planCode, 'free');
  });
  process.env.BMS_DEPLOYMENT_MODE = 'retail-local';
  await t.test('no configured chat credentials reports unconfigured, never a Business subscription', async () => {
    const usage = await getAiUsage(tenant);
    assert.equal(usage.billingMode, 'LOCAL_UNCONFIGURED');
    assert.equal(usage.connectionProvider, null);
    assert.equal(usage.connectionModel, null);
    assert.equal(usage.planCode, 'retail-local');
    assert.equal(usage.creditStatus, 'NORMAL');
  });
  await t.test('saved tenant key is recognized without contacting the provider or exposing credentials', async () => {
    await setTenantAiKey(tenant, { apiKey: 'FAKE-local-owned-key', provider: 'deepseek' });
    const before = await getAiUsage(tenant);
    const context = await getAiBillingContext(tenant);
    assert.equal(context.billingMode, 'LOCAL_OWN_KEY');
    assert.equal(context.connectionProvider, 'deepseek');
    assert.ok(context.connectionModel);
    assert.doesNotMatch(JSON.stringify(context), /FAKE-local-owned-key|apiKey|encrypted/);
    assert.equal((await getAiUsage(tenant)).providerCalls, before.providerCalls);
    assert.equal((await getAiBillingContext(await shop())).billingMode, 'LOCAL_UNCONFIGURED');
  });
  await t.test('server credentials remain owned by the customer after removing the saved tenant key', async () => {
    process.env.ANTHROPIC_API_KEY = 'FAKE-server-owned-key';
    await removeTenantAiKey(tenant);
    const context = await getAiBillingContext(tenant);
    assert.equal(context.billingMode, 'LOCAL_OWN_KEY');
    assert.equal(context.connectionProvider, 'anthropic');
    assert.doesNotMatch(JSON.stringify(context), /FAKE-server-owned-key/);
    process.env.ANTHROPIC_API_KEY = '   ';
    assert.equal((await getAiBillingContext(tenant)).billingMode, 'LOCAL_UNCONFIGURED');
    process.env.DEEPSEEK_API_KEY = 'FAKE-server-deepseek-key';
    assert.equal((await getAiBillingContext(tenant)).connectionProvider, 'deepseek');
  });
  await t.test('legacy exhausted Free points cannot block local requests or charge new points', async () => {
    await query('UPDATE bms_ai_usage_monthly SET credits_consumed=150 WHERE tenant_id=$1', [tenant]);
    const result = await tryConsumeAiQuota(tenant, { provider: 'fake-test-provider', model: 'claude-haiku-4-5-fake', feature: 'fake_local' });
    assert.equal(result.ok, true);
    await recordAiProviderAttempt(result.eventId!);
    await finalizeAiUsageEvent(result.eventId!, { status: 'completed', inputTokens: 1000, outputTokens: 100 });
    const usage = await getAiUsage(tenant);
    assert.equal(usage.requestCount, 1);
    assert.equal(usage.providerCalls, 1);
    assert.equal(usage.inputTokens, 1000);
    assert.equal(usage.outputTokens, 100);
    assert.equal(usage.actualCostUsd, 0.0015);
    assert.equal(usage.billableCredits, 0);
    assert.equal(usage.creditStatus, 'NORMAL');
    assert.equal(usage.grantedCredits, 0);
    assert.equal(usage.count, 150, 'historical point evidence is preserved');
    assert.equal((await query('SELECT billable_credits FROM bms_ai_usage_events WHERE id=$1', [result.eventId])).rows[0].billable_credits, 0);
    assert.deepEqual(await listAiLimitNotifications(tenant, crypto.randomUUID()), { unreadCount: 0, items: [] });
  });
  await t.test('local rejects cloud-plan changes and point adjustments on the server', async () => {
    await assert.rejects(changePlan(tenant, 'business'), /Retail Local/);
    await assert.rejects(adjustAiCredits(tenant, 100), /Retail Local/);
    assert.equal((await query('SELECT plan FROM bms_tenants WHERE id=$1', [tenant])).rows[0].plan, 'free');
  });
});

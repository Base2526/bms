import assert from 'node:assert/strict';
import test from 'node:test';
import { query } from '../apps/web/lib/db';
import {
  AiUsageAdmissionError, aiAttemptReservationUsd, currentYearMonth, finalizeAiUsageEvent,
  getAiUsage, recordAiProviderAttempt, recordByokAiUsage, recordSharedAiRetryUsage,
  tryConsumeAiQuota, adjustAiCredits,
} from '../apps/web/lib/bms/aiUsage';

// Dedicated throwaway tenants only; no provider calls and no platform health writes.
test('platform AI cost admission is durable, tenant scoped and serialized', async t => {
  assert.ok(['localhost', '127.0.0.1', '::1', 'postgres', 'db'].includes(process.env.POSTGRES_HOST ?? ''));
  const tenants: string[] = [];
  const model = 'claude-haiku-4-5-fake';
  const provider = 'fake-test-provider';
  const context = { feature: 'fake_budget', provider, model };
  const month = currentYearMonth();
  async function shop(plan = 'free') {
    const row = (await query(`INSERT INTO bms_tenants(name,slug,plan) VALUES ('FAKE budget',$1,$2) RETURNING id`, [`fake-budget-${crypto.randomUUID()}`, plan])).rows[0];
    tenants.push(row.id);
    return row.id as string;
  }
  async function reserve(tenantId: string) {
    const result = await tryConsumeAiQuota(tenantId, context);
    assert.equal(result.ok, true);
    return result.eventId!;
  }
  const event = async (id: string) => (await query('SELECT * FROM bms_ai_usage_events WHERE id=$1', [id])).rows[0];
  async function seedCost(tenantId: string, amount: number) {
    const id = await reserve(tenantId);
    await recordAiProviderAttempt(id);
    await finalizeAiUsageEvent(id, { status: 'completed', estimatedCost: amount, inputTokens: 1, outputTokens: 1 });
    return id;
  }
  t.after(async () => {
    await query('DELETE FROM bms_tenants WHERE id=ANY($1::uuid[])', [tenants]);
  });

  await t.test('Business credits remain unlimited but two concurrent calls cannot spend the last budget twice', async () => {
    const tenant = await shop('business');
    const ceiling = aiAttemptReservationUsd(model, provider)!;
    await seedCost(tenant, 2000 - ceiling);
    const ids = await Promise.all([reserve(tenant), reserve(tenant)]);
    const attempts = await Promise.allSettled(ids.map(id => recordAiProviderAttempt(id)));
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
    const rejected = attempts.find(r => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.code, 'AI_BUDGET_EXHAUSTED');
    const usage = await getAiUsage(tenant);
    assert.equal(usage.unlimited, true);
    assert.equal(usage.count, 0);
    assert.equal(usage.sharedBudgetRemainingUsd, 0);
    assert.equal(usage.sharedBudgetBlocked, true);
    assert.equal(usage.sharedBudgetSpentUsd + usage.sharedBudgetReservedUsd, 2000);
    // An unrelated shop and tenant-owned key both remain usable.
    await recordAiProviderAttempt(await reserve(await shop()));
    await recordAiProviderAttempt(await recordByokAiUsage(tenant, context));
  });

  await t.test('refunds only a failed admission, never an attempt already persisted', async () => {
    const tenant = await shop();
    const id = await reserve(tenant);
    await recordAiProviderAttempt(id);
    await finalizeAiUsageEvent(id, { status: 'failed', providerCalls: 0 });
    assert.equal(Number((await event(id)).billable_credits), 1);
    assert.equal(Number((await event(id)).provider_calls), 1);
    assert.ok(Number((await event(id)).budget_reserved_usd) > 0);
    const blocked = await tryConsumeAiQuota(tenant, { ...context, model: 'unknown-model' });
    await assert.rejects(recordAiProviderAttempt(blocked.eventId!), (e: any) => e.code === 'AI_BUDGET_UNPRICED');
    await finalizeAiUsageEvent(blocked.eventId!, { status: 'failed' });
    assert.equal(Number((await event(blocked.eventId!)).billable_credits), 0);
    assert.equal(Number((await event(blocked.eventId!)).provider_calls), 0);
  });

  await t.test('metered completion releases the reservation once', async () => {
    const tenant = await shop();
    const id = await reserve(tenant);
    await recordAiProviderAttempt(id);
    const held = (await getAiUsage(tenant)).sharedBudgetReservedUsd;
    assert.ok(held > 0);
    await finalizeAiUsageEvent(id, { status: 'completed', inputTokens: 1000, outputTokens: 100 });
    assert.equal((await getAiUsage(tenant)).sharedBudgetReservedUsd, 0);
    assert.equal((await getAiUsage(tenant)).sharedBudgetSpentUsd, 0.0015);
    await finalizeAiUsageEvent(id, { status: 'completed', inputTokens: 9999, outputTokens: 9999 });
    assert.equal((await getAiUsage(tenant)).sharedBudgetSpentUsd, 0.0015);
    await assert.rejects(recordAiProviderAttempt(id), AiUsageAdmissionError);
  });

  await t.test('an actual SQL failure rolls finalization back and keeps the durable hold', async () => {
    const tenant = await shop();
    const id = await reserve(tenant);
    await recordAiProviderAttempt(id);
    const held = Number((await event(id)).budget_reserved_usd);
    const previousWebhook = process.env.SLACK_WEBHOOK_URL;
    process.env.SLACK_WEBHOOK_URL = ''; // no external notification from a deliberate test fault
    try {
      // The real PostgreSQL status CHECK rejects this write after the row locks.
      await finalizeAiUsageEvent(id, { status: 'FAKE_INVALID_STATUS' as any, inputTokens: 1000, outputTokens: 10 });
    } finally {
      if (previousWebhook == null) delete process.env.SLACK_WEBHOOK_URL;
      else process.env.SLACK_WEBHOOK_URL = previousWebhook;
    }
    const row = await event(id);
    assert.equal(row.completed_at, null);
    assert.equal(row.actual_cost_usd, null);
    assert.equal(Number(row.budget_reserved_usd), held);
    assert.equal(Number(row.provider_calls), 1);
    await finalizeAiUsageEvent(id, { status: 'completed', inputTokens: 1000, outputTokens: 10 });
    assert.equal(Number((await event(id)).budget_reserved_usd), 0);
    assert.equal((await getAiUsage(tenant)).sharedBudgetSpentUsd, 0.00105);
  });

  await t.test('parallel requests on a finite plan cannot consume the last credit twice', async () => {
    const tenant = await shop();
    await adjustAiCredits(tenant, -999);
    const results = await Promise.all([tryConsumeAiQuota(tenant, context), tryConsumeAiQuota(tenant, context)]);
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal((await getAiUsage(tenant)).remaining, 0);
    const charged = (await query('SELECT sum(billable_credits) AS n FROM bms_ai_usage_events WHERE tenant_id=$1', [tenant])).rows[0];
    assert.equal(Number(charged.n), 1);
  });

  await t.test('a partial/unknown attempt keeps its hold, including stale cleanup, and does not erase known cost', async () => {
    const tenant = await shop();
    const id = await reserve(tenant);
    await recordAiProviderAttempt(id);
    await recordAiProviderAttempt(id);
    const held = Number((await event(id)).budget_reserved_usd);
    await finalizeAiUsageEvent(id, { status: 'failed', providerCalls: 2, estimatedCost: 0.01, costMeasured: true, costRateKnown: false, unpricedProviderCalls: 1 });
    const row = await event(id);
    assert.equal(Number(row.actual_cost_usd), 0.01);
    assert.equal(Number(row.budget_reserved_usd) + Number(row.actual_cost_usd), held);
    const stale = await reserve(tenant);
    await recordAiProviderAttempt(stale);
    await query("UPDATE bms_ai_usage_events SET created_at=now()-interval '30 minutes' WHERE id=$1", [stale]);
    const before = Number((await event(stale)).budget_reserved_usd);
    await getAiUsage(tenant);
    assert.equal(Number((await event(stale)).budget_reserved_usd), before);
    assert.equal(Number((await event(stale)).billable_credits), 1);
  });

  await t.test('a retry/fallback has no second credit but must still reserve the fallback model expense', async () => {
    const tenant = await shop();
    await seedCost(tenant, 1999.9);
    const id = await recordSharedAiRetryUsage(tenant, context);
    assert.equal(Number((await event(id)).billable_credits), 0);
    await assert.rejects(recordAiProviderAttempt(id), (e: any) => e.code === 'AI_BUDGET_EXHAUSTED');
    assert.equal(Number((await event(id)).provider_calls), 0);
  });

  await t.test('omitted call totals use durable attempts when counting partially metered calls', async () => {
    const tenant = await shop();
    const id = await reserve(tenant);
    await recordAiProviderAttempt(id);
    await recordAiProviderAttempt(id);
    await finalizeAiUsageEvent(id, { status: 'failed', inputTokens: 100, unpricedProviderCalls: 2 });
    const row = await event(id);
    assert.equal(Number(row.provider_calls), 2);
    assert.equal(Number(row.unpriced_provider_calls), 2);
    assert.ok(Number(row.budget_reserved_usd) > 0);
  });

  await t.test('historical unknown spending fails closed, while a different UTC month is separate', async () => {
    const tenant = await shop();
    const legacy = await reserve(tenant);
    await query("UPDATE bms_ai_usage_events SET provider_calls=1, unpriced_provider_calls=1, completed_at=now(), status='failed' WHERE id=$1", [legacy]);
    const next = await reserve(tenant);
    await assert.rejects(recordAiProviderAttempt(next), (e: any) => e.code === 'AI_BUDGET_UNPRICED');
    assert.equal((await getAiUsage(tenant)).sharedBudgetUnaccountedCalls, 1);
    await query("UPDATE bms_ai_usage_events SET year_month='2000-01' WHERE id=$1", [legacy]);
    await recordAiProviderAttempt(next);
  });

  await t.test('an adjustment after reducing a plan records the actual remaining balance', async () => {
    const tenant = await shop();
    await reserve(tenant);
    await adjustAiCredits(tenant, -1100);
    await adjustAiCredits(tenant, 50);
    const latest = (await query("SELECT balance_after FROM bms_ai_credit_ledger WHERE tenant_id=$1 AND amount=50", [tenant])).rows[0];
    assert.equal(Number(latest.balance_after), 0);
    assert.equal((await getAiUsage(tenant)).remaining, 0);
  });
});

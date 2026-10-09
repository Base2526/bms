import assert from 'node:assert/strict';
import test from 'node:test';
import { aiPeriodResetsAt, budgetLimitStatus, creditLimitStatus } from '../apps/web/lib/bms/aiLimitStatus';
import { bmsAiConfigResolvers } from '../apps/web/graphql/bmsAiConfig';

test('personal AI notice resolvers refuse missing admin sessions and authenticated public callers', async () => {
  for (const ctx of [{ scope: 'admin' }, { scope: 'web', user: { id: crypto.randomUUID() } }, { scope: 'android', user: { id: crypto.randomUUID() } }]) {
    await assert.rejects(bmsAiConfigResolvers.Query.bmsAiLimitNotifications(null, {}, ctx), (e: any) => ['FORBIDDEN','UNAUTHENTICATED'].includes(e.extensions.code));
    await assert.rejects(bmsAiConfigResolvers.Mutation.bmsReadAiLimitNotification(null, { id: crypto.randomUUID() }, ctx), (e: any) => ['FORBIDDEN','UNAUTHENTICATED'].includes(e.extensions.code));
  }
});

test('credit warnings use adjusted capacity, unlimited has no credit warning', () => {
  assert.equal(creditLimitStatus(false, 100, 79), 'NORMAL');
  assert.equal(creditLimitStatus(false, 100, 80), 'WARNING_80');
  assert.equal(creditLimitStatus(false, 100, 90), 'WARNING_90');
  assert.equal(creditLimitStatus(false, 100, 100), 'PAUSED_CREDITS');
  assert.equal(creditLimitStatus(false, 0, 0), 'PAUSED_CREDITS');
  assert.equal(creditLimitStatus(false, 200, 100), 'NORMAL');
  assert.equal(creditLimitStatus(true, 0, 100000), 'NORMAL');
});
test('budget distinguishes headroom, outstanding calls and unverified cost; recovery follows released reservations', () => {
  const base = { limit: 100, spent: 5, reserved: 0, required: 0, unaccounted: 0, unpricedModel: false };
  assert.equal(budgetLimitStatus(base), 'NORMAL');
  assert.equal(budgetLimitStatus({ ...base, spent: 75, reserved: 5 }), 'WARNING_80');
  assert.equal(budgetLimitStatus({ ...base, spent: 90 }), 'WARNING_90');
  assert.equal(budgetLimitStatus({ ...base, spent: 99, required: 1.2 }), 'PAUSED_BUDGET');
  assert.equal(budgetLimitStatus({ ...base, spent: 90, reserved: 10 }), 'PAUSED_BUDGET');
  assert.equal(budgetLimitStatus({ ...base, spent: 90, required: 1.2 }), 'WARNING_90');
  assert.equal(budgetLimitStatus({ ...base, unaccounted: 1 }), 'PAUSED_UNPRICED');
  assert.equal(budgetLimitStatus({ ...base, unpricedModel: true }), 'PAUSED_UNPRICED');
});
test('monthly reset is UTC including December rollover, not browser timezone', () => {
  assert.equal(aiPeriodResetsAt('2026-12'), '2027-01-01T00:00:00.000Z');
  assert.equal(aiPeriodResetsAt('2026-10'), '2026-11-01T00:00:00.000Z');
});

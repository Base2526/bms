import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolvePlanAiAllowance } from '../apps/web/lib/bms/planPolicy';
import { enforceProductQuota, enforceUserQuota, getTenantPlan } from '../apps/web/lib/bms/plans';
import { aiYearMonth } from '../apps/web/lib/bms/aiLimitStatus';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('current monthly package matrix stays aligned across migrations and customer-facing copy', () => {
  const phaseOne = read('db/migrations/10.73__bms_freemium_phase_one.sql');
  const capacity = read('db/migrations/10.75__bms_capacity_and_package_metrics.sql');
  const thai = read('apps/web/i18n/th.ts');
  const english = read('apps/web/i18n/en.ts');
  const status = read('docs/status-log.md');

  assert.match(phaseOne, /WHEN 'free' THEN 0 WHEN 'pro' THEN 599 ELSE 1990/);
  assert.match(phaseOne, /WHEN 'free' THEN 100 ELSE -1/);
  assert.match(phaseOne, /WHEN 'free' THEN 2 WHEN 'pro' THEN 5 ELSE 20/);
  assert.match(phaseOne, /ai_credits_monthly = 5000/);
  assert.match(phaseOne, /max_orders_month = -1/);
  assert.match(capacity, /max_branches = CASE code WHEN 'business' THEN 5 ELSE 1 END/);
  assert.match(capacity, /max_devices = CASE code WHEN 'business' THEN 10 WHEN 'pro' THEN 3 ELSE 1 END/);
  assert.match(capacity, /max_channels = CASE code WHEN 'business' THEN -1 WHEN 'pro' THEN 3 ELSE 1 END/);

  assert.doesNotMatch(thai, /ยังไม่บังคับเพดานสาขา เครื่อง POS และช่องทาง/);
  assert.doesNotMatch(english, /Branch, device and channel limits are not enforced/);
  assert.doesNotMatch(status, /Business unlimited \(THB 1,990\)/);
});

test('plan lookup uses the accounting instant, not the time the query completes', async () => {
  const row = { code: 'business', price_monthly: 1990, ai_credits_monthly: 5000,
    max_ai_messages_month: 5000, ai_credits_previous_monthly: -1,
    ai_credits_effective_at: '2026-10-31T17:00:00.000Z' };
  const client = { query: async () => ({ rows: [row] }) } as any;
  for (const [instant, month, allowance] of [
    ['2026-10-31T16:59:59.999Z', '2026-10', -1],
    ['2026-10-31T17:00:00.000Z', '2026-11', 5000],
  ] as const) {
    const at = new Date(instant);
    const plan = await getTenantPlan('fixture', client, at.getTime());
    assert.equal(aiYearMonth(at), month);
    assert.equal(plan.ai_credits_monthly, allowance);
  }
});

test('Business preserves this month and switches exactly at Bangkok midnight', () => {
  const row = { ai_credits_monthly: 5000, max_ai_messages_month: 5000,
    ai_credits_previous_monthly: -1, ai_credits_effective_at: '2026-10-31T17:00:00.000Z' };
  assert.deepEqual(resolvePlanAiAllowance(row, Date.parse('2026-10-31T16:59:59.999Z')), {
    ai_credits_monthly: -1, max_ai_messages_month: -1,
    ai_credits_next_monthly: 5000, ai_credits_change_at: '2026-10-31T17:00:00.000Z',
  });
  for (const time of ['2026-10-31T17:00:00.000Z', '2027-01-01T00:00:00.000Z']) {
    assert.deepEqual(resolvePlanAiAllowance(row, Date.parse(time)), {
      ai_credits_monthly: 5000, max_ai_messages_month: 5000,
      ai_credits_next_monthly: null, ai_credits_change_at: null,
    });
  }
});

test('old schema and unscheduled plans retain their allowance, including zero', () => {
  for (const limit of [-1, 0, 100, 1000]) {
    assert.equal(resolvePlanAiAllowance({ max_ai_messages_month: limit }).ai_credits_monthly, limit);
    assert.equal(resolvePlanAiAllowance({ ai_credits_monthly: limit, max_ai_messages_month: 999 }).ai_credits_monthly, limit);
  }
  assert.equal(resolvePlanAiAllowance({ max_ai_messages_month: 5000,
    ai_credits_previous_monthly: 2500, ai_credits_effective_at: new Date('2030-01-31T17:00:00Z'),
  }, Date.parse('2030-01-01')).ai_credits_monthly, 2500);
});

test('Retail Local does not apply cloud product/staff caps or access the database', async () => {
  const saved = process.env.BMS_DEPLOYMENT_MODE;
  process.env.BMS_DEPLOYMENT_MODE = 'retail-local';
  try {
    await enforceUserQuota('local-fixture', { query: () => { throw new Error('unexpected database read'); } } as any);
    await enforceProductQuota('local-fixture', { query: () => { throw new Error('unexpected database read'); } } as any, 4);
  } finally {
    if (saved == null) delete process.env.BMS_DEPLOYMENT_MODE;
    else process.env.BMS_DEPLOYMENT_MODE = saved;
  }
});

test('over-limit Cloud product imports can still update old SKUs; Local previews ignore Cloud caps', async () => {
  const pool=(globalThis as any).__bmsPostgresPool, savedQuery=pool.query;
  const deployment=process.env.BMS_DEPLOYMENT_MODE;
  let existing=true;
  pool.query=async(sql:string)=>{
    assert.match(sql,/SELECT p.sku, s.stock_policy, s.base_unit FROM bms_products p/,'update-only/Local previews must not read Cloud quotas');
    const rows=existing?[{sku:'FAKE-OLD'}]:[];
    return {rows,rowCount:rows.length};
  };
  try {
    const {runImport}=await import('../apps/web/lib/bms/productImport');
    delete process.env.BMS_DEPLOYMENT_MODE;
    const input=[{rowNumber:1,sku:'FAKE-OLD',name:'FAKE product',price:10}];
    const update=await runImport('fixture',input,{commit:false});
    assert.equal(update.quotaExceeded,false);assert.equal(update.updateCount,1);
    existing=false;process.env.BMS_DEPLOYMENT_MODE='retail-local';
    const local=await runImport('fixture',input,{commit:false});
    assert.equal(local.quotaExceeded,false);assert.equal(local.createCount,1);
  } finally {
    pool.query=savedQuery;
    if(deployment==null) delete process.env.BMS_DEPLOYMENT_MODE; else process.env.BMS_DEPLOYMENT_MODE=deployment;
  }
});

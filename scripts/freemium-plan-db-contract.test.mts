import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getClient } from '../apps/web/lib/db';
import { enforceProductQuota, enforceUserQuota, getTenantPlan, getUsage } from '../apps/web/lib/bms/plans';

// Actual PostgreSQL migration/service checks, with temporary tables only.
// Run via run-contract-tests.mjs db freemium-plan on a local throwaway database.
test('freemium migration is repeatable and preserves existing over-limit resources', async t => {
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.POSTGRES_HOST ?? ''));
  const client = await getClient();
  await client.query('BEGIN');
  try {
    await client.query(`CREATE TEMP TABLE bms_plans (
      code text PRIMARY KEY, name text, price_monthly numeric, max_products integer,
      max_channels integer, max_orders_month integer, max_users integer,
      max_ai_messages_month integer, ai_credits_monthly integer, sort integer);
      CREATE TEMP TABLE bms_tenants (id uuid PRIMARY KEY, plan text);
      CREATE TEMP TABLE bms_products (tenant_id uuid, sku text);
      CREATE TEMP TABLE users (tenant_id uuid, name text);
      CREATE TEMP TABLE bms_tenant_channels (tenant_id uuid, channel text, active boolean);
      CREATE TEMP TABLE bms_orders (tenant_id uuid, created_at timestamptz);
      INSERT INTO bms_plans VALUES
      ('free','Free',0,5,1,100,3,100,100,1),
      ('pro','Pro',599,100,3,5000,10,1000,1000,2),
      ('business','Business',1990,-1,-1,-1,-1,-1,-1,3);
      INSERT INTO bms_tenants VALUES
      ('11111111-1111-4111-8111-111111111111','free'),
      ('22222222-2222-4222-8222-222222222222','business');`);
    const migration = await readFile(new URL('../db/migrations/10.73__bms_freemium_phase_one.sql', import.meta.url), 'utf8');
    const free = '11111111-1111-4111-8111-111111111111';
    const business = '22222222-2222-4222-8222-222222222222';
    await t.test('Billing counts disabled channel registrations and excludes other tenants', async () => {
      await client.query(`INSERT INTO bms_tenant_channels VALUES
        ($1,'line',true),($1,'web',false),($2,'facebook',true)`, [free, business]);
      // Route the service's pool read to this transaction's temporary tables only.
      const pool = (globalThis as any).__bmsPostgresPool;
      const originalQuery = pool.query;
      pool.query = client.query.bind(client);
      try {
        assert.equal((await getUsage(free)).channels, 2);
        assert.equal((await getUsage(business)).channels, 1);
      } finally { pool.query = originalQuery; }
    });
    await t.test('migration preserves the deadline and old allowance on rerun', async () => {
      await client.query(migration);
      const first = (await client.query('SELECT * FROM bms_plans ORDER BY sort')).rows;
      await client.query(migration);
      assert.deepEqual((await client.query('SELECT * FROM bms_plans ORDER BY sort')).rows, first);
      assert.deepEqual(first.map(p => [p.code, Number(p.price_monthly), p.max_products, p.max_users, p.max_orders_month]),
        [['free',0,100,2,-1],['pro',599,-1,5,-1],['business',1990,-1,20,-1]]);
      const expected = (await client.query(`SELECT (date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok')
        + interval '1 month') AT TIME ZONE 'Asia/Bangkok' AS deadline`)).rows[0].deadline;
      assert.deepEqual(first[2].ai_credits_effective_at, expected);
      assert.equal(first[2].ai_credits_previous_monthly, -1);
      assert.equal(first[2].ai_credits_monthly, 5000);
    });
    await t.test('service reports current unlimited allowance and the scheduled finite amount', async () => {
      const plan = await getTenantPlan(business, client);
      assert.equal(plan.ai_credits_monthly, -1);
      assert.equal(plan.ai_credits_next_monthly, 5000);
      await client.query("UPDATE bms_plans SET ai_credits_effective_at=now()-interval '1 second' WHERE code='business'");
      const effective = await getTenantPlan(business, client);
      assert.equal(effective.ai_credits_monthly, 5000);
      assert.equal(effective.max_ai_messages_month, 5000);
      assert.equal(effective.ai_credits_change_at, null);
    });
    await t.test('new capacity is tenant-scoped; overage rejects additions and leaves old rows intact', async () => {
      await client.query('INSERT INTO users SELECT $1, n::text FROM generate_series(1,3) n', [free]);
      await client.query('INSERT INTO bms_products SELECT $1, n::text FROM generate_series(1,100) n', [free]);
      await assert.rejects(enforceUserQuota(free, client), /2/);
      await assert.rejects(enforceProductQuota(free, client), /100/);
      await enforceUserQuota(business, client);
      await enforceProductQuota(business, client);
      assert.equal((await client.query('SELECT count(*)::int n FROM users WHERE tenant_id=$1', [free])).rows[0].n, 3);
      assert.equal((await client.query('SELECT count(*)::int n FROM bms_products WHERE tenant_id=$1', [free])).rows[0].n, 100);
      await client.query('UPDATE bms_tenants SET plan=$2 WHERE id=$1', [free, 'pro']);
      await enforceUserQuota(free, client);
      await enforceProductQuota(free, client);
    });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

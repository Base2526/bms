import assert from 'node:assert/strict';
import test from 'node:test';
import { query, getClient } from '../apps/web/lib/db';
import { beginTenantTx } from '../apps/web/lib/bms/tenant';
import { currentYearMonth, getAiUsage, tryConsumeAiQuota, recordAiProviderAttempt, finalizeAiUsageEvent, adjustAiCredits } from '../apps/web/lib/bms/aiUsage';
import { listAiLimitNotifications, readAiLimitNotification } from '../apps/web/lib/bms/aiLimitNotices';

test('AI owner notifications are durable, deduplicated and scoped to recipient and tenant', async t => {
  const tenants: string[] = [], users: string[] = [];
  const month = currentYearMonth();
  const context = { provider: 'fake-test-provider', model: 'claude-haiku-4-5-fake', feature: 'fake_notices' };
  async function shop(plan = 'business') {
    const id = (await query(`INSERT INTO bms_tenants(name,slug,plan) VALUES('FAKE AI notices',$1,$2) RETURNING id`, [`fake-notices-${crypto.randomUUID()}`, plan])).rows[0].id;
    tenants.push(id);
    return id as string;
  }
  async function owner(tenant: string, role = 'Administrator') {
    const id = crypto.randomUUID();
    await query(`INSERT INTO users(id,tenant_id,role_id,name,username,email,role,password_hash,fake_test)
      SELECT $1::uuid,$2::uuid,id,'FAKE AI owner',$1::text,$1::text||'@example.invalid',name,'FAKE-unused',true FROM roles WHERE name=$3 LIMIT 1`, [id, tenant, role]);
    users.push(id); return id;
  }
  async function cost(tenant: string, amount: number) {
    const { eventId } = await tryConsumeAiQuota(tenant, context);
    await recordAiProviderAttempt(eventId!);
    await finalizeAiUsageEvent(eventId!, { status: 'completed', inputTokens: 1, outputTokens: 1, estimatedCost: amount });
  }
  t.after(async () => {
    await query(`DELETE FROM notifications WHERE user_id=ANY($1::uuid[])`, [users]);
    await query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [users]);
    await query(`DELETE FROM bms_tenants WHERE id=ANY($1::uuid[])`, [tenants]);
  });
  await t.test('80/90 warnings reach both owner roles once, without requiring an open page', async () => {
    const tenant = await shop('free'), admin = await owner(tenant), manager = await owner(tenant, 'Manager');
    const other = await shop(), outsider = await owner(other);
    await getAiUsage(tenant);
    await query("UPDATE bms_ai_usage_monthly SET credits_consumed=79 WHERE tenant_id=$1", [tenant]);
    await cost(tenant, 0.01);
    let inbox = await listAiLimitNotifications(tenant, admin);
    assert.equal(inbox.unreadCount, 1);
    assert.equal(inbox.items[0].level, 'WARNING_80');
    assert.equal((await listAiLimitNotifications(tenant, manager)).unreadCount, 1);
    assert.equal((await listAiLimitNotifications(other, outsider)).unreadCount, 0);
    await query("UPDATE bms_ai_usage_monthly SET credits_consumed=89 WHERE tenant_id=$1", [tenant]);
    await cost(tenant, 0.01);
    await Promise.all(Array.from({ length: 5 }, () => getAiUsage(tenant)));
    inbox = await listAiLimitNotifications(tenant, admin);
    assert.equal(inbox.unreadCount, 2);
    const id = inbox.items[0].id;
    assert.equal(await readAiLimitNotification(other, admin, id), false);
    assert.equal(await readAiLimitNotification(tenant, manager, id), false);
    assert.equal((await listAiLimitNotifications(other, admin)).items.length, 0);
    assert.equal(await readAiLimitNotification(tenant, admin, id), true);
    assert.equal((await listAiLimitNotifications(tenant, admin)).unreadCount, 1);
    // Exercise the actual bms_app role, not only a WHERE clause under a superuser.
    const client = await getClient();
    try {
      await beginTenantTx(client, other);
      assert.equal((await client.query('SELECT id FROM bms_ai_limit_notices WHERE tenant_id=$1', [tenant])).rowCount, 0);
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
  await t.test('Business spending over $100 and unknown costs generate no budget warnings or pauses', async () => {
    const tenant = await shop(), user = await owner(tenant);
    await cost(tenant, 150);
    const id = (await tryConsumeAiQuota(tenant, { ...context, model: 'unknown-model' })).eventId!;
    await recordAiProviderAttempt(id);
    await finalizeAiUsageEvent(id, { status: 'failed' });
    const usage = await getAiUsage(tenant);
    assert.equal(usage.sharedBudgetStatus, 'NORMAL');
    assert.equal(usage.sharedBudgetBlocked, false);
    assert.equal(usage.creditStatus, 'NORMAL');
    assert.equal((await listAiLimitNotifications(tenant, user)).items.length, 0);
  });
  await t.test('point top-up clears exhaustion with one recovery notice', async () => {
    const tenant = await shop('free'), user = await owner(tenant);
    await getAiUsage(tenant);
    await query(`UPDATE bms_ai_usage_monthly SET credits_consumed=credits_granted WHERE tenant_id=$1 AND year_month=$2`, [tenant, month]);
    assert.equal((await getAiUsage(tenant)).creditStatus, 'PAUSED_CREDITS');
    await adjustAiCredits(tenant, 20, 'FAKE top-up');
    assert.notEqual((await getAiUsage(tenant)).creditStatus, 'PAUSED_CREDITS');
    await getAiUsage(tenant);
    const notices = await listAiLimitNotifications(tenant, user);
    assert.equal(notices.items.filter(x => x.level === 'RESUMED').length, 1);
    assert.equal(notices.items.filter(x => x.level === 'PAUSED').length, 1);
    assert.ok(notices.items.every(x => x.dimension === 'CREDITS'));
    await cost(tenant, 150);
    assert.equal((await getAiUsage(tenant)).sharedBudgetBlocked, false);
  });
  await t.test('notification insert failure never rolls back point/attempt accounting, and a later read retries', async () => {
    const tenant = await shop('free'), user = await owner(tenant);
    await getAiUsage(tenant);
    await query("UPDATE bms_ai_usage_monthly SET credits_consumed=79 WHERE tenant_id=$1", [tenant]);
    const constraint = 'fake_ai_notice_failure';
    try {
      await query(`ALTER TABLE notifications ADD CONSTRAINT ${constraint} CHECK (user_id <> '${user}'::uuid) NOT VALID`);
      const id = (await tryConsumeAiQuota(tenant, context)).eventId!;
      await recordAiProviderAttempt(id);
      const row = (await query(`SELECT provider_calls,budget_reserved_usd FROM bms_ai_usage_events WHERE id=$1`, [id])).rows[0];
      assert.equal(row.provider_calls, 1);
      assert.equal(Number(row.budget_reserved_usd), 0);
      assert.equal((await listAiLimitNotifications(tenant, user)).items.length, 0);
    } finally { await query(`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ${constraint}`); }
    await getAiUsage(tenant);
    assert.equal((await listAiLimitNotifications(tenant, user)).unreadCount, 1);
  });
  await t.test('legacy budget notices stay stored but do not appear in the AI inbox or unread count', async () => {
    const tenant = await shop(), user = await owner(tenant);
    const notice = (await query("INSERT INTO bms_ai_limit_notices(tenant_id,year_month,dimension,level) VALUES($1,$2,'BUDGET','PAUSED') RETURNING id", [tenant,month])).rows[0];
    await query("INSERT INTO notifications(id,user_id,type,title,message,entity_type,entity_id,data) VALUES(gen_random_uuid(),$1,'bms_ai_limit','FAKE','FAKE','bms_ai_limit_notice',$2,'{}')", [user,notice.id]);
    const inbox = await listAiLimitNotifications(tenant, user);
    assert.equal(inbox.unreadCount, 0);
    assert.equal(inbox.items.length, 0);
    assert.equal((await query("SELECT id FROM bms_ai_limit_notices WHERE id=$1", [notice.id])).rowCount, 1);
  });
  await t.test('old unread notices remain reachable after the newest 30 are read', async () => {
    const tenant = await shop(), user = await owner(tenant);
    await query(`INSERT INTO bms_ai_limit_notices(tenant_id,year_month,dimension,level)
      SELECT $1,to_char(date '2020-01-01' + n * interval '1 month','YYYY-MM'),'CREDITS','WARNING_80'
      FROM generate_series(1,32) n`, [tenant]);
    await query(`INSERT INTO notifications(id,user_id,type,title,message,entity_type,entity_id,data)
      SELECT gen_random_uuid(),$2,'bms_ai_limit','FAKE','FAKE','bms_ai_limit_notice',id,'{}'::jsonb
      FROM bms_ai_limit_notices WHERE tenant_id=$1`, [tenant, user]);
    const first = await listAiLimitNotifications(tenant, user);
    assert.equal(first.unreadCount, 32);
    assert.equal(first.items.length, 30);
    for (const item of first.items) assert.equal(await readAiLimitNotification(tenant, user, item.id), true);
    const remaining = await listAiLimitNotifications(tenant, user);
    assert.equal(remaining.unreadCount, 2);
    assert.equal(remaining.items.filter(x => !x.isRead).length, 2);
  });
});

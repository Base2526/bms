// Writes only its own throwaway tenants. Run against a local migrated test database, never production.
//
// ⚠️ ไฟล์นี้มีอยู่เพราะ `lib/bms/aiUsage.ts` **ไม่เคยมีเทสสักตัว** ทั้ง pure และ DB แล้ว
// `finalizeAiUsageEvent` ก็ล้ม 100% อยู่บน BMS-LIVE เป็นเดือนโดยไม่มีอะไรฟ้อง — ต้นเหตุคือ
// `COALESCE($3, 0)` ที่ Postgres infer พารามิเตอร์เป็น integer จาก literal `0` แล้วค่าใช้ที่เป็น
// ทศนิยม throw `invalid input syntax for type integer` ทั้งทรานแซกชัน
//
// เทสที่ฉีด `deps.finalizeUsage` ปลอม (scripts/ai-eval/runtime-contract.test.mts) จับไม่ได้เลย
// เพราะมัน assert แค่ *payload ที่ caller ประกอบ* ไม่ใช่สิ่งที่ลงฐาน — ไฟล์นี้จึงต้องเรียกของจริง
import assert from 'node:assert/strict';
import test from 'node:test';
import { query } from '../apps/web/lib/db';
import {
  currentYearMonth,
  finalizeAiUsageEvent,
  getAiUsage,
  listAiUsageBreakdown,
  recordAiProviderAttempt,
  tryConsumeAiQuota,
} from '../apps/web/lib/bms/aiUsage';

// ⚠️ provider ต้องเป็นชื่อที่ `isTrackedAiProvider` ไม่รู้จัก (ไม่ใช่ anthropic/deepseek/qwen)
// ไม่งั้น finalize จะไปเขียน `bms_ai_provider_health` ซึ่งเป็นตาราง **ระดับแพลตฟอร์ม ไม่มี tenant_id**
// = เทสไปทับสถานะ provider ของจริง · rate card ยังถูกใช้อยู่เพราะ priceForModel ตัดสินจาก *model*
// เมื่อ provider ไม่ใช่ deepseek/qwen จึงยังได้ราคาของ haiku 4.5 ตามปกติ
const PROVIDER = 'fake-test-provider';
const PRICED_MODEL = 'claude-haiku-4-5-fake';   // haiku 4.5: input $1/M · output $5/M
const UNPRICED_MODEL = 'fake-model-not-on-rate-card';

// golden คำนวณมือ ไม่ได้ก็อปจาก output: 12,345 × $1/M = 0.012345 · 678 × $5/M = 0.003390
const IN_TOKENS = 12_345;
const OUT_TOKENS = 678;
const EXPECTED_COST = 0.015735;

test('AI usage accounting: fractional cost, one-shot finalize, refunds and quota', async t => {
  assert.ok(
    ['localhost', '127.0.0.1', '::1', 'postgres', 'db'].includes(process.env.POSTGRES_HOST ?? ''),
    'local test DB required'
  );
  const tenantIds: string[] = [];
  t.after(async () => {
    if (!tenantIds.length) return;
    // notifications ถูกสร้างให้ platform admin *ตัวจริง* เมื่อมี incident — ต้องล้างด้วย
    // ไม่งั้นเทสไปขึ้นกระดิ่งแจ้งเตือนของผู้ใช้จริงบนฐาน dev
    await query(
      `DELETE FROM notifications WHERE entity_type = 'bms_failure_incident' AND entity_id = ANY($1::uuid[])`,
      [tenantIds]
    );
    for (const table of ['bms_ai_credit_ledger', 'bms_ai_usage_events', 'bms_ai_usage_monthly', 'bms_failure_incidents']) {
      await query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
    }
    await query('DELETE FROM bms_tenants WHERE id = ANY($1::uuid[])', [tenantIds]);
  });

  const tenantId: string = (
    await query(`INSERT INTO bms_tenants(name, slug) VALUES ($1, $2) RETURNING id`, [
      'FAKE ai usage test',
      `fake-ai-usage-${crypto.randomUUID()}`,
    ])
  ).rows[0].id;
  tenantIds.push(tenantId);
  // ใช้สูตรเดียวกับโค้ด (UTC) ไม่ hardcode — เดือนตัดด้วย UTC ซึ่งเป็นเรื่องที่ยังค้างอยู่แยกต่างหาก
  const yearMonth = currentYearMonth();

  const event = async (id: string) =>
    (
      await query(
        `SELECT status, input_tokens, output_tokens, estimated_cost, actual_cost_usd,
                provider_calls, unpriced_provider_calls, credits_used, billable_credits,
                error_message, completed_at, meta
           FROM bms_ai_usage_events WHERE id = $1`,
        [id]
      )
    ).rows[0];
  const monthly = async () =>
    (
      await query(
        `SELECT count, shared_requests, blocked_requests, credits_granted, credits_consumed, estimated_cost
           FROM bms_ai_usage_monthly WHERE tenant_id = $1 AND year_month = $2`,
        [tenantId, yearMonth]
      )
    ).rows[0];
  const incidents = async (code: string) =>
    (
      await query(
        `SELECT meta->>'eventId' AS event_id FROM bms_failure_incidents
          WHERE tenant_id = $1 AND code = $2 ORDER BY created_at`,
        [tenantId, code]
      )
    ).rows;
  const ledger = async (entryType: string) =>
    (
      await query(
        `SELECT amount, reference_type, reference_id FROM bms_ai_credit_ledger
          WHERE tenant_id = $1 AND entry_type = $2 ORDER BY created_at`,
        [tenantId, entryType]
      )
    ).rows;
  const reserve = async (feature: string, model: string) => {
    const res = await tryConsumeAiQuota(tenantId, { surface: 'system', feature, provider: PROVIDER, model });
    assert.equal(res.ok, true, 'reservation must succeed while quota remains');
    return res.eventId as string;
  };

  await t.test('a fractional provider cost reaches both the event and the monthly summary', async () => {
    const before = await monthly();
    const id = await reserve('fake_priced', PRICED_MODEL);
    await recordAiProviderAttempt(id);
    assert.equal(Number((await event(id)).provider_calls), 1, 'attempt must be persisted before network I/O');

    await finalizeAiUsageEvent(id, {
      status: 'completed',
      inputTokens: IN_TOKENS,
      outputTokens: OUT_TOKENS,
      providerCalls: 1,
    });

    const row = await event(id);
    assert.equal(row.status, 'completed');
    assert.ok(row.completed_at, 'finalize must close the row; a row left open gets swept as failed');
    assert.equal(Number(row.input_tokens), IN_TOKENS);
    assert.equal(Number(row.output_tokens), OUT_TOKENS);
    assert.equal(Number(row.actual_cost_usd), EXPECTED_COST);
    assert.equal(Number(row.unpriced_provider_calls), 0);
    assert.equal(Number(row.billable_credits), 1, 'a real provider call keeps its credit');
    assert.equal(row.meta.cost_status, 'measured');
    assert.equal(row.meta.rate_status, 'known');

    const after = await monthly();
    assert.equal(
      Number(after.estimated_cost) - Number(before?.estimated_cost ?? 0),
      EXPECTED_COST,
      'monthly cost must move by exactly the measured cost'
    );
    // ตัวชี้ที่ตรงที่สุดว่าบั๊กกลับมา: finalize ที่ throw จะทิ้ง incident ไว้แล้วแถวค้าง started
    assert.equal((await incidents('ai.usage_finalize_failed')).length, 0);
  });

  await t.test('finalize is one-shot: a second call cannot double-count cost', async () => {
    const id = await reserve('fake_replay', PRICED_MODEL);
    await recordAiProviderAttempt(id);
    await finalizeAiUsageEvent(id, { status: 'completed', inputTokens: IN_TOKENS, outputTokens: OUT_TOKENS, providerCalls: 1 });
    const once = await monthly();
    await finalizeAiUsageEvent(id, { status: 'completed', inputTokens: IN_TOKENS, outputTokens: OUT_TOKENS, providerCalls: 1 });
    assert.equal(Number((await monthly()).estimated_cost), Number(once.estimated_cost));
  });

  await t.test('a reservation that never reached the provider is refunded, with a ledger entry', async () => {
    const before = await monthly();
    const id = await reserve('fake_unused', PRICED_MODEL);
    assert.equal(Number((await monthly()).credits_consumed), Number(before.credits_consumed) + 1);

    await finalizeAiUsageEvent(id, { status: 'failed', providerCalls: 0, errorMessage: 'aborted before provider' });

    const row = await event(id);
    assert.equal(Number(row.billable_credits), 0);
    assert.equal(Number(row.credits_used), 0);
    assert.equal(Number(row.actual_cost_usd), 0, 'no call means a known zero, not an unknown cost');
    assert.equal(row.meta.credit_refund_reason, 'provider_not_called');
    assert.equal(Number((await monthly()).credits_consumed), Number(before.credits_consumed));
    assert.equal((await ledger('refund')).filter(r => r.reference_id === id).length, 1);
  });

  await t.test('an unknown rate card keeps the tokens and reports unpriced calls instead of a fake $0', async () => {
    const before = await monthly();
    const id = await reserve('fake_unpriced', UNPRICED_MODEL);
    await recordAiProviderAttempt(id);
    await recordAiProviderAttempt(id);
    await finalizeAiUsageEvent(id, { status: 'completed', inputTokens: 4_000, outputTokens: 200, providerCalls: 2 });

    const row = await event(id);
    assert.equal(row.status, 'completed');
    assert.equal(Number(row.input_tokens), 4_000, 'not knowing the price must not lose the token count');
    assert.equal(Number(row.output_tokens), 200);
    assert.equal(row.actual_cost_usd, null, '"unknown" must never be stored as $0');
    assert.equal(Number(row.unpriced_provider_calls), 2);
    assert.equal(row.meta.rate_status, 'unknown_model');
    assert.equal(Number((await monthly()).estimated_cost), Number(before.estimated_cost), 'an unpriced call adds no cost');
  });

  await t.test('the stale sweep separates an abort from an unrecorded attempt from a failed finalize', async () => {
    const aborted = await reserve('fake_stale_aborted', PRICED_MODEL);
    const unrecorded = await reserve('fake_stale_unrecorded', PRICED_MODEL);
    const finalizeFailed = await reserve('fake_stale_finalize', PRICED_MODEL);
    await recordAiProviderAttempt(finalizeFailed);
    await recordAiProviderAttempt(finalizeFailed);
    // ร่องรอยที่ `recordAiProviderAttempt` ทิ้งไว้เมื่อเขียนไม่ลง — เป็นสิ่งเดียวที่แยก
    // "ยังไม่ได้เรียก provider" ออกจาก "เรียกไปแล้วแต่บันทึกพลาด" ได้ (แถวหน้าตาเหมือนกันเป๊ะ)
    await query(
      `INSERT INTO bms_failure_incidents(tenant_id, code, tier, surface, error_message, meta)
       VALUES ($1, 'ai.provider_attempt_unrecorded', 'B', 'system', 'seeded by test', $2::jsonb)`,
      [tenantId, JSON.stringify({ eventId: unrecorded })]
    );
    await query(
      `UPDATE bms_ai_usage_events SET created_at = now() - interval '30 minutes' WHERE id = ANY($1::uuid[])`,
      [[aborted, unrecorded, finalizeFailed]]
    );
    const before = await monthly();

    await getAiUsage(tenantId); // ตัวกวาดถูกเรียกจากที่นี่ (ยังไม่ได้ย้ายไป cron)

    const a = await event(aborted);
    assert.equal(a.status, 'failed');
    assert.equal(Number(a.billable_credits), 0, 'an abort before the provider is a real refund');
    assert.equal(a.error_message, 'provider_not_started_timeout');

    const u = await event(unrecorded);
    assert.equal(Number(u.billable_credits), 1, 'money was already spent — refunding it hands out free quota');
    assert.equal(u.error_message, 'provider_attempt_unrecorded');
    assert.equal(u.meta.credit_kept_reason, 'provider_attempt_unrecorded');

    const f = await event(finalizeFailed);
    assert.equal(Number(f.billable_credits), 1);
    assert.equal(f.error_message, 'usage_finalization_timeout');
    assert.equal(f.meta.cost_status, 'partial_or_unavailable');

    assert.equal(
      Number(before.credits_consumed) - Number((await monthly()).credits_consumed),
      1,
      'exactly one of the three stale rows may return a credit'
    );
  });

  await t.test('a provider attempt that cannot be recorded never throws and leaves a trace', async () => {
    // ⚠️ subtest นี้ใช้เวลา ~5 วินาทีบนเครื่องที่ Redis เข้าไม่ถึง (docker ไม่ได้ publish 6379)
    // เพราะ reportBmsFailure แจ้ง platform admin จริงแล้วชน NOTIFY_TIMEOUT_MS — **ไม่ใช่การค้าง
    // และห้าม "แก้" ด้วยการถอด assert ทิ้ง**: การที่ทั้งเส้นยังจบได้ทั้งที่ช่องทางแจ้งเตือนพัง
    // คือการันตีที่ subtest นี้มีไว้ตรึง (accounting ล้มต้องไม่ทำให้คำตอบลูกค้าล้ม)
    // id ที่ไม่มีในตาราง: หา tenant ไม่ได้ จึงไม่มี incident ให้เขียน — ต้องไม่ throw เท่านั้น
    await recordAiProviderAttempt(crypto.randomUUID());

    // แถวที่ปิดไปแล้ว: UPDATE ได้ 0 แถวแบบไม่มี error ซึ่งคือรูปของการล้มเงียบ ๆ ที่ต้องมีร่องรอย
    const id = await reserve('fake_closed_row', PRICED_MODEL);
    await recordAiProviderAttempt(id);
    await finalizeAiUsageEvent(id, { status: 'completed', inputTokens: 10, outputTokens: 10, providerCalls: 1 });
    await recordAiProviderAttempt(id);
    assert.deepEqual(
      (await incidents('ai.provider_attempt_unrecorded')).map(r => r.event_id).filter(e => e === id),
      [id]
    );
    assert.equal(Number((await event(id)).provider_calls), 1, 'a closed row must not gain another attempt');
  });
  await t.test('the monthly credit counter equals the sum the events actually hold', async () => {
    // รูปเดียวกับ balanceMismatchCount ของ loyalty/store credit/AR: ตัวนับรายเดือนถูกดูแลด้วย
    // การบวก/ลบทีละครั้ง ขณะที่ events ถือความจริง — ถ้าไม่บังคับให้เท่ากัน ตัวเลขบนหน้า Billing
    // จะ drift โดยไม่มีใครเห็น (พบ drift จริง 190 vs 179 ในฐาน dev)
    const events = Number(
      (
        await query(
          `SELECT COALESCE(SUM(billable_credits), 0)::int AS n FROM bms_ai_usage_events
            WHERE tenant_id = $1 AND year_month = $2`,
          [tenantId, yearMonth]
        )
      ).rows[0].n
    );
    assert.equal(Number((await monthly()).credits_consumed), events);
  });

  await t.test('getAiUsage reports the tokens the events actually recorded', async () => {
    // หน้า Billing ไม่เคยแสดงโทเคนเลยมาตลอด และ getAiUsage ก็ไม่เคยคืนมาให้
    // ฟิลด์ที่คืน 0 เสมอแยกจาก "เดือนนี้ยังไม่ได้ใช้" ไม่ออก จึงต้องผูกกับผลรวมจริงของ events
    const expected = (
      await query(
        `SELECT COALESCE(SUM(input_tokens), 0)::int AS input, COALESCE(SUM(output_tokens), 0)::int AS output
           FROM bms_ai_usage_events WHERE tenant_id = $1 AND year_month = $2`,
        [tenantId, yearMonth]
      )
    ).rows[0];
    assert.ok(Number(expected.input) > 0, 'fixture must have recorded tokens by now');
    const usage = await getAiUsage(tenantId);
    assert.equal(usage.inputTokens, Number(expected.input));
    assert.equal(usage.outputTokens, Number(expected.output));
    // โทเคนต้องไม่ไปโผล่ในหน่วยของโควตา — `count` คือเครดิต ไม่ใช่โทเคน
    assert.equal(usage.count, Number((await monthly()).credits_consumed));
    assert.equal(usage.limit, 1000, 'free plan quota is 1000 requests, not 1000 tokens');

    // ยอดรวมตอบว่าใช้ไปเท่าไร แต่ "ฟีเจอร์ไหนกิน" คือคำถามถัดไปเสมอ
    const breakdown = await listAiUsageBreakdown(tenantId);
    const priced = breakdown.find(row => row.feature === 'fake_priced');
    assert.ok(priced, 'breakdown ต้องมีแถวของฟีเจอร์ที่เพิ่งใช้');
    assert.equal(priced.inputTokens, IN_TOKENS);
    assert.equal(priced.outputTokens, OUT_TOKENS);
    assert.equal(
      breakdown.reduce((sum, row) => sum + row.inputTokens, 0),
      Number(expected.input),
      'โทเคนแยกตามฟีเจอร์ต้องรวมได้เท่ายอดของเดือน'
    );
  });

  await t.test('an exhausted quota blocks the request instead of letting the balance go negative', async () => {
    // ⚠️ subtest นี้แก้ตัวนับด้วยมือ (เร็วกว่ายิง 1,000 ครั้ง) จึงต้องอยู่ **หลัง** เทส invariant ข้างบน
    const row = await monthly();
    await query(
      `UPDATE bms_ai_usage_monthly SET credits_consumed = credits_granted
        WHERE tenant_id = $1 AND year_month = $2`,
      [tenantId, yearMonth]
    );
    const blockedBefore = Number(row.blocked_requests);
    const res = await tryConsumeAiQuota(tenantId, { surface: 'system', feature: 'fake_blocked', provider: PROVIDER, model: PRICED_MODEL });
    assert.equal(res.ok, false);
    const after = await monthly();
    assert.equal(Number(after.credits_consumed), Number(after.credits_granted), 'a blocked request must not overdraw');
    assert.equal(Number(after.blocked_requests), blockedBefore + 1);
    const blocked = await event(res.eventId as string);
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.error_message, 'quota_exhausted');
    assert.equal(Number(blocked.billable_credits), 0);
  });

});

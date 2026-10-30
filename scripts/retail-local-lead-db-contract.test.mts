import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { getClient, closeDatabasePool } from "../apps/web/lib/db.ts";
import { createRetailLocalLead, listRetailLocalLeads, updateRetailLocalLead } from "../apps/web/lib/bms/retailLocalLeads.ts";

after(closeDatabasePool);

test("lead submission, RLS, revision and transactional audit under bms_app", async () => {
  const c = await getClient();
  try {
    await c.query("BEGIN");
    const admin = (await c.query(`SELECT id FROM users WHERE is_platform_admin = TRUE LIMIT 1`)).rows[0];
    const staff = (await c.query(`SELECT id FROM users WHERE is_platform_admin = FALSE AND role='Administrator' LIMIT 1`)).rows[0];
    assert.ok(admin, "Restored test DB needs a platform-admin fixture");
    assert.ok(staff, "Restored test DB needs a shop Administrator fixture");
    await c.query("SET LOCAL ROLE bms_app");
    const role = (await c.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
    assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
    await c.query(`SELECT public.bms_submit_retail_local_lead('FAKE-lead-contract',NULL,NULL,'fake-test-contact',NULL,'windows','th','retail-local-lead-v1')`);
    assert.equal((await c.query(`SELECT id FROM bms_retail_local_leads`)).rowCount, 0);
    await c.query(`SELECT set_config('app.editor_id',$1,true)`, [staff.id]);
    assert.equal((await c.query(`SELECT id FROM bms_retail_local_leads`)).rowCount, 0);
    assert.equal((await c.query(`UPDATE bms_retail_local_leads SET status='PAID' RETURNING id`)).rowCount, 0);
    await c.query(`SELECT set_config('app.editor_id',$1,true)`, [admin.id]);
    const row = (await c.query(`SELECT id FROM bms_retail_local_leads WHERE shop_name='FAKE-lead-contract' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    assert.ok(row);
    await c.query(`UPDATE bms_retail_local_leads SET status='CONTACTED',note='FAKE note',follow_up_at=now() WHERE id=$1`, [row.id]);
    await c.query(`INSERT INTO bms_retail_local_lead_events(lead_id,actor_id,action,previous_status,next_status,note_changed) VALUES($1,$2,'LEAD_UPDATED','NEW','CONTACTED',true)`, [row.id, admin.id]);
    assert.equal((await c.query(`SELECT snapshot->>'status' AS status FROM bms_retail_local_leads_revisions WHERE lead_id=$1`, [row.id])).rows[0].status, "NEW");
    for (const args of [[null,null],["",""]]) {
      await c.query("SAVEPOINT invalid_contact");
      await assert.rejects(c.query(`SELECT public.bms_submit_retail_local_lead(NULL,NULL,$1,$2,NULL,'windows','th','retail-local-lead-v1')`,args));
      await c.query("ROLLBACK TO SAVEPOINT invalid_contact");
    }
    await c.query("SAVEPOINT immutable_consent");
    await assert.rejects(c.query(`UPDATE bms_retail_local_leads SET consent_at=now()+interval '1 day' WHERE id=$1`,[row.id]));
    await c.query("ROLLBACK TO SAVEPOINT immutable_consent");
    for (const sql of [
      `INSERT INTO bms_retail_local_leads(line_id,platform,locale,consent_at,consent_text_version) VALUES('fake-direct','windows','th',now(),'fake')`,
      `DELETE FROM bms_retail_local_leads_revisions WHERE lead_id='${row.id}'`,
      `UPDATE bms_retail_local_lead_events SET next_status='PAID' WHERE lead_id='${row.id}'`,
    ]) {
      await c.query("SAVEPOINT denied_write");
      await assert.rejects(c.query(sql), (error: any) => error.code === "42501");
      await c.query("ROLLBACK TO SAVEPOINT denied_write");
    }
    await c.query(`SELECT set_config('app.editor_id',$1,true)`, [staff.id]);
    for (const table of ['bms_retail_local_leads','bms_retail_local_leads_revisions','bms_retail_local_lead_events']) {
      assert.equal((await c.query(`SELECT * FROM ${table}`)).rowCount, 0, `${table} must hide its populated rows from shop administrators`);
    }
  } finally { await c.query("ROLLBACK"); c.release(); }
});

test("all lead tables have RLS and public function access is narrow", async () => {
  const c = await getClient();
  try {
    const tables = ["bms_retail_local_leads", "bms_retail_local_leads_revisions", "bms_retail_local_lead_events"];
    const rows = (await c.query(`SELECT relname,relrowsecurity FROM pg_class WHERE relname=ANY($1::text[])`, [tables])).rows;
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => row.relrowsecurity));
    const privileges = (await c.query(`SELECT
      has_table_privilege('bms_app','bms_retail_local_leads','INSERT') AS direct_insert,
      has_table_privilege('bms_app','bms_retail_local_leads','DELETE') AS direct_delete,
      has_function_privilege('bms_app','bms_submit_retail_local_lead(text,text,text,text,text,text,text,text)','EXECUTE') AS submit`)).rows[0];
    assert.deepEqual(privileges, { direct_insert: false, direct_delete: false, submit: true });
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM pg_proc p,
      LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.proname IN ('bms_submit_retail_local_lead','bms_is_current_platform_admin') AND a.grantee=0 AND a.privilege_type='EXECUTE'`)).rows[0].n, 0);
  } finally { c.release(); }
});

test("real lead services enforce actor identity and roll back the update when its audit fails", async () => {
  const c = await getClient();
  const marker = `FAKE-lead-service-${randomUUID()}`;
  let id: string | undefined;
  try {
    const adminId = (await c.query(`SELECT id FROM users WHERE is_platform_admin=TRUE LIMIT 1`)).rows[0]?.id;
    const staffId = (await c.query(`SELECT id FROM users WHERE is_platform_admin=FALSE AND role='Administrator' LIMIT 1`)).rows[0]?.id;
    assert.ok(adminId && staffId);
    assert.equal(await createRetailLocalLead({ shopName: marker, consent: true, lineId: 'fake-service', platform: 'windows', locale: 'th' }), undefined);
    id = (await c.query(`SELECT id FROM bms_retail_local_leads WHERE shop_name=$1`, [marker])).rows[0].id;
    await assert.rejects(listRetailLocalLeads({ adminId: staffId }), (error: any) => error.status === 403);
    await assert.rejects(updateRetailLocalLead({ id: id!, adminId: staffId, status: 'PAID', note: null, followUpAt: null }), (error: any) => error.status === 403);
    const before = (await listRetailLocalLeads({ adminId, status: 'NEW' })).find(row => row.id === id);
    assert.ok(before?.consent_at);
    await updateRetailLocalLead({ id: id!, adminId, status: 'CONTACTED', note: 'FAKE service note', followUpAt: '2026-11-01T03:30:00Z' });
    // A constraint affects only this UUID in the throwaway DB. Force failure AFTER the lead UPDATE.
    await c.query(`ALTER TABLE bms_retail_local_lead_events ADD CONSTRAINT retail_local_lead_test_audit_failure CHECK (lead_id <> '${id}'::uuid OR next_status <> 'PAID')`);
    await assert.rejects(updateRetailLocalLead({ id: id!, adminId, status: 'PAID', note: 'must roll back', followUpAt: null }), (error: any) => error.code === '23514');
    const saved = (await c.query(`SELECT status,note FROM bms_retail_local_leads WHERE id=$1`, [id])).rows[0];
    assert.deepEqual(saved, { status: 'CONTACTED', note: 'FAKE service note' });
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM bms_retail_local_lead_events WHERE lead_id=$1`, [id])).rows[0].n, 1);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM bms_retail_local_leads_revisions WHERE lead_id=$1`, [id])).rows[0].n, 1);
  } finally {
    await c.query(`ALTER TABLE bms_retail_local_lead_events DROP CONSTRAINT IF EXISTS retail_local_lead_test_audit_failure`);
    if (id) {
      await c.query('BEGIN');
      for (const table of ['bms_retail_local_lead_events','bms_retail_local_leads_revisions']) await c.query(`DELETE FROM ${table} WHERE lead_id=$1`, [id]);
      await c.query(`DELETE FROM bms_retail_local_leads WHERE id=$1`, [id]);
      await c.query('COMMIT');
    }
    c.release();
  }
});

test("10.105 executes twice without losing existing data or policies", {
  skip: process.env.POSTGRES_DB !== 'bms_retail_local_commercial_test',
}, async () => {
  const c = await getClient();
  let sentinelId: string | undefined;
  try {
    const marker = `FAKE-migration-${randomUUID()}`;
    await c.query(`SELECT bms_submit_retail_local_lead($1,NULL,NULL,'fake-migration',NULL,'windows','th','retail-local-lead-v1')`, [marker]);
    const original = (await c.query(`SELECT * FROM bms_retail_local_leads WHERE shop_name=$1`, [marker])).rows[0];
    sentinelId = original.id;
    const before = (await c.query(`SELECT count(*)::int AS n FROM bms_retail_local_leads`)).rows[0].n;
    const sql = readFileSync(new URL('../db/migrations/10.105__bms_retail_local_leads.sql', import.meta.url), 'utf8');
    await c.query(sql);
    await c.query(sql);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM bms_retail_local_leads`)).rows[0].n, before);
    assert.deepEqual((await c.query(`SELECT * FROM bms_retail_local_leads WHERE id=$1`, [sentinelId])).rows[0], original);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename=ANY($1::text[])`, [['bms_retail_local_leads','bms_retail_local_leads_revisions','bms_retail_local_lead_events']])).rows[0].n, 3);
  } finally {
    if (sentinelId) await c.query(`DELETE FROM bms_retail_local_leads WHERE id=$1`, [sentinelId]);
    c.release();
  }
});

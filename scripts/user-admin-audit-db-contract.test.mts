/** Run only on the restored, disposable local BMS database. */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { assertNoActiveStaffAssignments, auditUserChangeInTx } from "../apps/web/lib/bms/userAdmin.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { Pool } = require("pg");

test("disposable DB: team account and audit commit together or roll back together", {
  skip: process.env.BMS_TEAM_DISPOSABLE_DB !== "1",
}, async () => {
  assert.equal(process.env.POSTGRES_HOST, "127.0.0.1");
  assert.equal(process.env.POSTGRES_PORT, "5433");
  assert.equal(process.env.POSTGRES_DB, "bms_realtime_test");
  const pool = new Pool({ host: "127.0.0.1", port: 5433, database: "bms_realtime_test",
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, max: 2 });
  const suffix = randomUUID();
  // Staff actor ids are UUIDs: since 10.131 the actor is also stored in bms_audit_log.actor_user_id.
  const actor = randomUUID();
  const email = `fake-team-audit-${suffix}@example.invalid`;
  let committedId: string | undefined;
  try {
    const tenantId = (await pool.query("SELECT id FROM bms_tenants ORDER BY id LIMIT 1")).rows[0]?.id;
    assert.ok(tenantId, "restored test baseline needs a tenant");

    const first = await pool.connect();
    try {
      await first.query("BEGIN");
      const inserted = await first.query(
        `INSERT INTO users(name,email,role_id,password_hash,tenant_id,fake_test)
         SELECT 'FAKE team audit', $1, id, 'FAKE unused hash', $2, TRUE
           FROM roles WHERE name='Sales' RETURNING id`, [email, tenantId]);
      assert.equal(inserted.rowCount, 1);
      await assert.rejects(
        auditUserChangeInTx(first, randomUUID(), actor, "user.create", inserted.rows[0].id,
          { role: "Sales" }), /foreign key|violates|23503/i);
      await first.query("ROLLBACK");
    } finally { first.release(); }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM users WHERE email=$1", [email])).rows[0].n, 0);

    const second = await pool.connect();
    try {
      await second.query("BEGIN");
      const inserted = await second.query(
        `INSERT INTO users(name,email,role_id,password_hash,tenant_id,fake_test)
         SELECT 'FAKE team audit', $1, id, 'FAKE unused hash', $2, TRUE
           FROM roles WHERE name='Sales' RETURNING id`, [email, tenantId]);
      assert.equal(inserted.rowCount, 1);
      committedId = inserted.rows[0].id;
      await auditUserChangeInTx(second, tenantId, actor, "user.create", committedId!,
        { role: "Sales" });
      await second.query("COMMIT");
    } catch (error) {
      await second.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { second.release(); }
    const saved = await pool.query(
      `SELECT u.id, a.action FROM users u JOIN bms_audit_log a
         ON a.tenant_id=u.tenant_id AND a.target=u.id::text
        WHERE u.email=$1 AND a.action='user.create'`, [email]);
    assert.equal(saved.rowCount, 1);
    assert.equal(saved.rows[0].id, committedId);
  } finally {
    if (committedId) {
      await pool.query("DELETE FROM bms_audit_log WHERE target=$1 AND action='user.create'", [committedId]);
      await pool.query("DELETE FROM users WHERE id=$1 AND email=$2", [committedId, email]);
    }
    await pool.end();
  }
});

test("disposable DB: a live supervisor assignment blocks deletion and an inactive one does not", {
  skip: process.env.BMS_TEAM_DISPOSABLE_DB !== "1",
}, async () => {
  assert.equal(process.env.POSTGRES_HOST, "127.0.0.1");
  assert.equal(process.env.POSTGRES_PORT, "5433");
  assert.equal(process.env.POSTGRES_DB, "bms_realtime_test");
  const pool = new Pool({ host: "127.0.0.1", port: 5433, database: "bms_realtime_test",
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, max: 1 });
  const client = await pool.connect();
  try {
    const location = (await client.query("SELECT tenant_id, id FROM bms_locations ORDER BY id LIMIT 1")).rows[0];
    assert.ok(location, "restored test baseline needs a location");
    const assignedId = randomUUID();
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO bms_operation_policies
       (tenant_id,location_id,supervisor_id,reminder_minutes,escalation_minutes,enabled,updated_by)
       VALUES($1,$2,$3,15,60,TRUE,'FAKE-test')`,
      [location.tenant_id, location.id, assignedId]
    );
    await assert.rejects(
      assertNoActiveStaffAssignments(client, location.tenant_id, assignedId), /ผู้รับแจ้งเตือนงาน/
    );
    await client.query(
      "UPDATE bms_operation_policies SET enabled=FALSE WHERE tenant_id=$1 AND location_id=$2",
      [location.tenant_id, location.id]
    );
    await assert.doesNotReject(assertNoActiveStaffAssignments(client, location.tenant_id, assignedId));
    await client.query("ROLLBACK");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});

/** Run only after 10.122 on a disposable restored local BMS database. */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { Pool } = require("pg");
const ts = require("typescript") as typeof import("typescript");
const enabled = process.env.BMS_AUDIT_DISPOSABLE_DB === "1";

function localPool() {
  assert.equal(process.env.POSTGRES_HOST, "127.0.0.1");
  assert.equal(process.env.POSTGRES_PORT, "5433");
  assert.equal(process.env.POSTGRES_DB, "bms_realtime_test");
  return new Pool({ host: "127.0.0.1", port: 5433, database: "bms_realtime_test",
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, max: 2 });
}

function timelineOnClient(client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) {
  const source = readFileSync(new URL("../apps/web/lib/bms/auditTimeline.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as { listAuditTimeline: (tenant: string, filter: Record<string, unknown>) => Promise<any> } };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.equal(name, "@/lib/db");
    return { query: (sql: string, params: unknown[]) => client.query(sql, params) };
  }, module, module.exports);
  return module.exports.listAuditTimeline;
}

test("disposable DB: long-history cursor merge preserves exact actor and source ordering", {
  skip: !enabled,
}, async () => {
  const pool = localPool();
  const client = await pool.connect();
  try {
    const tenant = (await client.query("SELECT id FROM bms_tenants ORDER BY id LIMIT 1")).rows[0]?.id;
    assert.ok(tenant);
    const actor = randomUUID();
    const at = new Date(Date.now() - 60_000).toISOString();
    await client.query("BEGIN");
    for (const [textActor, stableId, action] of [
      [actor, actor, "FAKE.audit.new"],
      [actor, null, "FAKE.audit.legacy_raw"],
      [`user:${actor}`, null, "FAKE.audit.legacy_prefixed"],
    ]) {
      await client.query(`INSERT INTO bms_audit_log
        (tenant_id, actor, actor_user_id, action, created_at)
        VALUES ($1,$2,$3,$4,$5)`, [tenant, textActor, stableId, action, at]);
    }
    await client.query(`INSERT INTO bms_security_events
      (tenant_id, actor_user_id, event, outcome, source, created_at)
      VALUES ($1,$2,'auth.login','SUCCESS','TEST',$3)`, [tenant, actor, at]);
    const index = await client.query(`SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND tablename='bms_audit_log' AND indexname='idx_bms_audit_legacy_actor_time'`);
    assert.equal(index.rowCount, 1, "apply 10.123 before running this test");

    const list = timelineOnClient(client);
    const first = await list(tenant, { actorUserId: actor, limit: 2 });
    assert.deepEqual(first.nodes.map((entry: any) => entry.action),
      ["FAKE.audit.legacy_prefixed", "FAKE.audit.legacy_raw"]);
    assert.ok(first.nextCursor);
    const second = await list(tenant, { actorUserId: actor, limit: 2, cursor: first.nextCursor });
    assert.deepEqual(second.nodes.map((entry: any) => entry.action),
      ["FAKE.audit.new", "auth.login"]);
    assert.equal(second.nextCursor, null);
    const searched = await list(tenant, { actorUserId: actor, q: "legacy_prefixed" });
    assert.deepEqual(searched.nodes.map((entry: any) => entry.action), ["FAKE.audit.legacy_prefixed"]);
    await client.query("ROLLBACK");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});

test("disposable DB: tenant audit role cannot rewrite evidence and security events are tenant scoped", {
  skip: !enabled,
}, async () => {
  const pool = localPool();
  const client = await pool.connect();
  try {
    const tenant = (await client.query("SELECT id FROM bms_tenants ORDER BY id LIMIT 1")).rows[0]?.id;
    assert.ok(tenant);
    const privileges = await client.query(`SELECT
      has_table_privilege('bms_app','bms_audit_log','INSERT') AS can_insert,
      has_table_privilege('bms_app','bms_audit_log','UPDATE') AS can_update,
      has_table_privilege('bms_app','bms_audit_log','DELETE') AS can_delete`);
    assert.deepEqual(privileges.rows[0], { can_insert: true, can_update: false, can_delete: false });

    await client.query("BEGIN");
    const global = await client.query(`INSERT INTO bms_security_events(tenant_id,event,outcome,source)
      VALUES(NULL,'auth.login','SUCCESS','TEST') RETURNING id`);
    await client.query("SET LOCAL ROLE bms_app");
    await client.query("SELECT set_config('bms.tenant_id',$1,true)", [tenant]);
    await client.query(`INSERT INTO bms_security_events(tenant_id,event,outcome,source)
      VALUES($1,'auth.login','SUCCESS','TEST')`, [tenant]);
    const hidden = await client.query("SELECT id FROM bms_security_events WHERE id=$1", [global.rows[0].id]);
    assert.equal(hidden.rowCount, 0, "a tenant role cannot read platform-global events");
    await assert.rejects(client.query(`INSERT INTO bms_security_events(tenant_id,event,outcome,source)
      VALUES($1,'auth.login','SUCCESS','TEST')`, [randomUUID()]), /row-level security|42501/i);
    await client.query("ROLLBACK");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});

test("disposable DB: event key prevents duplicate business decisions and rollback removes evidence", {
  skip: !enabled,
}, async () => {
  const pool = localPool();
  const client = await pool.connect();
  try {
    const tenant = (await client.query("SELECT id FROM bms_tenants ORDER BY id LIMIT 1")).rows[0]?.id;
    assert.ok(tenant);
    const key = `FAKE-audit-${randomUUID()}`;
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bms_app");
    await client.query("SELECT set_config('bms.tenant_id',$1,true)", [tenant]);
    for (let i = 0; i < 2; i++) {
      await client.query(`INSERT INTO bms_audit_log(tenant_id,actor,action,event_key)
        VALUES($1,'FAKE-test','test.audit_event',$2)
        ON CONFLICT (tenant_id,event_key) WHERE event_key IS NOT NULL DO NOTHING`, [tenant, key]);
    }
    const count = await client.query(`SELECT count(*)::int AS n FROM bms_audit_log
      WHERE tenant_id=$1 AND event_key=$2`, [tenant, key]);
    assert.equal(count.rows[0].n, 1);
    await client.query("ROLLBACK");
    const absent = await pool.query("SELECT count(*)::int AS n FROM bms_audit_log WHERE event_key=$1", [key]);
    assert.equal(absent.rows[0].n, 0);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});

// Disposable in-memory PostgreSQL smoke for the audit read path. No external DB.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { PGlite } = require(process.env.BMS_PGLITE_MODULE || "@electric-sql/pglite");
const ts = require("typescript");
const db = new PGlite();
const tenant = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const auditRows = Number(process.env.BMS_AUDIT_PGLITE_ROWS || 100000);
assert.ok(Number.isInteger(auditRows) && auditRows >= 100000 && auditRows <= 1000000);
const securityRows = Math.floor(auditRows / 10);

try {
  await db.exec(`
    CREATE TABLE users (id uuid PRIMARY KEY, email text);
    CREATE TABLE bms_audit_log (
      id bigserial PRIMARY KEY, tenant_id uuid NOT NULL, actor text,
      actor_user_id uuid, actor_kind text, action text NOT NULL, target text,
      target_kind text, source text, request_id uuid, meta jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE bms_security_events (
      id bigserial PRIMARY KEY, tenant_id uuid, actor_user_id uuid,
      event text NOT NULL, outcome text, source text, session_ref text,
      reason_code text, meta jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO bms_audit_log(tenant_id, actor, actor_user_id, action, target, created_at)
    SELECT '${tenant}',
      CASE WHEN n % 1000 = 1 THEN '${actor}'
           WHEN n % 1000 = 2 THEN 'user:${actor}' ELSE 'other' END,
      CASE WHEN n % 1000 = 0 THEN '${actor}'::uuid ELSE NULL END,
      'FAKE.audit', n::text,
      now() - ((n::bigint * 315360000 / ${auditRows}) || ' seconds')::interval
    FROM generate_series(1, ${auditRows}) n;
    INSERT INTO bms_security_events(tenant_id, actor_user_id, event, outcome, source, created_at)
    SELECT '${tenant}', CASE WHEN n % 100 = 0 THEN '${actor}'::uuid ELSE '${other}'::uuid END,
      'auth.login', 'SUCCESS', 'FAKE',
      now() - ((n::bigint * 315360000 / ${securityRows}) || ' seconds')::interval
    FROM generate_series(1, ${securityRows}) n;
    CREATE INDEX idx_bms_audit_actor_time ON bms_audit_log
      (tenant_id, actor_user_id, created_at DESC, id DESC) WHERE actor_user_id IS NOT NULL;
    CREATE INDEX idx_bms_audit_time_id ON bms_audit_log
      (tenant_id, created_at DESC, id DESC);
    CREATE INDEX idx_bms_security_events_actor_time ON bms_security_events
      (tenant_id, actor_user_id, created_at DESC, id DESC);
    CREATE INDEX idx_bms_security_events_time_id ON bms_security_events
      (tenant_id, created_at DESC, id DESC);
  `);
  const legacyIndexMigration = readFileSync(new URL("../db/migrations/10.123__bms_audit_legacy_actor_lookup.sql", import.meta.url), "utf8");
  await db.exec(legacyIndexMigration);
  await db.exec(legacyIndexMigration);
  await db.query(`INSERT INTO bms_security_events(tenant_id,actor_user_id,event,outcome,source)
    VALUES(NULL,$1,'FAKE.global','SUCCESS','FAKE')`, [actor]);
  await db.query(`INSERT INTO bms_audit_log(tenant_id,actor,actor_user_id,action)
    VALUES($1,$2::text,$2::uuid,'FAKE.other_tenant')`, [other, actor]);
  const tieAt = new Date(Date.now() + 60_000).toISOString();
  for (const action of ["FAKE.tie.older", "FAKE.tie.newer"]) {
    await db.query(`INSERT INTO bms_audit_log(tenant_id,actor,actor_user_id,action,created_at)
      VALUES($1,$2::text,$2::uuid,$3,$4)`, [tenant, actor, action, tieAt]);
  }
  await db.query(`INSERT INTO bms_security_events
    (tenant_id,actor_user_id,event,outcome,source,created_at)
    VALUES($1,$2,'FAKE.tie.security','SUCCESS','FAKE',$3)`, [tenant, actor, tieAt]);
  await db.exec("ANALYZE bms_audit_log; ANALYZE bms_security_events;");

  const source = readFileSync(new URL("../apps/web/lib/bms/auditTimeline.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let lastSql, lastParams;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.equal(name, "@/lib/db");
    return { query: (sql, params) => {
      lastSql = sql; lastParams = params;
      return db.query(sql, params);
    } };
  }, module, module.exports);
  const list = module.exports.listAuditTimeline;
  let tiePage = await list(tenant, { actorUserId: actor, limit: 1 });
  assert.deepEqual(tiePage.nodes.map(row => row.action), ["FAKE.tie.newer"]);
  tiePage = await list(tenant, { actorUserId: actor, limit: 1, cursor: tiePage.nextCursor });
  assert.deepEqual(tiePage.nodes.map(row => row.action), ["FAKE.tie.older"]);
  tiePage = await list(tenant, { actorUserId: actor, limit: 1, cursor: tiePage.nextCursor });
  assert.deepEqual(tiePage.nodes.map(row => row.action), ["FAKE.tie.security"]);
  const started = performance.now();
  const first = await list(tenant, { actorUserId: actor, limit: 30 });
  const firstMs = Math.round(performance.now() - started);
  assert.equal(first.nodes.length, 30);
  assert.ok(first.nextCursor);
  assert.ok(first.nodes.some(row => row.source === "BUSINESS"));
  const plan = (await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${lastSql}`, lastParams)).rows[0]["QUERY PLAN"][0];
  const scanNodes = [];
  const visit = (node) => {
    if (node["Node Type"]?.includes("Scan")) scanNodes.push({ type: node["Node Type"],
      relation: node["Relation Name"], index: node["Index Name"], rows: node["Actual Rows"] });
    for (const child of node.Plans || []) visit(child);
  };
  visit(plan.Plan);
  const second = await list(tenant, { actorUserId: actor, limit: 30, cursor: first.nextCursor });
  assert.equal(second.nodes.length, 30);
  const broad = await list(tenant, { limit: 30 });
  assert.equal(broad.nodes.length, 30);
  const actorSearch = await list(tenant, { actorUserId: actor, q: "FAKE.audit", limit: 30 });
  assert.equal(actorSearch.nodes.length, 30);
  const global = await list(null, { actorUserId: actor, limit: 30 });
  assert.deepEqual(global.nodes.map(row => row.action), ["FAKE.global"]);
  const oldAt = new Date(Date.now() - 9.5 * 365 * 24 * 3600_000).toISOString();
  const oldCursor = Buffer.from(JSON.stringify({ at: oldAt, sourceOrder: 1,
    id: "9223372036854775807" })).toString("base64url");
  const deep = await list(tenant, { actorUserId: actor, limit: 30, cursor: oldCursor });
  assert.ok(deep.nodes.length > 0 && deep.nodes.length <= 30);
  assert.ok(deep.nodes.every(row => row.action !== "FAKE.other_tenant"));
  const deepPlan = (await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${lastSql}`, lastParams)).rows[0]["QUERY PLAN"][0];
  const deepScans = [];
  const collectDeep = (node) => {
    if (node["Index Name"]?.startsWith("idx_bms_")) deepScans.push({
      index: node["Index Name"], rows: node["Actual Rows"] });
    for (const child of node.Plans || []) collectDeep(child);
  };
  collectDeep(deepPlan.Plan);
  console.log(JSON.stringify({ auditRows: auditRows + 3, securityRows: securityRows + 2,
    actorFirstPageMs: firstMs,
    actorPlanMs: Math.round(plan["Execution Time"]), actorScans: scanNodes,
    nextPageRows: second.nodes.length, broadPageRows: broad.nodes.length,
    globalPageRows: global.nodes.length, deepPageRows: deep.nodes.length, deepScans }));
} finally {
  await db.close();
}

// Local disposable database only: node scripts/run-contract-tests.mjs db emergency-facilities
// Requires migration 10.46 and the existing BMS schema. Never uses a real tenant's rows.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, getClient, closeDatabasePool } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { listEmergencyFacilities, listEmergencyFacilitiesForReply, upsertEmergencyFacility, deactivateEmergencyFacility } from "../apps/web/lib/bms/emergencyFacilities.ts";

test("emergency facility CRUD, RLS, branch scope, rollback and unavailable-table fallback", async (t) => {
  const tenantId = randomUUID(), other = randomUUID(), userId = randomUUID(), location = randomUUID(), foreignLocation = randomUUID();
  const ids: string[] = [];
  const input = { locationId: null, name: "FAKE emergency department", emergencyPhone: "02-555-0101", address: null,
    mapUrl: "https://example.invalid/map", has24hEmergency: true, distanceKm: 1.25, sortOrder: 0 };
  try {
    await query("INSERT INTO bms_tenants(id,name,slug) VALUES ($1,'FAKE emergency test',$1),($2,'FAKE other emergency test',$2)", [tenantId, other]);
    await query(`INSERT INTO users(id,tenant_id,name,username,email,role,role_id,password_hash,fake_test)
      SELECT $1,$2,'FAKE emergency admin',$1,$1 || '@example.invalid','Administrator',id,'x',true FROM roles WHERE name='Administrator' LIMIT 1`, [userId, tenantId]);
    await query("INSERT INTO bms_locations(id,tenant_id,code,name) VALUES ($1,$2,'MAIN','FAKE main'),($3,$4,'MAIN','FAKE foreign')", [location, tenantId, foreignLocation, other]);
    await t.test("create/update/list records revision and audit in the same service transaction", async () => {
      const row = await upsertEmergencyFacility(tenantId, userId, input); ids.push(row.id);
      assert.equal(row.name, input.name);
      const saved = await upsertEmergencyFacility(tenantId, userId, { ...input, id: row.id, name: "FAKE renamed" });
      assert.equal(saved.name, "FAKE renamed");
      assert.equal((await listEmergencyFacilities(tenantId)).length, 1);
      assert.equal((await query("SELECT count(*)::int AS n FROM bms_audit_log WHERE tenant_id=$1 AND target=$2 AND action='emergency_facility.saved'", [tenantId, row.id])).rows[0].n, 2);
      assert.ok((await query("SELECT count(*)::int AS n FROM bms_emergency_facilities_revisions WHERE tenant_id=$1", [tenantId])).rows[0].n >= 1);
    });
    await t.test("cross-tenant id updates fail and RLS hides rows even without a WHERE", async () => {
      await assert.rejects(upsertEmergencyFacility(other, userId, { ...input, id: ids[0] }));
      const client = await getClient();
      try {
        await beginTenantTx(client, other);
        assert.equal((await client.query("SELECT id FROM bms_emergency_facilities WHERE id=$1", [ids[0]])).rowCount, 0);
        await client.query("ROLLBACK");
      } finally { client.release(); }
    });
    await t.test("foreign-tenant branch is rejected by the service and composite foreign key", async () => {
      await assert.rejects(upsertEmergencyFacility(tenantId, userId, { ...input, locationId: foreignLocation }));
      await assert.rejects(query("INSERT INTO bms_emergency_facilities(tenant_id,location_id,name,emergency_phone) VALUES ($1,$2,'FAKE','1669')", [tenantId, foreignLocation]), { code: "23503" });
    });
    await t.test("reply only publishes active 24h rows, at most three, and never assumes a branch", async () => {
      for (let i = 0; i < 4; i++) ids.push((await upsertEmergencyFacility(tenantId, userId, { ...input, name: `FAKE ${i}`, sortOrder: i + 1 })).id);
      ids.push((await upsertEmergencyFacility(tenantId, userId, { ...input, name: "FAKE not 24h", has24hEmergency: false, sortOrder: -10 })).id);
      ids.push((await upsertEmergencyFacility(tenantId, userId, { ...input, name: "FAKE branch only", locationId: location, sortOrder: -20 })).id);
      const rows = await listEmergencyFacilitiesForReply(tenantId);
      assert.equal(rows.length, 3); assert.ok(rows.every((r) => r.has24hEmergency && r.locationId === null));
      assert.equal((await listEmergencyFacilitiesForReply(tenantId, location))[0].name, "FAKE branch only");
    });
    await t.test("branch-restricted users cannot change a global row or move a row out of scope", async () => {
      await query("INSERT INTO bms_user_allowed_locations(tenant_id,user_id,location_id) VALUES ($1,$2,$3)", [tenantId, userId, location]);
      await assert.rejects(upsertEmergencyFacility(tenantId, userId, { ...input, id: ids[0], locationId: location }));
      await assert.rejects(deactivateEmergencyFacility(tenantId, userId, ids[0]));
      assert.ok((await listEmergencyFacilities(tenantId, null, userId)).every((r) => r.locationId === location));
      await query("DELETE FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2", [tenantId, userId]);
    });
    await t.test("deactivation is soft and audited", async () => {
      await deactivateEmergencyFacility(tenantId, userId, ids[0]);
      assert.equal((await query("SELECT active FROM bms_emergency_facilities WHERE tenant_id=$1 AND id=$2", [tenantId, ids[0]])).rows[0].active, false);
      assert.ok(!(await listEmergencyFacilities(tenantId)).some((r) => r.id === ids[0]));
      assert.equal((await query("SELECT count(*)::int AS n FROM bms_audit_log WHERE tenant_id=$1 AND target=$2 AND action='emergency_facility.deactivated'", [tenantId, ids[0]])).rows[0].n, 1);
    });
    // Faults wrap only a leased connection in this process, never change another tenant's policy/grants.
    const pool = (globalThis as any).__bmsPostgresPool;
    assert.ok(pool, "run contract tests with NODE_ENV=test");
    const connect = pool.connect.bind(pool);
    await t.test("audit failure rolls back the facility write", async () => {
      const before = (await listEmergencyFacilities(tenantId)).length;
      pool.connect = async () => {
        const client = await connect(), originalQuery = client.query.bind(client), release = client.release.bind(client);
        client.query = (sql: string, ...args: any[]) => sql.includes("INSERT INTO bms_audit_log")
          ? Promise.reject(Object.assign(new Error("FAKE audit failure"), { code: "P0001" })) : originalQuery(sql, ...args);
        client.release = (...args: any[]) => { client.query = originalQuery; release(...args); };
        return client;
      };
      try { await assert.rejects(upsertEmergencyFacility(tenantId, userId, input), /FAKE audit failure/); }
      finally { pool.connect = connect; }
      assert.equal((await listEmergencyFacilities(tenantId)).length, before);
    });
    await t.test("missing table under a rollback-only savepoint returns [] and restores the table", async () => {
      pool.connect = async () => {
        const client = await connect(), originalQuery = client.query.bind(client), release = client.release.bind(client);
        await originalQuery("BEGIN");
        await originalQuery("SAVEPOINT emergency_missing_table");
        await originalQuery("DROP TABLE bms_emergency_facilities");
        client.query = async (sql: string, ...args: any[]) => {
          if (sql === "BEGIN") return { rows: [], rowCount: 0 };
          // The service must hit a real 42P01. Either completion path restores the savepoint.
          if (sql === "COMMIT" || sql === "ROLLBACK") {
            await originalQuery("ROLLBACK TO SAVEPOINT emergency_missing_table");
            return originalQuery("ROLLBACK");
          }
          return originalQuery(sql, ...args);
        };
        client.release = (...args: any[]) => { client.query = originalQuery; release(...args); };
        return client;
      };
      try { assert.deepEqual(await listEmergencyFacilitiesForReply(tenantId), []); }
      finally { pool.connect = connect; }
      assert.ok((await query("SELECT to_regclass('bms_emergency_facilities') AS name")).rows[0].name);
    });
  } finally {
    // Exact fixture UUIDs only. Revision rows do not cascade with the root entity.
    await query("DELETE FROM bms_emergency_facilities WHERE tenant_id=ANY($1::uuid[])", [[tenantId, other]]);
    await query("DELETE FROM users WHERE id=$1 AND tenant_id=$2", [userId, tenantId]);
    await query("DELETE FROM bms_emergency_facilities_revisions WHERE tenant_id=ANY($1::uuid[])", [[tenantId, other]]);
    await query("DELETE FROM bms_audit_log WHERE tenant_id=ANY($1::uuid[])", [[tenantId, other]]);
    await query("DELETE FROM bms_tenants WHERE id=ANY($1::uuid[])", [[tenantId, other]]);
    assert.equal((await query("SELECT count(*)::int AS n FROM bms_emergency_facilities WHERE tenant_id=ANY($1::uuid[])", [[tenantId, other]])).rows[0].n, 0);
    await closeDatabasePool();
  }
});

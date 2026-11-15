/** Local disposable DB only: verify the staff assistant's backend facts boundary. */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { query, closeDatabasePool } from "../apps/web/lib/db.ts";
import { getTenantStaffUserAccess, searchTenantStaffUsers } from "../apps/web/lib/bms/assistantAccess.ts";

test("disposable DB: staff AI facts stay tenant-scoped and omit account secrets", {
  skip: process.env.BMS_TEAM_DISPOSABLE_DB !== "1",
}, async () => {
  assert.equal(process.env.POSTGRES_HOST, "127.0.0.1");
  assert.equal(process.env.POSTGRES_PORT, "5433");
  assert.equal(process.env.POSTGRES_DB, "bms_realtime_test");
  const tenants = (await query<{ id: string }>("SELECT id FROM bms_tenants ORDER BY id LIMIT 2")).rows;
  assert.equal(tenants.length, 2, "restored test baseline needs two tenants");
  const marker = `FAKE Team ${randomUUID()}`;
  const ids: string[] = [];
  try {
    for (const [index, tenant] of tenants.entries()) {
      const row = await query<{ id: string }>(
        `INSERT INTO users(name,email,role_id,password_hash,tenant_id,fake_test)
         SELECT $1, $2, id, 'FAKE unused hash', $3, TRUE
           FROM roles WHERE name='Sales' RETURNING id`,
        [`${marker} ${index}`, `fake-team-ai-${randomUUID()}@example.invalid`, tenant.id]);
      assert.equal(row.rowCount, 1);
      ids.push(row.rows[0].id);
    }
    const matches = await searchTenantStaffUsers(tenants[0].id, marker, 10);
    assert.deepEqual(matches.map((row) => row.id), [ids[0]]);
    assert.equal("email" in matches[0], false);
    assert.equal("phone" in matches[0], false);
    assert.equal("passwordHash" in matches[0], false);
    assert.equal(await getTenantStaffUserAccess(tenants[0].id, ids[1]), null);
    assert.equal(await getTenantStaffUserAccess(tenants[0].id, "not-a-uuid"), null);
    const access = await getTenantStaffUserAccess(tenants[0].id, ids[0]);
    assert.equal(access?.role, "Sales");
    assert.equal("email" in (access ?? {}), false);
    assert.ok(Array.isArray(access?.permissions));
    assert.deepEqual(await searchTenantStaffUsers(tenants[0].id, "%", 10), []);
  } finally {
    if (ids.length) await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [ids]);
    await closeDatabasePool();
  }
});

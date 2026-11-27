/**
 * Run only on a disposable, restored development database:
 * BMS_KIOSK_RESTORED_DB=1 node scripts/run-contract-tests.mjs db restaurant-kiosk-db-contract
 * The runner also requires an explicit local POSTGRES_HOST/POSTGRES_DB. Never use production.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getClient } from "../apps/web/lib/db.ts";

test("kiosk migrations reapply and bms_app enforces token/tenant RLS, branch FK and uniqueness", {
  skip: process.env.BMS_KIOSK_RESTORED_DB !== "1" && "requires an explicitly marked disposable restored DB",
}, async () => {
  const client = await getClient();
  const migration = async (name: string) => readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8");
  const first = await migration("10.144__bms_restaurant_kiosk_ordering.sql");
  const hardening = await migration("10.145__bms_restaurant_kiosk_rls_scope.sql");
  const acceptedOrder = await migration("10.148__bms_restaurant_kiosk_accepted_order.sql");
  const uuid = async (sql: string, args: unknown[] = []) =>
    (await client.query<{ id: string }>(sql, args)).rows[0].id;
  const reject = async (sql: string, args: unknown[], state: string) => {
    await client.query("SAVEPOINT kiosk_expected_failure");
    try {
      await assert.rejects(client.query(sql, args), (error: unknown) =>
        (error as { code?: string }).code === state);
    } finally { await client.query("ROLLBACK TO SAVEPOINT kiosk_expected_failure"); }
  };
  try {
    await client.query("BEGIN");
    await client.query(first);
    await client.query(first);
    await client.query(hardening);
    await client.query(hardening);
    await client.query(acceptedOrder);
    await client.query(acceptedOrder);
    const acceptedColumn = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name='bms_restaurant_kiosk_submissions' AND column_name='accepted_order_id'`);
    assert.equal(acceptedColumn.rowCount, 1);
    const acceptedFk = await client.query(
      `SELECT 1 FROM pg_constraint WHERE conrelid='bms_restaurant_kiosk_submissions'::regclass
        AND conname='bms_restaurant_kiosk_accepted_order_location_fk' AND contype='f'`);
    assert.equal(acceptedFk.rowCount, 1);
    const tag = `fake-kiosk-db-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenant = await uuid("INSERT INTO bms_tenants (name, slug) VALUES ($1,$1) RETURNING id", [tag]);
    const otherTenant = await uuid("INSERT INTO bms_tenants (name, slug) VALUES ($1,$1) RETURNING id", [`${tag}-other`]);
    const branch = await uuid(
      "INSERT INTO bms_locations (tenant_id, code, name, branch_code) VALUES ($1,'MAIN',$2,'00000') RETURNING id",
      [tenant, tag]);
    const branch2 = await uuid(
      "INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office) VALUES ($1,'B2',$2,'00002',FALSE) RETURNING id",
      [tenant, `${tag}-branch2`]);
    const foreignBranch = await uuid(
      "INSERT INTO bms_locations (tenant_id, code, name, branch_code) VALUES ($1,'MAIN',$2,'00000') RETURNING id",
      [otherTenant, `${tag}-foreign`]);
    const user = await uuid(
      `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash, fake_test)
       SELECT $2,$3,$3,'Administrator',r.id,$1,'x',TRUE FROM roles r
       WHERE r.name = 'Administrator' LIMIT 1 RETURNING id`,
      [tenant, tag, `${tag}@example.invalid`]);
    const tokenHash = "a".repeat(64);
    const kiosk = await uuid(
      "INSERT INTO bms_restaurant_kiosks (tenant_id, location_id, token_hash, created_by) VALUES ($1,$2,$3,$4) RETURNING id",
      [tenant, branch, tokenHash, user]);
    await reject(
      "INSERT INTO bms_restaurant_kiosks (tenant_id, location_id, token_hash, created_by) VALUES ($1,$2,$3,$4)",
      [tenant, branch, "b".repeat(64), user], "23505");
    await reject(
      "INSERT INTO bms_restaurant_kiosks (tenant_id, location_id, token_hash, created_by) VALUES ($1,$2,$3,$4)",
      [tenant, foreignBranch, "c".repeat(64), user], "23503");
    const submission = await uuid(
      `INSERT INTO bms_restaurant_kiosk_submissions
         (tenant_id, location_id, kiosk_id, service_mode, idempotency_key, items)
       VALUES ($1,$2,$3,'TAKEAWAY','test-key-123','[{"sku":"FAKE","packQty":1}]'::jsonb) RETURNING id`,
      [tenant, branch, kiosk]);
    await reject(
      `UPDATE bms_restaurant_kiosk_submissions
          SET status='ACCEPTED', check_id=$4, reviewed_by=$5, reviewed_at=now()
        WHERE tenant_id=$1 AND location_id=$2 AND id=$3`,
      [tenant, branch, submission, "00000000-0000-4000-8000-000000000001", user], "P0001");
    await reject(
      `INSERT INTO bms_restaurant_kiosk_submissions
         (tenant_id, location_id, kiosk_id, service_mode, idempotency_key, items)
       VALUES ($1,$2,$3,'TAKEAWAY','test-key-123','[{"sku":"FAKE","packQty":1}]'::jsonb)`,
      [tenant, branch, kiosk], "23505");
    await reject(
      `INSERT INTO bms_restaurant_kiosk_submissions
         (tenant_id, location_id, kiosk_id, service_mode, idempotency_key, items)
       VALUES ($1,$2,$3,'TAKEAWAY','other-key-123','[{"sku":"FAKE","packQty":1}]'::jsonb)`,
      [tenant, branch2, kiosk], "23503");
    await client.query("SET LOCAL ROLE bms_app");
    const count = async (table: string) => Number((await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table}`)).rows[0].n);
    assert.equal(await count("bms_restaurant_kiosks"), 0);
    assert.equal(await count("bms_restaurant_kiosk_submissions"), 0);
    await client.query("SELECT set_config('bms.kiosk_token_hash', $1, true)", [tokenHash]);
    assert.equal(await count("bms_restaurant_kiosks"), 1);
    assert.equal(await count("bms_restaurant_kiosk_submissions"), 0);
    await reject(
      `INSERT INTO bms_restaurant_kiosk_submissions
         (tenant_id, location_id, kiosk_id, service_mode, idempotency_key, items)
       VALUES ($1,$2,$3,'TAKEAWAY','no-tenant-guc','[{"sku":"FAKE","packQty":1}]'::jsonb)`,
      [tenant, branch, kiosk], "42501");
    await client.query("SELECT set_config('bms.kiosk_token_hash', '', true)");
    await client.query("SELECT set_config('bms.tenant_id', $1, true)", [otherTenant]);
    assert.equal(await count("bms_restaurant_kiosks"), 0);
    assert.equal(await count("bms_restaurant_kiosk_submissions"), 0);
    await client.query("SELECT set_config('bms.tenant_id', $1, true)", [tenant]);
    assert.equal((await client.query("SELECT id, accepted_order_id FROM bms_restaurant_kiosk_submissions WHERE id = $1", [submission])).rowCount, 1);
    assert.equal(await count("bms_restaurant_kiosks"), 1);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

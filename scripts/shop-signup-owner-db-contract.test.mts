// Local PostgreSQL only: exercise the real email-verification path that creates
// the tenant, first user, role binding, and signup audit in one transaction.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { getClient, query } from "../apps/web/lib/db.ts";
import { verifyPendingShopSignup } from "../apps/web/lib/bms/signup.ts";

test("a verified shop signup creates an Administrator owner and auditable tenant", async () => {
  assert.ok(["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(process.env.POSTGRES_HOST ?? ""));
  const suffix = randomUUID();
  const email = `fake-signup-owner-${suffix}@example.invalid`;
  const shopName = `fake-signup-owner-${suffix}`;
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  let pendingId: string | undefined;
  let tenantId: string | undefined;
  try {
    const pending = await query<{ id: string }>(
      `INSERT INTO bms_pending_shop_signups
         (email, shop_name, owner_name, password_hash, token_hash, expires_at)
       VALUES ($1, $2, 'FAKE owner', 'FAKE unused hash', $3, now() + interval '30 minutes')
       RETURNING id`,
      [email, shopName, tokenHash]
    );
    pendingId = pending.rows[0].id;

    const verified = await verifyPendingShopSignup(token);
    assert.equal(verified.status, "VERIFIED");
    if (verified.status !== "VERIFIED") return;
    tenantId = verified.tenantId;
    assert.deepEqual(await verifyPendingShopSignup(token), { status: "INVALID_OR_EXPIRED" },
      "a replayed verification link must not create another tenant");
    const owner = await query<{
      id: string; role: string; role_name: string; is_email_verified: boolean; tenant_id: string;
    }>(
      `SELECT u.id, u.role, r.name AS role_name, u.is_email_verified, u.tenant_id
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.tenant_id = $1 AND lower(btrim(u.email)) = $2`,
      [tenantId, email]
    );
    assert.equal(owner.rowCount, 1);
    assert.deepEqual(
      [owner.rows[0].role, owner.rows[0].role_name, owner.rows[0].is_email_verified, owner.rows[0].tenant_id],
      ["Administrator", "Administrator", true, tenantId]
    );
    const audit = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM bms_audit_log
        WHERE tenant_id = $1 AND target = $2 AND action = 'shop.signup.owner_created'`,
      [tenantId, owner.rows[0].id]
    );
    assert.equal(audit.rows[0].n, 1);
  } finally {
    if (tenantId) {
      await query(`DELETE FROM bms_audit_log WHERE tenant_id = $1`, [tenantId]);
      if ((await query(`SELECT to_regclass('bms_package_events') IS NOT NULL AS ready`)).rows[0].ready) {
        await query(`DELETE FROM bms_package_events WHERE tenant_id = $1`, [tenantId]);
      }
      await query(`DELETE FROM bms_pending_shop_signups WHERE id = $1`, [pendingId]);
      await query(`DELETE FROM users WHERE tenant_id = $1`, [tenantId]);
      await query(`DELETE FROM bms_role_permissions WHERE tenant_id = $1`, [tenantId]);
      await query(`DELETE FROM bms_store_profile WHERE tenant_id = $1`, [tenantId]);
      await query(`DELETE FROM bms_tenants WHERE id = $1`, [tenantId]);
    } else if (pendingId) {
      await query(`DELETE FROM bms_pending_shop_signups WHERE id = $1`, [pendingId]);
    }
  }
});

test("owner repair is one-time and leaves other Managers unchanged", async () => {
  assert.ok(["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(process.env.POSTGRES_HOST ?? ""));
  const originalSql = readFileSync(
    new URL("../db/migrations/10.121__bms_verified_shop_owner_administrator.sql", import.meta.url),
    "utf8"
  );
  const retrySql = readFileSync(
    new URL("../db/migrations/10.128__bms_verified_shop_owner_repair_retry.sql", import.meta.url),
    "utf8"
  );
  const withoutWrappers = (sql: string) => sql.replace(/^BEGIN;\s*/m, "").replace(/^COMMIT;\s*/m, "");
  const originalMigration = withoutWrappers(originalSql);
  const retryMigration = withoutWrappers(retrySql);
  assert.match(originalMigration, /SET LOCAL lock_timeout = '5s'/);
  assert.match(originalMigration, /SET LOCAL statement_timeout = '2min'/);
  assert.match(originalMigration, /pg_advisory_xact_lock\(hashtextextended\('bms-verified-shop-owner-repair', 0\)\)/);
  assert.match(retryMigration, /SET LOCAL lock_timeout = '5s'/);
  assert.match(retryMigration, /SET LOCAL statement_timeout = '2min'/);
  assert.match(retryMigration, /pg_advisory_xact_lock\(hashtextextended\('bms-verified-shop-owner-repair', 0\)\)/);
  const repairBody = (sql: string) => sql.slice(sql.indexOf("DO $$"), sql.indexOf("\nCOMMIT;"))
    .replace(/migration:10\.12[18]/g, "migration:10.12X")
    .replace(/\s+/g, " ").trim();
  assert.equal(repairBody(retrySql), repairBody(originalSql),
    "the timeout retry must not widen the verified-owner eligibility rules");
  const client = await getClient();
  await client.query("BEGIN");
  try {
    async function shop(label: string, verified: boolean, hasAdmin = false, edited = false) {
      const suffix = randomUUID();
      const tenant = await client.query<{ id: string }>(
        `INSERT INTO bms_tenants (name, slug, plan)
         VALUES ($1, $2, 'free') RETURNING id`,
        [`FAKE signup ${label}`, `fake-signup-repair-${suffix}`]
      );
      const tenantId = tenant.rows[0].id;
      const email = `fake-signup-repair-${suffix}@example.invalid`;
      if (verified) {
        await client.query(
          `INSERT INTO bms_pending_shop_signups
             (email, shop_name, owner_name, password_hash, token_hash, expires_at, verified_at, tenant_id)
           VALUES ($1, $2, 'FAKE owner', 'FAKE hash', $3, now() + interval '30 minutes', now(), $4)`,
          [email, label, createHash("sha256").update(suffix).digest("hex"), tenantId]
        );
      }
      const manager = await client.query<{ id: string }>(
        `INSERT INTO users
           (name, username, email, role, role_id, tenant_id, password_hash, is_email_verified, fake_test)
         SELECT 'FAKE manager', $2, $2, 'Manager', r.id, $1, 'FAKE hash', TRUE, TRUE
           FROM roles r WHERE r.name = 'Manager' RETURNING id`,
        [tenantId, email]
      );
      assert.equal(manager.rowCount, 1);
      if (hasAdmin) {
        await client.query(
          `INSERT INTO users
             (name, username, email, role, role_id, tenant_id, password_hash, is_email_verified, fake_test)
           SELECT 'FAKE admin', $2, $2, 'Administrator', r.id, $1, 'FAKE hash', TRUE, TRUE
             FROM roles r WHERE r.name = 'Administrator'`,
          [tenantId, `fake-admin-${suffix}@example.invalid`]
        );
      }
      if (edited) {
        await client.query(
          `INSERT INTO bms_audit_log (tenant_id, actor, action, target)
           VALUES ($1, 'FAKE editor', 'user.update', $2)`,
          [tenantId, manager.rows[0].id]
        );
      }
      return { tenantId, userId: manager.rows[0].id };
    }

    const owner = await shop("verified owner", true);
    const ordinaryManager = await shop("ordinary manager", false);
    const managedShop = await shop("shop already has admin", true, true);
    const editedOwner = await shop("owner edited later", true, false, true);
    await client.query(originalMigration);
    const timeoutSettings = (await client.query(
      `SELECT current_setting('statement_timeout') statement_timeout,
              current_setting('lock_timeout') lock_timeout`,
    )).rows[0];
    assert.deepEqual(timeoutSettings, { statement_timeout: "2min", lock_timeout: "5s" });
    const rows = await client.query<{ id: string; role: string }>(
      `SELECT id, role FROM users WHERE id = ANY($1::uuid[])`,
      [[owner.userId, ordinaryManager.userId, managedShop.userId, editedOwner.userId]]
    );
    const roleById = new Map(rows.rows.map((row) => [row.id, row.role]));
    assert.equal(roleById.get(owner.userId), "Administrator");
    for (const account of [ordinaryManager, managedShop, editedOwner]) {
      assert.equal(roleById.get(account.userId), "Manager");
    }
    const countRepairs = async (tenantId: string) => Number((await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM bms_audit_log
        WHERE tenant_id = $1 AND action = 'shop.signup.owner_role_repaired'`,
      [tenantId]
    )).rows[0].n);
    assert.equal(await countRepairs(owner.tenantId), 1);
    const lateOwner = await shop("verified owner after 10.121", true);
    await client.query(retryMigration);
    assert.equal((await client.query<{ role: string }>(
      `SELECT role FROM users WHERE tenant_id=$1 AND id=$2`,
      [lateOwner.tenantId, lateOwner.userId],
    )).rows[0].role, "Administrator");
    assert.equal(await countRepairs(lateOwner.tenantId), 1);
    await client.query(originalMigration);
    await client.query(retryMigration);
    assert.equal(await countRepairs(owner.tenantId), 1);
    assert.equal(await countRepairs(lateOwner.tenantId), 1);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

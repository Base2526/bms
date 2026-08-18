// =============================================================
// What bms_app may read inside a tenant transaction (8.4)
// -------------------------------------------------------------
// beginTenantTx runs `SET LOCAL ROLE bms_app` on every BMS write path, so every
// statement inside those transactions executes as that role. bms_app had no
// grants at all on users or roles, which meant cashierHasPermissionInTx —
// reached by processPosReturn whenever a refund is large enough to need an
// approver — died with a raw "permission denied for table users" mid-return.
//
// Returns under ฿500 skip the approval check, so the bug was invisible to any
// test that used a small bill. It surfaced on a ฿2,000 bill written for 8.3.
//
// This suite exists so the grant cannot silently disappear again, and so
// password_hash cannot silently become readable by the app role.
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/db-role-grants-db-contract.test.mts
//
// Read-only. Safe against any database, including production.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { getClient } from "../apps/web/lib/db.ts";

/** รันคำสั่งในบทบาท bms_app แบบเดียวกับ beginTenantTx แล้ว rollback ทิ้งทุกครั้ง */
async function asBmsApp<T>(fn: (run: (sql: string) => Promise<any>) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bms_app");
    return await fn((sql: string) => client.query(sql));
  } finally {
    try { await client.query("ROLLBACK"); } catch {}
    client.release();
  }
}

test("bms_app can read the columns that permission checks need", async () => {
  await asBmsApp(async (run) => {
    // ตรงกับที่ cashierHasPermissionInTx อ่านจริง
    await run(`SELECT u.id, u.tenant_id, u.role_id, r.name
                 FROM users u LEFT JOIN roles r ON r.id = u.role_id LIMIT 1`);
    // และที่ path อื่นอ่าน (ชื่อ/อีเมลคนขาย, การจ่ายงาน inbox)
    await run(`SELECT name, email, is_available, created_at FROM users LIMIT 1`);
  });
});

test("bms_app still cannot read password_hash", async () => {
  await assert.rejects(
    () => asBmsApp((run) => run(`SELECT password_hash FROM users LIMIT 1`)),
    /permission denied/i,
    "สิทธิ์ต้องเป็นระดับคอลัมน์ ไม่ใช่ทั้งตาราง — bms_app ไม่ควรแตะรหัสผ่านได้เลย"
  );
});

test("bms_app cannot write to users", async () => {
  // การให้อ่านต้องไม่กลายเป็นการให้เขียนโดยเผลอ
  await assert.rejects(
    () => asBmsApp((run) => run(`UPDATE users SET name = name WHERE FALSE`)),
    /permission denied/i
  );
});

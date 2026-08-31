/**
 * "ใครอนุมัติงานนี้ได้" ต้องตอบให้ตรงกับที่ server จะยอมจริง
 *
 * รายการที่ยื่นให้แคชเชียร์เลือกกับด่านที่ตรวจตอนกด PIN ต้องอ่านกฎเดียวกัน ไม่งั้นจอจะยื่นชื่อ
 * คนที่ถูกปฏิเสธอยู่ดี ซึ่งคือบั๊กเดิมที่กำลังแก้ · กฎที่พลาดง่ายที่สุดคือ **Administrator ได้ทุก
 * สิทธิ์โดยปริยายและไม่มีแถวใน `bms_role_permissions`** — ลืมเมื่อไหร่ เจ้าของร้านหายจากลิสต์
 * ผู้อนุมัติทั้งที่เป็นคนเดียวในร้านเล็กที่อนุมัติได้
 */
import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { listPosApprovers, cashierHasPermission } from "../apps/web/lib/bms/pos.ts";
import { rolesWithPermission, posPermissionDeniedMessage } from "../apps/web/lib/bms/posApprovals.ts";

const TAG = "pos-approvals-test";
let tenantId = "";
let adminId = "";
let managerId = "";
let cashierId = "";

async function mkUser(label: string, roleName: string, withPin: boolean): Promise<string> {
  const email = `fake-${TAG}-${label}-${process.pid}@example.invalid`;
  const res = await query<{ id: string }>(
    `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash, fake_test, pos_pin_hash)
     SELECT $2, $3, $3, $4, r.id, $1, 'x', TRUE, $5
       FROM roles r WHERE r.name = $4 LIMIT 1
     RETURNING id`,
    [tenantId, `FAKE ${TAG} ${label}`, email, roleName, withPin ? "hash" : null]
  );
  assert.equal(res.rowCount, 1, `role ${roleName} must exist to run this suite`);
  return res.rows[0].id;
}

test("setup: one shop with an administrator, a manager and a plain cashier", async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG}`, `fake-${TAG}-${process.pid}`]
  )).rows[0].id;
  adminId = await mkUser("admin", "Administrator", true);
  managerId = await mkUser("manager", "Manager", true);
  cashierId = await mkUser("cashier", "Cashier", true);

  const managerRole = (await query<{ id: string }>(
    `SELECT id FROM roles WHERE name = 'Manager' LIMIT 1`
  )).rows[0].id;
  const cashierRole = (await query<{ id: string }>(
    `SELECT id FROM roles WHERE name = 'Cashier' LIMIT 1`
  )).rows[0].id;
  // Manager อนุมัติยกเลิกบิลได้ · Cashier ขายได้อย่างเดียว
  await query(
    `INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
     VALUES ($1,$2,'pos.void'), ($1,$2,'pos.sell'), ($1,$3,'pos.sell')
     ON CONFLICT DO NOTHING`,
    [tenantId, managerRole, cashierRole]
  );
});

test("the approver list agrees with the gate that will re-check the PIN", async () => {
  const approvers = await listPosApprovers(tenantId);
  const voidApprovers = approvers.filter((person) => person.approvals.includes("pos.void"));
  const ids = voidApprovers.map((person) => person.id).sort();
  assert.deepEqual(ids, [adminId, managerId].sort(), "administrator and manager, and nobody else");

  // ทุกคนที่ลิสต์บอกว่าอนุมัติได้ ต้องผ่านด่านจริง และคนที่ไม่อยู่ในลิสต์ต้องไม่ผ่าน
  for (const person of voidApprovers) {
    assert.equal(await cashierHasPermission(tenantId, person.id, "pos.void"), true, person.id);
  }
  assert.equal(await cashierHasPermission(tenantId, cashierId, "pos.void"), false);
  assert.ok(
    !approvers.some((person) => person.id === cashierId && person.approvals.includes("pos.void")),
    "a cashier without the permission must never be offered as an approver"
  );
});

test("an administrator is an approver even with no permission rows at all", async () => {
  const roles = await rolesWithPermission(tenantId, "pos.void");
  assert.ok(roles.includes("Administrator"), "Administrator holds every permission implicitly");
  assert.ok(roles.includes("Manager"));
  assert.equal(roles[0], "Administrator", "the owner is listed first — usually the answer in a small shop");

  // สิทธิ์ที่ไม่มีใครถือเลย ยังต้องมี Administrator เสมอ ไม่ใช่ลิสต์ว่าง
  const unheld = await rolesWithPermission(tenantId, "pos.return.noreceipt");
  assert.deepEqual(unheld, ["Administrator"]);
});

test("the refusal names the role that can do it instead of only what failed", async () => {
  const message = await posPermissionDeniedMessage(tenantId, "pos.void", { secondPerson: true });
  assert.match(message, /ยกเลิกบิล/, "says the job in words a cashier uses");
  assert.match(message, /Administrator/);
  assert.match(message, /Manager/);
  assert.match(message, /กด PIN/, "a second-person job must point at the way forward");
  assert.doesNotMatch(message, /pos\.void/, "the raw permission name means nothing at a counter");

  const selfService = await posPermissionDeniedMessage(tenantId, "pos.shift.open");
  assert.match(selfService, /\/admin\/permissions/, "a hard block must say where it is granted");
});

test("teardown: drop the throwaway shop", async () => {
  const stale = await query<{ id: string }>(
    `SELECT id FROM bms_tenants WHERE slug LIKE $1`, [`fake-${TAG}-%`]
  );
  const ids = [...new Set([tenantId, ...stale.rows.map((row) => row.id)].filter(Boolean))];
  if (!ids.length) return;
  for (const table of ["bms_role_permissions", "users", "bms_store_profile", "bms_locations"]) {
    await query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
  }
  await query(`DELETE FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids]);
  assert.equal(Number((await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids]
  )).rows[0].n), 0);
});

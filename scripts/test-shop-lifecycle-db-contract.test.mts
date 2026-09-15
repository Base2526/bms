// เดินเส้นทางของปุ่ม "สร้างร้านทดสอบ" จริง: provision -> seed -> ลบทิ้ง
// Writes only its own throwaway tenants (slug ขึ้นต้น test-). Run against a local migrated
// test database, never production.
//
// ทำไมต้องเดินของจริง: SQL ของ seeder อยู่ใน template literal ทั้งหมด เทสที่ไม่ยิงคำสั่งจริง
// จึงยืนยันได้แค่ว่า "โค้ดคอมไพล์ผ่าน" — สองบั๊กที่ไฟล์นี้ตรึงไว้เป็นของที่ต้องรันถึงจะเห็น:
//   1. `9.22` ทำให้ bms_order_items.receipt_unit_price เป็น NOT NULL แต่ seeder ไม่ได้ส่งค่า
//      → ปุ่มสร้างร้านทดสอบล้ม 23502 ทุกครั้ง และปุ่ม "สร้างข้อมูลตัวอย่าง" ของร้านจริง
//      ค้างที่ขั้น orders ตลอดไป
//   2. หลักฐานของโมดูลบอร์ดเกม (`9.79`-`9.83`) ผูกกับ customer/order/user ด้วย FK แบบ RESTRICT
//      และ `9.82` ทำให้ bms_orders ชี้กลับมาที่ session → ลำดับ DELETE ติดวงรอบ ลบร้านไม่ได้เลย
//
//   cd apps/web && POSTGRES_HOST=localhost ... npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test ../../scripts/test-shop-lifecycle-db-contract.test.mts
import assert from "node:assert/strict";
import test from "node:test";
import { query } from "../apps/web/lib/db";
import { provisionTestShop } from "../apps/web/lib/bms/testShop";
import { deleteTenant } from "../apps/web/lib/bms/platform";
import {
  seedFakeStaff, seedFakeProducts, seedFakeCustomers, seedFakeOrders,
  seedFakeRestockSubscriptions, seedFakeMembers, seedFakeBoardGameCafe,
} from "../apps/web/lib/bms/devSeed";
import { seedFakePosDevices } from "../apps/web/lib/bms/devPosSeed";

test("ร้านทดสอบบอร์ดเกม: seed ครบแล้วลบทิ้งได้จริง", async (t) => {
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(process.env.POSTGRES_HOST ?? ""),
    "local test DB required"
  );
  let tenantId: string | null = null;
  t.after(async () => {
    // กันร้านค้างเมื่อ assert ล้มก่อนถึงขั้นลบ — deleteTenant กันตัวเองด้วย slug อยู่แล้ว
    if (tenantId) await deleteTenant(tenantId).catch(() => {});
  });

  const shop = await provisionTestShop({ name: "lifecycle contract", businessArchetype: "board_game_cafe" });
  tenantId = shop.tenantId;
  assert.ok(shop.slug.startsWith("test-"), "provisionTestShop ต้องการันตี slug ที่ลบได้");

  await seedFakeStaff(shop.tenantId, 4, undefined, "board_game_cafe");
  await seedFakePosDevices(shop.tenantId, 2);
  await seedFakeProducts(shop.tenantId, 8, "board_game_cafe");
  await seedFakeCustomers(shop.tenantId, 6);
  const orders = await seedFakeOrders(shop.tenantId, 12, "board_game_cafe");
  await seedFakeRestockSubscriptions(shop.tenantId, 4);
  await seedFakeMembers(shop.tenantId, 4);
  await seedFakeBoardGameCafe(shop.tenantId, 4);

  assert.ok(orders.summary.orders > 0, "seed ไม่ได้สร้างบิลเลย — เทสนี้จะยืนยันอะไรไม่ได้");
  const items = await query<{ n: string; nullish: string; mismatched: string }>(
    `SELECT count(*)::text AS n,
            count(*) FILTER (WHERE receipt_unit_price IS NULL)::text AS nullish,
            count(*) FILTER (WHERE receipt_unit_price <> unit_price)::text AS mismatched
       FROM bms_order_items WHERE tenant_id = $1`,
    [shop.tenantId]
  );
  assert.ok(Number(items.rows[0].n) > 0, "ไม่มีรายการในบิลเลย");
  assert.equal(items.rows[0].nullish, "0");
  // แถว seed ไม่ได้เดินผ่านกฎราคาส่ง/โปร ราคาป้ายกับราคาที่คิดจริงจึงต้องเท่ากันเสมอ
  assert.equal(items.rows[0].mismatched, "0");

  // ผูกบิลกับ session ทั้งสองทิศแบบที่ร้านจริงทำตอนปิดบิลโต๊ะบอร์ดเกม — seeder ไม่สร้างเคสนี้
  // แต่เป็นเคสที่ทำให้ RESTRICT ทั้งสองข้างชนกันจนลบร้านไม่ได้
  const linked = await query(
    `WITH s AS (SELECT id FROM bms_board_game_sessions WHERE tenant_id = $1 LIMIT 1),
          o AS (SELECT id FROM bms_orders WHERE tenant_id = $1 LIMIT 1)
     UPDATE bms_orders SET board_game_session_id = (SELECT id FROM s)
      WHERE tenant_id = $1 AND id = (SELECT id FROM o) AND (SELECT id FROM s) IS NOT NULL
     RETURNING id`,
    [shop.tenantId]
  );
  assert.equal(linked.rowCount, 1, "ไม่มี session/บิลให้ผูก — เคสที่เทสนี้มีไว้ตรึงจะไม่ถูกเดิน");
  await query(
    `UPDATE bms_board_game_sessions SET current_order_id = (SELECT id FROM bms_orders WHERE tenant_id = $1 LIMIT 1)
      WHERE tenant_id = $1 AND id = (SELECT id FROM bms_board_game_sessions WHERE tenant_id = $1 LIMIT 1)`,
    [shop.tenantId]
  );
  // `9.89` เพิ่มวงรอบชุดที่สองด้วยเหตุผลเดียวกัน: บิลชี้ไปที่ **กลุ่ม** ที่มันเก็บเงิน และกลุ่ม
  // ชี้กลับมาที่บิลใบนั้น · ปลดแค่ฝั่ง session แล้วลบร้านจะยังติดที่ฝั่งกลุ่ม
  const linkedGroup = await query(
    `WITH g AS (
       SELECT id FROM bms_board_game_billing_groups
        WHERE tenant_id = $1 AND session_id = (SELECT board_game_session_id FROM bms_orders
                                                WHERE tenant_id = $1 AND board_game_session_id IS NOT NULL LIMIT 1)
        LIMIT 1
     )
     UPDATE bms_orders SET board_game_billing_group_id = (SELECT id FROM g)
      WHERE tenant_id = $1 AND board_game_session_id IS NOT NULL AND (SELECT id FROM g) IS NOT NULL
      RETURNING id`,
    [shop.tenantId]
  );
  assert.equal(linkedGroup.rowCount, 1, "ไม่มีกลุ่มบิลให้ผูก — วงรอบ FK ของ 9.89 จะไม่ถูกเดิน");
  await query(
    `UPDATE bms_board_game_billing_groups
        SET current_order_id = (SELECT id FROM bms_orders
                                 WHERE tenant_id = $1 AND board_game_billing_group_id IS NOT NULL LIMIT 1)
      WHERE tenant_id = $1
        AND id = (SELECT board_game_billing_group_id FROM bms_orders
                   WHERE tenant_id = $1 AND board_game_billing_group_id IS NOT NULL LIMIT 1)`,
    [shop.tenantId]
  );

  // `9.92` และ `9.93` เก็บหลักฐานที่ผูกกับลูกค้า/พนักงานแบบ RESTRICT อีกสองแบบ · seeder
  // ไม่สร้างทั้งคู่ เคสจึงต้องปั้นเอง ไม่งั้นการลบร้านที่ "เคยขายแพ็กเกจ" หรือ "เคยรับบัตรไว้"
  // จะพังบน production โดยไม่มีเทสไหนเคยเดินผ่านมัน (แพ็กเกจพังจริงมาแล้ว — ไม่มี cascade
  // ใดปลดมันก่อน `bms_customers` ถูกลบ)
  const pass = await query(
    `INSERT INTO bms_board_game_member_passes
       (tenant_id, customer_id, plan_code, plan_name, kind, price_paid, expires_at, issued_by)
     SELECT $1, c.id, 'FAKE_LIFECYCLE', 'FAKE pass', 'UNLIMITED', 0, now() + interval '30 days',
            (SELECT id FROM users WHERE tenant_id = $1 LIMIT 1)
       FROM bms_customers c WHERE c.tenant_id = $1 LIMIT 1
     RETURNING id`,
    [shop.tenantId]
  );
  assert.equal(pass.rowCount, 1, "ไม่มีลูกค้าให้ออกแพ็กเกจ — วงรอบ RESTRICT ของ 9.92 จะไม่ถูกเดิน");
  const hold = await query(
    `INSERT INTO bms_board_game_identity_holds
       (tenant_id, location_id, session_id, customer_id, document_kind, holder_name, taken_by)
     SELECT $1, s.location_id, s.id,
            (SELECT id FROM bms_customers WHERE tenant_id = $1 LIMIT 1),
            'NATIONAL_ID', 'FAKE holder',
            (SELECT id FROM users WHERE tenant_id = $1 LIMIT 1)
       FROM bms_board_game_sessions s WHERE s.tenant_id = $1 LIMIT 1
     RETURNING id`,
    [shop.tenantId]
  );
  assert.equal(hold.rowCount, 1, "ไม่มี session ให้ผูกบัตร — cascade ของ 9.93 จะไม่ถูกเดิน");

  await deleteTenant(shop.tenantId);
  const left = await query<{ n: string }>(`SELECT count(*)::text AS n FROM bms_tenants WHERE id = $1`, [shop.tenantId]);
  assert.equal(left.rows[0].n, "0");
  for (const table of ["bms_orders", "bms_order_items", "bms_customers", "bms_board_game_sessions",
    "bms_board_game_billing_groups", "bms_board_game_seatings",
    "bms_board_game_session_participants", "bms_board_game_titles",
    "bms_board_game_member_passes", "bms_board_game_identity_holds", "users"]) {
    const rows = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table} WHERE tenant_id = $1`, [shop.tenantId]);
    assert.equal(rows.rows[0].n, "0", `${table} ยังมีแถวค้างหลังลบร้าน`);
  }
  tenantId = null;
});

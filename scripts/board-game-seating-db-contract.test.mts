/**
 * Board-game seating (`9.91`) against a real Postgres.
 *
 * Through `9.90` the *session* owned `table_id`, so the two floor actions a cafe performs every
 * evening were impossible to record truthfully: moving a party rewrote where its visit opened,
 * and merging two occupied tables would have meant merging their sessions — and therefore their
 * clocks, loans, tabs, bills and order history.
 *
 * `9.91` splits "where the party is sitting now" (a seating) from "whose visit this is" (a
 * session). What this suite pins down is the seam, not the happy path:
 *
 *  - moving or merging must change **nothing** below the seating: the same session ids, billing
 *    group ids, frozen charge lines, tab rows and PENDING reservation orders;
 *  - one active seating owns one table, so the vacated table must be immediately reopenable and
 *    the destination must refuse a second party except through an explicit merge;
 *  - a merged table is not a one-way door: moving one party off it detaches only that party;
 *  - the table is free only when every session sharing the seating has been paid — paying one of
 *    two merged parties must never release the table the other is still playing at.
 *
 * ⚠️ เขียนจริงลงฐาน — สร้าง tenant ของตัวเองแล้วลบทิ้ง **ห้ามรันกับ production** · ต้องสร้าง
 * tenant เองเพราะชุดนี้ตั้ง `business_archetype = 'board_game_cafe'` ซึ่งเปลี่ยนพฤติกรรมของ
 * ทุกบิลในร้านนั้น (โน้ตใน CLAUDE.local.md: การยืมร้านจริงมาสลับ archetype ทำร้านค้างจนเทสแดง)
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readBoardGameCustomerInfoInTx } from "../apps/web/lib/bms/boardGameCustomerInfo.ts";

import { query, getClient } from "../apps/web/lib/db.ts";
import { isIdempotencyConflictError } from "../apps/web/lib/bms/idempotencyErrors.ts";
import {
  addBoardGameParticipant,
  addBoardGameGroupItem,
  cancelBoardGameSession,
  checkoutBoardGameCopy,
  closeBoardGameBillingGroupForBilling,
  closeBoardGameSessionForBilling,
  createBoardGameCopy,
  createBoardGameTitle,
  getBoardGameSession,
  listBoardGameFloor,
  listBoardGameChatBranches,
  listPublicBoardGameCafes,
  mergeBoardGameSeating,
  moveBoardGameSeating,
  openBoardGameSession,
  returnBoardGameCopy,
} from "../apps/web/lib/bms/boardGameCafe.ts";
import { recordPosSale } from "../apps/web/lib/bms/pos.ts";

const TAG = "bg-seat-test";


test("chat publication is independent of directory visibility against real PostgreSQL", async () => {
  // One rollback-only fixture transaction: never change or clean up a pre-existing shop.
  const client = await getClient();
  const fixtureIds: string[] = [];
  const fixtureSlugs: string[] = [];
  try {
    await client.query("BEGIN");
    for (let i = 0; i < 2; i++) {
      const slug = `fake-bg-chat-${randomUUID()}`;
      fixtureSlugs.push(slug);
      fixtureIds.push((await client.query(
        "INSERT INTO bms_tenants (name, slug) VALUES ($1, $2) RETURNING id",
        [`FAKE chat visibility ${i}`, slug]
      )).rows[0].id);
    }
    const [shop, otherShop] = fixtureIds;
    await client.query("SELECT set_config('bms.tenant_id', $1, true)", [shop]);
    await client.query("INSERT INTO bms_store_profile (tenant_id, business_archetype) VALUES ($1, 'board_game_cafe')", [shop]);
    const branch = (await client.query(
      "INSERT INTO bms_locations (tenant_id, code, name, branch_code) VALUES ($1, 'MAIN', 'FAKE Chat branch', '00000') RETURNING id",
      [shop]
    )).rows[0].id;
    await client.query(
      `INSERT INTO bms_board_game_public_locations
        (tenant_id, location_id, public_visible, publish_rates, publish_availability, booking_enabled, latitude, longitude)
       VALUES ($1, $2, FALSE, TRUE, TRUE, FALSE, 13.75, 100.5)`, [shop, branch]
    );
    for (let i = 0; i < 4; i++) {
      await client.query(
        `INSERT INTO bms_board_game_time_rates (tenant_id, code, name, price_per_hour)
         VALUES ($1, $2, $3, $4)`, [shop, `FAKE_RATE_${i}`, `FAKE rate ${i}`, 40 + i]
      );
    }
    const area = (await client.query(
      "INSERT INTO bms_board_game_areas (tenant_id, location_id, name) VALUES ($1, $2, 'FAKE chat area') RETURNING id",
      [shop, branch]
    )).rows[0].id;
    for (let i = 0; i < 4; i++) {
      const table = (await client.query(
        `INSERT INTO bms_board_game_tables (tenant_id, location_id, area_id, code, name, blocked)
         VALUES ($1, $2, $3, $4, $4, $5) RETURNING id`,
        [shop, branch, area, `FAKE_CHAT_${i}`, i === 3]
      )).rows[0].id;
      if (i === 0) await client.query(
        "INSERT INTO bms_board_game_seatings (tenant_id, location_id, table_id) VALUES ($1, $2, $3)",
        [shop, branch, table]
      );
    }
    for (let i = 0; i < 7; i++) {
      const title = (await client.query(
        `INSERT INTO bms_board_game_titles (tenant_id, title, public_visible, min_players, max_players)
         VALUES ($1, $2, $3, 2, 6) RETURNING id`, [shop, `FAKE chat title ${i}`, i < 6]
      )).rows[0].id;
      await client.query(
        `INSERT INTO bms_board_game_copies (tenant_id, title_id, location_id, copy_code)
         VALUES ($1, $2, $3, $4)`, [shop, title, branch, `FAKE_CHAT_COPY_${i}`]
      );
      if (i === 0) await client.query(
        `INSERT INTO bms_board_game_copies (tenant_id, title_id, location_id, copy_code, status)
         VALUES ($1, $2, $3, 'FAKE_CHAT_LOST', 'LOST')`, [shop, title, branch]
      );
    }

    // Exercise the same RLS role as the production wrapper, inside this fixture transaction.
    await client.query("SET LOCAL ROLE bms_app");
    const read = (kind: "rates" | "availability" | "library") =>
      readBoardGameCustomerInfoInTx(client, shop, kind, { limit: 20 });
    const rates = await read("rates");
    assert.equal(rates.status, "OK");
    assert.equal(rates.rates.length, 4);
    const floor = await read("availability");
    assert.equal(floor.status, "OK");
    assert.equal(floor.totalTables, 3, "blocked table is excluded");
    assert.equal(floor.availableTables, 2, "active seating occupies one table");
    assert.equal(floor.booking.canSubmitViaChat, true);
    const library = await read("library");
    assert.equal(library.status, "OK");
    assert.equal(library.games.length, 6);
    assert.ok(library.games.every((game) => game.totalCopies === 1 && game.availableCopies === 1));
    assert.ok(!library.games.some((game) => game.title === "FAKE chat title 6"));
    assert.doesNotMatch(JSON.stringify([rates, floor, library]), /locationId|tableId|copyId|FAKE_CHAT_LOST/);
    for (const input of [{}, { latitude: 13.75, longitude: 100.5 }]) {
      assert.deepEqual(await listPublicBoardGameCafes(input, { tenantId: shop, client }), []);
    }

    await client.query("RESET ROLE");
    await client.query("SELECT set_config('bms.tenant_id', $1, true)", [otherShop]);
    await client.query("INSERT INTO bms_store_profile (tenant_id, business_archetype) VALUES ($1, 'board_game_cafe')", [otherShop]);
    const otherBranch = (await client.query(
      "INSERT INTO bms_locations (tenant_id, code, name, branch_code) VALUES ($1, 'MAIN', 'FAKE Other chat branch', '00000') RETURNING id",
      [otherShop]
    )).rows[0].id;
    await client.query("SET LOCAL ROLE bms_app");
    assert.deepEqual(await listBoardGameChatBranches({ tenantId: otherShop, client }), []);
    assert.equal((await readBoardGameCustomerInfoInTx(client, otherShop, "rates")).status, "NOT_PUBLISHED");
    await client.query("RESET ROLE");
    await client.query(
      "INSERT INTO bms_board_game_public_locations (tenant_id, location_id) VALUES ($1, $2)", [otherShop, otherBranch]
    );
    await client.query("SET LOCAL ROLE bms_app");
    assert.deepEqual((await listBoardGameChatBranches({ tenantId: otherShop, client })).map((c) => c.locationId), [otherBranch]);
    // Also test the mandatory SQL tenant predicate without RLS masking a missing WHERE.
    await client.query("RESET ROLE");
    await client.query("SELECT set_config('bms.tenant_id', '', true)");
    assert.deepEqual((await listBoardGameChatBranches({ tenantId: otherShop, client })).map((c) => c.locationId), [otherBranch]);
    await client.query("SELECT set_config('bms.tenant_id', $1, true)", [shop]);

    await client.query("UPDATE bms_board_game_public_locations SET publish_rates = FALSE, publish_availability = FALSE WHERE tenant_id = $1", [shop]);
    assert.equal((await read("rates")).status, "NOT_PUBLISHED");
    const unpublished = await read("availability");
    assert.equal(unpublished.status, "NOT_PUBLISHED");
    assert.equal(unpublished.totalTables, null);
    assert.equal(unpublished.availableTables, null);
    assert.ok((await read("library")).games.every((game) => game.availableCopies === null));
    await client.query("UPDATE bms_locations SET active = FALSE WHERE tenant_id = $1 AND id = $2", [shop, branch]);
    assert.deepEqual(await listBoardGameChatBranches({ tenantId: shop, client }), []);
    assert.equal((await read("rates")).status, "NOT_PUBLISHED");
    await client.query("UPDATE bms_locations SET active = TRUE WHERE tenant_id = $1 AND id = $2", [shop, branch]);
    await client.query("UPDATE bms_tenants SET active = FALSE WHERE id = $1", [shop]);
    assert.deepEqual(await listBoardGameChatBranches({ tenantId: shop, client }), []);
    await client.query("UPDATE bms_tenants SET active = TRUE WHERE id = $1", [shop]);
    await client.query("UPDATE bms_store_profile SET business_archetype = 'restaurant' WHERE tenant_id = $1", [shop]);
    assert.deepEqual(await listBoardGameChatBranches({ tenantId: shop, client }), []);
  } finally {
    try {
      await client.query("ROLLBACK");
      assert.deepEqual((await client.query(
        "SELECT id FROM bms_tenants WHERE id = ANY($1::uuid[]) OR slug = ANY($2::text[])",
        [fixtureIds, fixtureSlugs]
      )).rows, [], "all of this test's fake tenants must disappear; never delete unrelated fake-% rows");
    } finally {
      client.release();
    }
  }
});

const SIZE = "BASE";
const SNACK = `FAKE-${TAG}-SNACK`;

let tenantId = "";
let locationId = "";
let otherLocationId = "";
let otherTableId = "";
let deviceId = "";
let shiftId = "";
let staffId = "";
let areaId = "";
const tables: Record<string, string> = {};

let seq = 0;
const key = (label: string) => `fake-${TAG}-${label}-${Date.now()}-${++seq}`;
const money = (value: number) => Math.round(value * 100) / 100;

const seatingOf = async (sessionId: string) =>
  (await query<{
    id: string; table_id: string; status: string; origin_session_id: string | null;
  }>(
    `SELECT st.id, st.table_id, st.status, st.origin_session_id
       FROM bms_board_game_sessions s
       JOIN bms_board_game_seatings st ON st.tenant_id = s.tenant_id AND st.id = s.seating_id
      WHERE s.tenant_id = $1 AND s.id = $2`,
    [tenantId, sessionId]
  )).rows[0];

const seatingRow = async (id: string) =>
  (await query<{ status: string; table_id: string; merged_into_seating_id: string | null }>(
    `SELECT status, table_id, merged_into_seating_id
       FROM bms_board_game_seatings WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  )).rows[0];

const sessionRow = async (id: string) =>
  (await query<{ status: string; table_id: string; seating_id: string }>(
    `SELECT status, table_id, seating_id
       FROM bms_board_game_sessions WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  )).rows[0];

const groupRows = async (sessionId: string) =>
  (await query<{ id: string; group_no: number; status: string; amount_due: string; tab_amount: string }>(
    `SELECT id, group_no, status, amount_due::text, tab_amount::text
       FROM bms_board_game_billing_groups
      WHERE tenant_id = $1 AND session_id = $2 ORDER BY group_no`,
    [tenantId, sessionId]
  )).rows;

const cardOf = async (tableId: string) => {
  const floor = await listBoardGameFloor(tenantId, locationId);
  const card = floor.tables.find((table) => table.id === tableId);
  assert.ok(card, "โต๊ะที่เทสใช้ต้องอยู่บนผัง");
  return card!;
};

async function openParty(tableId: string, people: number, groups = 1) {
  return openBoardGameSession(
    tenantId,
    {
      idempotencyKey: key("open"),
      locationId,
      tableId,
      billingMode: "OPEN_ENDED",
      // ถอยเวลาเริ่มไปหนึ่งชั่วโมง เพื่อให้มีนาทีที่คิดเงินได้จริงโดยไม่ต้องรอในเทส
      startedAt: new Date(Date.now() - 3600_000),
      posDeviceId: deviceId,
      posShiftId: shiftId,
      participants: Array.from({ length: people }, (_, index) => ({
        rateId,
        displayName: `FAKE player ${index + 1}`,
        billingGroupNo: groups > 1 ? (index % groups) + 1 : 1,
      })),
    },
    staffId
  );
}

async function payGroup(billingGroupId: string, amount: number) {
  return recordPosSale({
    tenantId,
    deviceId,
    shiftId,
    cashierUserId: staffId,
    idempotencyKey: key("sale"),
    lines: [],
    boardGameBillingGroupId: billingGroupId,
    payments: [{ method: "CASH", amount }],
  });
}

async function settleWholeTable(sessionId: string) {
  const closed = await closeBoardGameSessionForBilling(
    tenantId, sessionId, { idempotencyKey: key("close") }, staffId
  );
  for (const group of closed.groups) {
    await payGroup(group.id, money(group.amountDue + group.tabAmount));
  }
}

let rateId = "";
let firstCopyId = "";
let secondCopyId = "";

test("setup: a throwaway board-game cafe with four tables and a second branch", async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG}`, `fake-${TAG}-${Date.now()}`]
  )).rows[0].id;
  locationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code)
     VALUES ($1,'MAIN',$2,'00000') RETURNING id`,
    [tenantId, `FAKE ${TAG} branch`]
  )).rows[0].id;
  otherLocationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office)
     VALUES ($1,'BR2',$2,'00002',FALSE) RETURNING id`,
    [tenantId, `FAKE ${TAG} branch 2`]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_store_profile (tenant_id, business_archetype) VALUES ($1,'board_game_cafe')`,
    [tenantId]
  );
  staffId = (await query<{ id: string }>(
    `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash, fake_test)
     SELECT $2, $3, $3, 'Administrator', r.id, $1, 'x', TRUE
       FROM roles r WHERE r.name = 'Administrator' LIMIT 1
     RETURNING id`,
    [tenantId, `FAKE ${TAG} staff`, `fake-${TAG}-staff-${Date.now()}@example.invalid`]
  )).rows[0].id;
  deviceId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_devices (tenant_id, location_id, code, name)
     VALUES ($1,$2,'POS-1',$3) RETURNING id`, [tenantId, locationId, `FAKE ${TAG} device`]
  )).rows[0].id;
  shiftId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_shifts (tenant_id, location_id, device_id, opened_by, opening_float)
     VALUES ($1,$2,$3,$4,0) RETURNING id`, [tenantId, locationId, deviceId, staffId]
  )).rows[0].id;
  areaId = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_areas (tenant_id, location_id, name)
     VALUES ($1,$2,$3) RETURNING id`, [tenantId, locationId, `FAKE ${TAG} zone`]
  )).rows[0].id;
  for (const code of ["T1", "T2", "T3", "T4"]) {
    tables[code] = (await query<{ id: string }>(
      `INSERT INTO bms_board_game_tables (tenant_id, location_id, area_id, code, name, seats)
       VALUES ($1,$2,$3,$4,$5,6) RETURNING id`,
      [tenantId, locationId, areaId, `FAKE-${code}`, `FAKE ${TAG} ${code}`]
    )).rows[0].id;
  }
  const otherArea = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_areas (tenant_id, location_id, name)
     VALUES ($1,$2,$3) RETURNING id`, [tenantId, otherLocationId, `FAKE ${TAG} zone 2`]
  )).rows[0].id;
  otherTableId = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_tables (tenant_id, location_id, area_id, code, name, seats)
     VALUES ($1,$2,$3,'FAKE-B2T1',$4,6) RETURNING id`,
    [tenantId, otherLocationId, otherArea, `FAKE ${TAG} other branch table`]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$2,25,TRUE,'V')`, [tenantId, SNACK]
  );
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,100,0)`, [tenantId, locationId, SNACK, SIZE]
  );
  const surfaces = (await query<{ reg: string | null }>(
    `SELECT to_regclass('bms_product_sales_surfaces')::text AS reg`)).rows[0]?.reg;
  if (surfaces) {
    for (const surface of ["RETAIL_POS", "ONLINE_ORDER", "PUBLIC_STOREFRONT", "CUSTOMER_AI"]) {
      await query(
        `INSERT INTO bms_product_sales_surfaces (tenant_id, product_sku, surface)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [tenantId, SNACK, surface]
      );
    }
  }
  rateId = (await query<{ id: string }>(
    `INSERT INTO bms_board_game_time_rates
       (tenant_id, code, name, customer_type, price_per_hour, minimum_minutes, rounding_minutes, grace_minutes)
     VALUES ($1,'FAKE_GENERAL',$2,'GENERAL',60,60,30,0) RETURNING id`,
    [tenantId, `FAKE ${TAG} rate`]
  )).rows[0].id;
  const title = await createBoardGameTitle(
    tenantId, { title: `FAKE ${TAG} merged loans` }, staffId
  );
  firstCopyId = (await createBoardGameCopy(
    tenantId,
    { titleId: title.id, locationId, copyCode: `FAKE-${TAG}-COPY-1` },
    staffId,
  )).id;
  secondCopyId = (await createBoardGameCopy(
    tenantId,
    { titleId: title.id, locationId, copyCode: `FAKE-${TAG}-COPY-2` },
    staffId,
  )).id;
});

test("opening a table claims a seating, and the vacated table is reopenable right after a move", async () => {
  const session = await openParty(tables.T1, 2);
  const before = await seatingOf(session.id);
  assert.equal(before.table_id, tables.T1);
  assert.equal(before.status, "ACTIVE");
  assert.equal(before.origin_session_id, session.id, "ที่นั่งแรกของ visit ต้องจำ session ต้นทางไว้");

  // เปิดโต๊ะทับที่นั่งที่ยังเปิดอยู่ไม่ได้ — ที่นั่งเป็นเจ้าของโต๊ะ ไม่ใช่ session
  await assert.rejects(() => openParty(tables.T1, 2), /มีลูกค้าอยู่แล้ว/);

  const moved = await moveBoardGameSeating(
    tenantId, session.id, tables.T2, { idempotencyKey: key("move") }, staffId
  );
  assert.equal(moved.action, "move");
  assert.equal(moved.fromTableId, tables.T1);
  assert.equal(moved.toTableId, tables.T2);
  assert.equal(moved.seatingId, before.id, "โต๊ะที่มีชุดเดียวย้ายทั้งที่นั่ง จึงคง id เดิม");
  assert.deepEqual(moved.sessionIds, [session.id]);

  const after = await seatingOf(session.id);
  assert.equal(after.id, before.id);
  assert.equal(after.table_id, tables.T2);
  assert.equal((await sessionRow(session.id)).seating_id, before.id);
  // session.table_id คือโต๊ะที่ visit นี้ "เปิด" ไว้ ไม่ใช่โต๊ะปัจจุบัน — ย้ายแล้วต้องไม่ถูกเขียนใหม่
  assert.equal((await sessionRow(session.id)).table_id, tables.T1, "ประวัติของ visit ห้ามถูกย้ายตาม");
  assert.equal((await getBoardGameSession(tenantId, session.id)).tableId, tables.T2,
    "จอที่ถามว่า 'โต๊ะไหน' ต้องได้โต๊ะปัจจุบัน ไม่ใช่โต๊ะที่เปิดไว้เมื่อชั่วโมงก่อน");

  assert.equal((await cardOf(tables.T1)).openSession, null, "โต๊ะเดิมต้องว่างทันที");
  assert.equal((await cardOf(tables.T2)).openSession?.id, session.id);

  // ว่างจริงคือ "เปิดโต๊ะใหม่ทับได้" ไม่ใช่แค่การ์ดว่าง
  const reopened = await openParty(tables.T1, 2);
  await settleWholeTable(reopened.id);
  await settleWholeTable(session.id);
});

test("moving a party keeps every bill, tab row and reservation order exactly as it was", async () => {
  const session = await openParty(tables.T1, 4, 2);
  const groups = await groupRows(session.id);
  await addBoardGameGroupItem(
    tenantId,
    {
      billingGroupId: groups[0].id, locationId, idempotencyKey: key("tab"),
      sku: SNACK, size: SIZE, packQty: 2, deviceId, shiftId,
    },
    staffId
  );
  const reservationBefore = (await query<{ id: string; status: string }>(
    `SELECT id, status FROM bms_orders
      WHERE tenant_id = $1 AND board_game_billing_group_id = $2 AND status = 'PENDING'`,
    [tenantId, groups[0].id]
  )).rows;
  assert.equal(reservationBefore.length, 1, "ของบน tab ต้องถูกจองไว้แล้วก่อนย้ายโต๊ะ");
  const detailBefore = await getBoardGameSession(tenantId, session.id);

  await moveBoardGameSeating(
    tenantId, session.id, tables.T3, { idempotencyKey: key("move") }, staffId
  );

  const detailAfter = await getBoardGameSession(tenantId, session.id);
  assert.equal(detailAfter.tableId, tables.T3);
  assert.deepEqual(
    detailAfter.billingGroups.map((group) => [group.id, group.status, group.tabAmount]),
    detailBefore.billingGroups.map((group) => [group.id, group.status, group.tabAmount]),
    "ย้ายโต๊ะห้ามแตะบิล — id สถานะ และยอดบน tab ต้องเท่าเดิมทุกใบ"
  );
  assert.deepEqual(
    detailAfter.participants.map((person) => person.id),
    detailBefore.participants.map((person) => person.id),
    "นาฬิกาของแต่ละคนต้องไม่ถูกรีเซ็ตจากการย้ายโต๊ะ"
  );
  const reservationAfter = (await query<{ id: string; status: string }>(
    `SELECT id, status FROM bms_orders
      WHERE tenant_id = $1 AND board_game_billing_group_id = $2 AND status = 'PENDING'`,
    [tenantId, groups[0].id]
  )).rows;
  assert.deepEqual(reservationAfter, reservationBefore, "ใบจองของ tab ต้องเป็นใบเดิม ไม่ใช่ใบใหม่");

  await settleWholeTable(session.id);
});

test("move and merge refuse to do each other's job instead of guessing", async () => {
  const staying = await openParty(tables.T1, 2);
  const moving = await openParty(tables.T2, 2);

  await assert.rejects(
    () => moveBoardGameSeating(tenantId, moving.id, tables.T1, { idempotencyKey: key("move") }, staffId),
    /รวมโต๊ะ/,
    "ย้ายไปทับโต๊ะที่มีคนอยู่ต้องถูกปฏิเสธ ไม่ใช่กลายเป็นการรวมโต๊ะเงียบ ๆ"
  );
  await assert.rejects(
    () => mergeBoardGameSeating(tenantId, moving.id, tables.T3, { idempotencyKey: key("merge") }, staffId),
    /ย้ายโต๊ะ/,
    "รวมกับโต๊ะว่างต้องถูกปฏิเสธ ไม่ใช่กลายเป็นการย้าย"
  );
  await assert.rejects(
    () => moveBoardGameSeating(tenantId, moving.id, tables.T2, { idempotencyKey: key("move") }, staffId),
    /โต๊ะเดิม/,
  );
  // โต๊ะของอีกสาขาไม่ใช่ปลายทางที่มีอยู่จริงสำหรับ visit นี้
  await assert.rejects(
    () => moveBoardGameSeating(tenantId, moving.id, otherTableId, { idempotencyKey: key("move") }, staffId),
    /ไม่พบโต๊ะปลายทาง/,
  );

  await settleWholeTable(staying.id);
  await settleWholeTable(moving.id);
});

test("merging two occupied tables keeps two separate bills, and one payment does not free the table", async () => {
  const host = await openParty(tables.T1, 2);
  const guest = await openParty(tables.T2, 2);
  const hostSeating = await seatingOf(host.id);
  const guestSeating = await seatingOf(guest.id);

  const merged = await mergeBoardGameSeating(
    tenantId, guest.id, tables.T1, { idempotencyKey: key("merge") }, staffId
  );
  assert.equal(merged.action, "merge");
  assert.equal(merged.seatingId, hostSeating.id);
  assert.equal(merged.sourceSeatingId, guestSeating.id);
  assert.deepEqual(merged.sessionIds, [guest.id]);

  assert.equal((await seatingRow(guestSeating.id)).status, "MERGED");
  assert.equal((await seatingRow(guestSeating.id)).merged_into_seating_id, hostSeating.id);
  assert.equal((await seatingOf(guest.id)).id, hostSeating.id, "แขกต้องย้ายมานั่งที่นั่งของเจ้าบ้าน");
  assert.equal((await sessionRow(guest.id)).status, "OPEN", "รวมโต๊ะห้ามปิด visit ของใคร");

  const card = await cardOf(tables.T1);
  assert.equal(card.openSession?.sessionCount, 2, "การ์ดต้องบอกว่ามีสองชุดนั่งร่วมกัน");
  assert.equal(card.openSession?.billingGroupCount, 2, "สองชุด = สองบิล ไม่ใช่บิลรวม");
  assert.equal((await cardOf(tables.T2)).openSession, null, "โต๊ะที่ย้ายออกต้องว่างทันที");

  // เก็บเงินชุดแรกแล้วโต๊ะยังต้องไม่ว่าง เพราะอีกชุดยังเล่นอยู่
  await settleWholeTable(host.id);
  assert.equal((await sessionRow(host.id)).status, "PAID");
  assert.equal((await seatingRow(hostSeating.id)).status, "ACTIVE", "อีกชุดยังเล่นอยู่ โต๊ะต้องไม่ว่าง");
  assert.ok((await cardOf(tables.T1)).openSession, "ผังต้องยังแสดงว่าโต๊ะนี้มีคน");
  await assert.rejects(() => openParty(tables.T1, 2), /มีลูกค้าอยู่แล้ว/);

  await settleWholeTable(guest.id);
  assert.equal((await seatingRow(hostSeating.id)).status, "CLOSED");
  assert.equal((await cardOf(tables.T1)).openSession, null, "จ่ายครบทุกชุดแล้วโต๊ะจึงว่าง");
});

test("adding a player after a seating merge counts every party sharing the table", async () => {
  const host = await openParty(tables.T1, 3);
  const guest = await openParty(tables.T2, 3);
  await mergeBoardGameSeating(
    tenantId, guest.id, tables.T1, { idempotencyKey: key("merge-capacity") }, staffId,
  );

  await assert.rejects(
    () => addBoardGameParticipant(
      tenantId,
      {
        sessionId: guest.id,
        idempotencyKey: key("add-over-capacity"),
        rateId,
        displayName: "FAKE seventh player",
      },
      staffId,
    ),
    /การเพิ่มคนนี้จะเป็น 7 คน.*ยืนยันการใช้โต๊ะเกินความจุ/,
  );
  const added = await addBoardGameParticipant(
    tenantId,
    {
      sessionId: guest.id,
      idempotencyKey: key("add-over-capacity-confirmed"),
      rateId,
      displayName: "FAKE seventh player",
      allowOverCapacity: true,
    },
    staffId,
  );
  assert.equal(added.displayName, "FAKE seventh player");

  await settleWholeTable(host.id);
  await settleWholeTable(guest.id);
});

test("moving two parties together keeps both game loans on their original sessions", async () => {
  const first = await openParty(tables.T1, 4);
  const second = await openParty(tables.T2, 4);
  const firstLoan = await checkoutBoardGameCopy(
    tenantId,
    { sessionId: first.id, copyId: firstCopyId, idempotencyKey: key("loan-first") },
    staffId,
  );
  const secondLoan = await checkoutBoardGameCopy(
    tenantId,
    { sessionId: second.id, copyId: secondCopyId, idempotencyKey: key("loan-second") },
    staffId,
  );

  // จำลองหน้าร้าน: ย้ายชุดแรกไปโต๊ะว่าง แล้วรวมชุดที่สองเข้าที่โต๊ะปลายทาง
  await moveBoardGameSeating(
    tenantId, first.id, tables.T3, { idempotencyKey: key("move-first") }, staffId
  );
  await mergeBoardGameSeating(
    tenantId, second.id, tables.T3,
    { idempotencyKey: key("merge-second"), allowOverCapacity: true },
    staffId
  );

  const loans = (await query<{
    id: string; session_id: string; copy_id: string; status: string; returned_at: Date | null;
  }>(
    `SELECT id, session_id, copy_id, status, returned_at
       FROM bms_board_game_session_games
      WHERE tenant_id = $1 AND session_id = ANY($2::uuid[])
      ORDER BY session_id, id`,
    [tenantId, [first.id, second.id]],
  )).rows;
  assert.equal(loans.length, 2, "รวมโต๊ะแล้ว loan ทั้งสองใบต้องยังอยู่ครบ");
  assert.deepEqual(
    new Map(loans.map((loan) => [loan.session_id, [loan.id, loan.copy_id, loan.status, loan.returned_at]])),
    new Map([
      [first.id, [firstLoan.id, firstCopyId, "CHECKED_OUT", null]],
      [second.id, [secondLoan.id, secondCopyId, "CHECKED_OUT", null]],
    ]),
    "การย้าย/รวมโต๊ะห้ามย้าย loan ข้าม session หรือคืนเกมให้เอง",
  );

  const firstDetail = await getBoardGameSession(tenantId, first.id);
  const secondDetail = await getBoardGameSession(tenantId, second.id);
  assert.equal(firstDetail.tableId, tables.T3);
  assert.equal(secondDetail.tableId, tables.T3);
  assert.equal(firstDetail.originTableId, tables.T1);
  assert.equal(secondDetail.originTableId, tables.T2);
  assert.equal(firstDetail.games[0]?.id, firstLoan.id);
  assert.equal(secondDetail.games[0]?.id, secondLoan.id);
  assert.deepEqual(
    new Set((await cardOf(tables.T3)).openSession?.sessionIds ?? []),
    new Set([first.id, second.id]),
    "ผังโต๊ะต้องเปิดทางให้จอดึงรายละเอียดเกมของทั้งสอง session",
  );

  await returnBoardGameCopy(
    tenantId, { loanId: firstLoan.id, idempotencyKey: key("return-first") }, staffId
  );
  await returnBoardGameCopy(
    tenantId, { loanId: secondLoan.id, idempotencyKey: key("return-second") }, staffId
  );
  await settleWholeTable(first.id);
  await settleWholeTable(second.id);
});

test("a merged table is not a one-way door: moving one party out detaches only that party", async () => {
  const host = await openParty(tables.T1, 2);
  const guest = await openParty(tables.T2, 2);
  const hostSeating = await seatingOf(host.id);
  await mergeBoardGameSeating(
    tenantId, guest.id, tables.T1, { idempotencyKey: key("merge") }, staffId
  );

  const split = await moveBoardGameSeating(
    tenantId, guest.id, tables.T3, { idempotencyKey: key("split") }, staffId
  );
  assert.deepEqual(split.sessionIds, [guest.id], "ต้องย้ายเฉพาะชุดที่เลือก ไม่ลากอีกชุดไปด้วย");
  assert.notEqual(split.seatingId, hostSeating.id, "ชุดที่แยกออกไปต้องได้ที่นั่งของตัวเอง");

  assert.equal((await seatingOf(host.id)).id, hostSeating.id);
  assert.equal((await seatingOf(host.id)).table_id, tables.T1, "เจ้าบ้านต้องอยู่โต๊ะเดิม");
  assert.equal((await seatingOf(guest.id)).table_id, tables.T3);
  assert.equal((await seatingRow(hostSeating.id)).status, "ACTIVE");
  assert.equal((await cardOf(tables.T1)).openSession?.sessionCount, 1);
  assert.equal((await cardOf(tables.T3)).openSession?.id, guest.id);

  await settleWholeTable(host.id);
  await settleWholeTable(guest.id);
});

test("a group that already paid does not drag the table along when the rest merges", async () => {
  // ชุดที่แยกบิลแล้วจ่ายไปหนึ่งใบ (Phase 3) ต้องยังย้ายโต๊ะได้ — เวลาที่แช่ไว้ห้ามเดินต่อ
  const session = await openParty(tables.T1, 4, 2);
  const groups = await groupRows(session.id);
  const closed = await closeBoardGameBillingGroupForBilling(
    tenantId, groups[0].id, { idempotencyKey: key("close-group") }, staffId
  );
  await payGroup(groups[0].id, money(closed.groups[0].amountDue + closed.groups[0].tabAmount));

  const frozen = (await groupRows(session.id))[0];
  await moveBoardGameSeating(
    tenantId, session.id, tables.T2, { idempotencyKey: key("move") }, staffId
  );
  assert.deepEqual(
    (await groupRows(session.id))[0],
    frozen,
    "บิลที่จ่ายไปแล้วต้องไม่ถูกแตะจากการย้ายโต๊ะเลยสักคอลัมน์"
  );
  assert.equal((await seatingOf(session.id)).table_id, tables.T2);

  await settleWholeTable(session.id);
});

test("replaying a relocate returns the stored result, and the same key with another table conflicts", async () => {
  const session = await openParty(tables.T1, 2);
  const moveKey = key("move");
  const first = await moveBoardGameSeating(
    tenantId, session.id, tables.T2, { idempotencyKey: moveKey }, staffId
  );
  const replay = await moveBoardGameSeating(
    tenantId, session.id, tables.T2, { idempotencyKey: moveKey }, staffId
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.seatingId, first.seatingId);
  assert.equal(replay.toTableId, tables.T2);
  assert.equal((await seatingOf(session.id)).table_id, tables.T2, "ยิงซ้ำต้องไม่ย้ายอีกรอบ");

  await assert.rejects(
    () => moveBoardGameSeating(
      tenantId, session.id, tables.T3, { idempotencyKey: moveKey }, staffId
    ),
    (error: unknown) => {
      // ไคลเอนต์อ่านรหัสนี้เป็น CONFLICT ("ดึงข้อมูลใหม่") ไม่ใช่ INTERNAL_SERVER_ERROR
      // ซึ่งเอกสารสัญญาสั่งให้ยิงซ้ำด้วยคีย์เดิม = วนล้มแบบเดิมตลอดไป
      assert.ok(isIdempotencyConflictError(error), `ต้องเป็น IdempotencyConflictError: ${error}`);
      assert.equal(error.action, "seating.move");
      return true;
    },
  );
  await settleWholeTable(session.id);
});

test("cancelling one of two merged parties frees nothing until the other one is settled", async () => {
  const host = await openParty(tables.T1, 2);
  const guest = await openParty(tables.T2, 2);
  const hostSeating = await seatingOf(host.id);
  await mergeBoardGameSeating(
    tenantId, guest.id, tables.T1, { idempotencyKey: key("merge") }, staffId
  );

  await cancelBoardGameSession(
    tenantId, guest.id, { idempotencyKey: key("cancel"), reason: "FAKE walked out" }, staffId
  );
  assert.equal((await seatingRow(hostSeating.id)).status, "ACTIVE");
  assert.equal((await cardOf(tables.T1)).openSession?.sessionCount, 1);

  await settleWholeTable(host.id);
  assert.equal((await seatingRow(hostSeating.id)).status, "CLOSED");
  assert.equal((await cardOf(tables.T1)).openSession, null);
});

test("teardown: the throwaway cafe leaves nothing behind", async () => {
  const ids = [tenantId].filter(Boolean);
  if (!ids.length) return;
  // order ชี้ไปที่กลุ่ม และกลุ่มชี้กลับมาที่ order — ต้องปลดข้างหนึ่งก่อน ไม่งั้นลบไม่ได้ทั้งคู่
  await query(
    `UPDATE bms_orders SET board_game_session_id = NULL, board_game_billing_group_id = NULL
      WHERE tenant_id = ANY($1::uuid[])`,
    [ids]
  );
  for (const table of [
    "bms_board_game_session_games",
    "bms_board_game_session_participants",
    "bms_board_game_group_items",
    "bms_board_game_billing_groups",
    "bms_payments",
    "bms_order_items",
    "bms_order_discounts",
    "bms_tax_documents",
    "bms_pos_cash_movements",
    "bms_orders",
    "bms_board_game_sessions",
    // ที่นั่งถือ FK ไปที่โต๊ะ (`9.91`) — ลบโต๊ะก่อนจะติด และ teardown ที่ติดจะทิ้งร้านทดสอบไว้ในฐาน
    "bms_board_game_seatings",
    "bms_board_game_copies",
    "bms_board_game_titles",
    "bms_board_game_tables",
    "bms_board_game_areas",
    "bms_board_game_time_rates",
    "bms_board_game_idempotency_results",
    "bms_pos_shifts",
    "bms_pos_devices",
    "bms_stock_movements",
    "bms_inventory",
    "bms_products",
    "bms_customers",
    "bms_store_profile",
    "bms_locations",
    "bms_audit_log",
    "users",
  ]) {
    await query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
  }
  await query(`DELETE FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids]);
  assert.equal(
    Number((await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids])).rows[0].n),
    0,
    "ร้านทดสอบต้องไม่เหลือค้างในฐาน"
  );
});

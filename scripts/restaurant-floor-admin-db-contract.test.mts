/**
 * Restaurant floor admin (`9.59`) against a real local Postgres.
 *
 * ⚠️ Writes real rows. This suite creates a throwaway restaurant tenant and removes it at the end.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import {
  createRestaurantArea,
  createRestaurantTable,
  deleteRestaurantArea,
  deleteRestaurantTable,
  listRestaurantFloor,
  renameRestaurantArea,
  reorderRestaurantAreas,
  saveRestaurantFloorLayout,
  updateRestaurantTable,
} from "../apps/web/lib/bms/restaurantPos.ts";
import { bmsRestaurantFloorAdminResolvers } from "../apps/web/graphql/bmsRestaurantFloorAdmin.ts";

const TAG = `restaurant-floor-admin-${Date.now()}`;
let tenantId = "";
let locationId = "";
let otherLocationId = "";
let actorUserId = "";
let deviceId = "";
let shiftId = "";
let mainAreaId = "";
let secondAreaId = "";
let firstTableId = "";

const actor = () => ({ tenantId, actorUserId });

test("setup: throwaway restaurant tenant and two branches", async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG}`, `fake-${TAG}`]
  )).rows[0].id;
  locationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code)
     VALUES ($1,'MAIN',$2,'00000') RETURNING id`,
    [tenantId, `FAKE ${TAG} main`]
  )).rows[0].id;
  otherLocationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office)
     VALUES ($1,'B2',$2,'00002',FALSE) RETURNING id`,
    [tenantId, `FAKE ${TAG} second`]
  )).rows[0].id;
  await query(`INSERT INTO bms_store_profile (tenant_id, business_archetype) VALUES ($1,'restaurant')`, [tenantId]);
  actorUserId = (await query<{ id: string }>(
    `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash, fake_test)
     SELECT $2,$3,$3,'Administrator',r.id,$1,'x',TRUE FROM roles r
      WHERE r.name = 'Administrator' LIMIT 1 RETURNING id`,
    [tenantId, `FAKE ${TAG}`, `fake-${TAG}@example.invalid`]
  )).rows[0].id;
});

test("areas can be created, renamed and reordered; duplicate names are readable errors", async () => {
  const main = await createRestaurantArea({ ...actor(), locationId, name: "Main room" });
  const second = await createRestaurantArea({ ...actor(), locationId, name: "Terrace" });
  mainAreaId = main.id;
  secondAreaId = second.id;
  const renamed = await renameRestaurantArea({ ...actor(), areaId: secondAreaId, name: "Garden" });
  assert.equal(renamed.name, "Garden");
  await assert.rejects(
    () => renameRestaurantArea({ ...actor(), areaId: secondAreaId, name: "Main room" }),
    /มีชื่อโซนนี้ในสาขาแล้ว/
  );
  const reordered = await reorderRestaurantAreas({
    ...actor(), locationId, orderedAreaIds: [secondAreaId, mainAreaId],
  });
  assert.deepEqual(reordered.map((area) => area.id), [secondAreaId, mainAreaId]);
  await assert.rejects(
    () => reorderRestaurantAreas({ ...actor(), locationId: otherLocationId, orderedAreaIds: [mainAreaId] }),
    /รายการโซนไม่ตรงกับโซนของสาขานี้/
  );
});

test("table codes advance across every area in the branch", async () => {
  const first = await createRestaurantTable({
    ...actor(), locationId, areaId: mainAreaId, name: "Window", seats: 2, shape: "round",
  });
  const second = await createRestaurantTable({
    ...actor(), locationId, areaId: secondAreaId, name: "Garden one", seats: 4, shape: "rect",
  });
  firstTableId = first.id;
  assert.equal(first.code, "T01");
  assert.equal(second.code, "T02");
  assert.equal(second.shape, "rect");
  assert.ok(second.positionX >= 0 && second.positionY >= 0);
});

test("an area with active tables and the final area are protected", async () => {
  await assert.rejects(
    () => deleteRestaurantArea({ ...actor(), areaId: secondAreaId }),
    /ยังมีโต๊ะใช้งานอยู่/
  );
  const empty = await createRestaurantArea({ ...actor(), locationId: otherLocationId, name: "Only area" });
  await assert.rejects(
    () => deleteRestaurantArea({ ...actor(), areaId: empty.id }),
    /โซนสุดท้าย/
  );
  const spare = await createRestaurantArea({ ...actor(), locationId, name: "Spare" });
  assert.equal(await deleteRestaurantArea({ ...actor(), areaId: spare.id }), true);
});

test("open checks lock area/block/delete but never coordinate edits", async () => {
  deviceId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_devices (tenant_id, location_id, code, name)
     VALUES ($1,$2,'FLOOR-TEST',$3) RETURNING id`,
    [tenantId, locationId, `FAKE ${TAG}`]
  )).rows[0].id;
  shiftId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_shifts (tenant_id, location_id, device_id, opened_by, opening_float)
     VALUES ($1,$2,$3,$4,0) RETURNING id`,
    [tenantId, locationId, deviceId, actorUserId]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_restaurant_checks
       (tenant_id, location_id, table_id, pos_device_id, pos_shift_id, opened_by, guest_count)
     VALUES ($1,$2,$3,$4,$5,$6,2)`,
    [tenantId, locationId, firstTableId, deviceId, shiftId, actorUserId]
  );

  await assert.rejects(
    () => updateRestaurantTable({ ...actor(), tableId: firstTableId, patch: { areaId: secondAreaId } }),
    /บิลเปิดอยู่/
  );
  await assert.rejects(
    () => updateRestaurantTable({ ...actor(), tableId: firstTableId, patch: { blocked: true } }),
    /บิลเปิดอยู่/
  );
  const moved = await updateRestaurantTable({
    ...actor(), tableId: firstTableId, patch: { positionX: 321, positionY: 123 },
  });
  assert.equal(moved.positionX, 321);
  assert.equal(moved.positionY, 123);
  await assert.rejects(() => deleteRestaurantTable({ ...actor(), tableId: firstTableId }), /บิลเปิดอยู่/);
});

test("bulk layout rejects a table from another branch before changing anything", async () => {
  const otherArea = (await listRestaurantFloor(tenantId, otherLocationId)).areas[0];
  const otherTable = await createRestaurantTable({
    ...actor(), locationId: otherLocationId, areaId: otherArea.id, name: "Other branch", seats: 2, shape: "round",
  });
  const before = (await listRestaurantFloor(tenantId, locationId)).tables.find((table) => table.id === firstTableId)!;
  await assert.rejects(
    () => saveRestaurantFloorLayout({
      ...actor(), locationId,
      positions: [{ tableId: firstTableId, x: 10, y: 10 }, { tableId: otherTable.id, x: 20, y: 20 }],
    }),
    /ไม่อยู่ในสาขานี้/
  );
  const after = (await listRestaurantFloor(tenantId, locationId)).tables.find((table) => table.id === firstTableId)!;
  assert.equal(after.positionX, before.positionX);
  assert.equal(after.positionY, before.positionY);
});

test("every admin mutation rejects a role without restaurant.floor.manage", async () => {
  const ctx = { scope: "admin", admin: { id: actorUserId, tenant_id: tenantId, role: "Sales" } };
  const calls: Array<() => Promise<unknown>> = [
    () => bmsRestaurantFloorAdminResolvers.Mutation.bmsCreateRestaurantArea(null, { locationId, name: "x" }, ctx),
    () => bmsRestaurantFloorAdminResolvers.Mutation.bmsRenameRestaurantArea(null, { areaId: mainAreaId, name: "x" }, ctx),
    () => bmsRestaurantFloorAdminResolvers.Mutation.bmsReorderRestaurantAreas(null, { locationId, orderedAreaIds: [] }, ctx),
    () => bmsRestaurantFloorAdminResolvers.Mutation.bmsDeleteRestaurantArea(null, { areaId: mainAreaId }, ctx),
    () => bmsRestaurantFloorAdminResolvers.Mutation.bmsCreateRestaurantTable(null, { locationId, areaId: mainAreaId, name: "x", seats: 2, shape: "round" }, ctx),
    () => bmsRestaurantFloorAdminResolvers.Mutation.bmsUpdateRestaurantTable(null, { tableId: firstTableId, patch: { name: "x" } }, ctx),
    () => bmsRestaurantFloorAdminResolvers.Mutation.bmsDeleteRestaurantTable(null, { tableId: firstTableId }, ctx),
    () => bmsRestaurantFloorAdminResolvers.Mutation.bmsSaveRestaurantFloorLayout(null, { locationId, positions: [] }, ctx),
  ];
  for (const call of calls) {
    await assert.rejects(call, (error: any) => error?.extensions?.code === "FORBIDDEN");
  }
});

test("floor writes leave transaction-local audit evidence", async () => {
  const actions = (await query<{ action: string }>(
    `SELECT action FROM bms_audit_log WHERE tenant_id = $1 AND action LIKE 'restaurant.%'`,
    [tenantId]
  )).rows.map((row) => row.action);
  for (const action of ["restaurant.area.create", "restaurant.area.rename", "restaurant.area.reorder", "restaurant.table.create", "restaurant.table.update"]) {
    assert.ok(actions.includes(action), `missing audit action ${action}`);
  }
});

test("teardown: remove the throwaway tenant", async () => {
  await query(`DELETE FROM bms_restaurant_checks WHERE tenant_id = $1`, [tenantId]);
  for (const table of [
    "bms_restaurant_tables", "bms_restaurant_areas", "bms_pos_shifts", "bms_pos_devices",
    "bms_audit_log", "users", "bms_store_profile", "bms_locations",
  ]) {
    await query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await query(`DELETE FROM bms_tenants WHERE id = $1`, [tenantId]);
  assert.equal(Number((await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_tenants WHERE id = $1`, [tenantId]
  )).rows[0].n), 0);
});

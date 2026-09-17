// Dev database only. Proves that fake-data cleanup does not fail when seeded staff have since
// become part of protected POS history.
import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db";
import { deleteUnreferencedFakeUsers } from "../apps/web/lib/bms/devCleanup";
import { seedFakePosDevices } from "../apps/web/lib/bms/devPosSeed";
import { seedFakeStaff } from "../apps/web/lib/bms/devSeed";
import { deleteTenant } from "../apps/web/lib/bms/platform";
import { provisionTestShop } from "../apps/web/lib/bms/testShop";

test("fake-user cleanup keeps POS history owners and continues deleting other fixtures", async (t) => {
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(process.env.POSTGRES_HOST ?? ""),
    "local test DB required"
  );

  const shop = await provisionTestShop({ name: "fake user cleanup contract" });
  t.after(async () => deleteTenant(shop.tenantId).catch(() => {}));

  const staff = await seedFakeStaff(shop.tenantId, 2);
  assert.equal(staff.length, 2);
  await seedFakePosDevices(shop.tenantId, 1);

  const locationId = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
    [shop.tenantId]
  )).rows[0].id;
  const deviceId = (await query<{ id: string }>(
    `SELECT id FROM bms_pos_devices WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
    [shop.tenantId]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_pos_shifts
       (tenant_id, location_id, device_id, status, opened_by, opening_float, note)
     VALUES ($1,$2,$3,'OPEN',$4,0,'operator-created shift')`,
    [shop.tenantId, locationId, deviceId, staff[0].id]
  );

  const result = await deleteUnreferencedFakeUsers(shop.tenantId);
  assert.ok(result.referencedIds.includes(staff[0].id), "shift owner must be retained");
  assert.ok(result.deletedIds.includes(staff[1].id), "unreferenced fake staff should still be deleted");

  const remaining = await query<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id = $1 ORDER BY id`,
    [shop.tenantId]
  );
  assert.deepEqual(remaining.rows.map((row) => row.id), [staff[0].id]);
});

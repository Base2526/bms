// Dev database only. Proves that fake-data cleanup does not fail when seeded staff have since
// become part of protected POS history.
import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db";
import { deleteUnreferencedFakeStaff, deleteUnreferencedFakeUsers } from "../apps/web/lib/bms/devCleanup";
import {
  FAKE_PHARMACY_ASSESSMENT_MARKER,
  deleteFakePharmacyAssessments,
  seedFakePharmacyAssessments,
} from "../apps/web/lib/bms/devPharmacySeed";
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

test("scenario staff cleanup preserves the demo Administrator account", async (t) => {
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(process.env.POSTGRES_HOST ?? ""),
    "local test DB required"
  );

  const shop = await provisionTestShop({ name: "fake staff cleanup scope contract" });
  t.after(async () => deleteTenant(shop.tenantId).catch(() => {}));
  const staff = await seedFakeStaff(shop.tenantId, 2);

  const result = await deleteUnreferencedFakeStaff(shop.tenantId);
  assert.deepEqual(new Set(result.deletedIds), new Set(staff.map((row) => row.id)));

  const remaining = await query<{ email: string }>(
    `SELECT email FROM users WHERE tenant_id = $1 ORDER BY email`,
    [shop.tenantId]
  );
  assert.deepEqual(remaining.rows.map((row) => row.email), [shop.adminEmail]);
});

test("a new pharmacy scenario gets inert protocols and five retry-safe assessments", async (t) => {
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(process.env.POSTGRES_HOST ?? ""),
    "local test DB required"
  );

  const shop = await provisionTestShop({
    name: "pharmacy fake scenario contract",
    businessArchetype: "pharmacy",
  });
  t.after(async () => deleteTenant(shop.tenantId).catch(() => {}));
  await seedFakeStaff(shop.tenantId, 6, undefined, "pharmacy");

  const protocols = await query<{
    protocol_key: string;
    status: string;
    clinically_approved: boolean;
    enabled: boolean;
  }>(
    `SELECT protocol_key, status, clinically_approved, enabled
       FROM bms_pharmacy_protocols
      WHERE tenant_id = $1
      ORDER BY protocol_key`,
    [shop.tenantId]
  );
  assert.deepEqual(
    protocols.rows.map((row) => [row.protocol_key, row.status, row.clinically_approved, row.enabled]),
    [
      ["cough", "DRAFT", false, false],
      ["diarrhea", "DRAFT", false, false],
      ["headache", "DRAFT", false, false],
    ]
  );

  const first = await seedFakePharmacyAssessments(shop.tenantId);
  const second = await seedFakePharmacyAssessments(shop.tenantId);
  assert.equal(first.created.length, 5);
  assert.equal(second.created.length, 5);
  assert.equal(first.protocolsCreated, 0);
  assert.equal(second.protocolsCreated, 0);

  const concurrent = await Promise.all([
    seedFakePharmacyAssessments(shop.tenantId),
    seedFakePharmacyAssessments(shop.tenantId),
  ]);
  assert.deepEqual(concurrent.map((result) => result.created.length), [5, 5]);

  const assessmentCount = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM bms_pharmacy_assessments
      WHERE tenant_id = $1 AND channel_id = $2`,
    [shop.tenantId, FAKE_PHARMACY_ASSESSMENT_MARKER]
  );
  assert.equal(assessmentCount.rows[0].count, 5, "sequential and concurrent retries must replace, not duplicate, fixtures");

  assert.equal(await deleteFakePharmacyAssessments(shop.tenantId), 5);
  await deleteUnreferencedFakeStaff(shop.tenantId);
  const admin = await query<{ email: string }>(
    `SELECT email FROM users WHERE tenant_id = $1`,
    [shop.tenantId]
  );
  assert.deepEqual(admin.rows.map((row) => row.email), [shop.adminEmail]);
});

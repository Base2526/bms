/** Only on a disposable restored development DB, never production. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { getClient } from "../apps/web/lib/db.ts";
import {
  issueKioskDesktopDevice, kioskDesktopDeviceStatus, manageKioskDesktopDevice,
  validateKioskDesktopBinding, verifyKioskDesktopPin,
} from "../apps/web/lib/bms/restaurantKioskDevices.ts";

test("desktop kiosk device migration reapply, branch binding, RLS and redacted revision", {
  skip: process.env.BMS_KIOSK_RESTORED_DB !== "1" && "requires disposable restored development database",
}, async () => {
  const client = await getClient();
  const source = await readFile(new URL("../db/migrations/10.146__bms_restaurant_kiosk_desktop_devices.sql", import.meta.url), "utf8");
  const id = async (sql: string, args: unknown[]) =>
    (await client.query<{ id: string }>(sql, args)).rows[0].id;
  const reject = async (sql: string, args: unknown[], code: string) => {
    await client.query("SAVEPOINT expected_failure");
    try { await assert.rejects(client.query(sql, args), (error: unknown) =>
      (error as { code?: string }).code === code); }
    finally { await client.query("ROLLBACK TO SAVEPOINT expected_failure"); }
  };
  try {
    await client.query("BEGIN");
    await client.query(source);
    await client.query(source);
    const tag = `fake-kiosk-device-${Date.now()}`;
    const tenant = await id("INSERT INTO bms_tenants(name,slug) VALUES($1,$1) RETURNING id", [tag]);
    const other = await id("INSERT INTO bms_tenants(name,slug) VALUES($1,$1) RETURNING id", [`${tag}-other`]);
    const branch = await id("INSERT INTO bms_locations(tenant_id,code,name,branch_code) VALUES($1,'MAIN',$2,'00000') RETURNING id", [tenant, tag]);
    const otherBranch = await id("INSERT INTO bms_locations(tenant_id,code,name,branch_code) VALUES($1,'MAIN',$2,'00000') RETURNING id", [other, `${tag}-other`]);
    const user = await id(`INSERT INTO users(name,username,email,role,role_id,tenant_id,password_hash,fake_test)
      SELECT $2,$3,$3,'Administrator',r.id,$1,'x',TRUE FROM roles r WHERE r.name='Administrator' LIMIT 1 RETURNING id`,
      [tenant, tag, `${tag}@example.invalid`]);
    const inserted = async (location: string, hash: string) => id(`INSERT INTO bms_restaurant_kiosk_devices
      (tenant_id,location_id,label,credential_hash,created_by) VALUES($1,$2,'pilot',$3,$4) RETURNING id`,
      [tenant, location, hash, user]);
    const device = await inserted(branch, "a".repeat(64));
    const initialPinVersion = (await client.query<{ pin_revision: string }>(
      "SELECT pin_revision FROM bms_restaurant_kiosk_devices WHERE id=$1", [device])).rows[0].pin_revision;
    await reject(`INSERT INTO bms_restaurant_kiosk_devices
      (tenant_id,location_id,label,credential_hash,created_by) VALUES($1,$2,'duplicate',$3,$4)`,
      [tenant, branch, "b".repeat(64), user], "23505");
    await reject(`INSERT INTO bms_restaurant_kiosk_devices
      (tenant_id,location_id,label,credential_hash,created_by) VALUES($1,$2,'foreign',$3,$4)`,
      [tenant, otherBranch, "c".repeat(64), user], "23503");
    await client.query("UPDATE bms_restaurant_kiosk_devices SET pin_hash='slow-hash',pin_set_at=now(),pin_revision=gen_random_uuid() WHERE id=$1", [device]);
    const changedPinVersion = (await client.query<{ pin_revision: string }>(
      "SELECT pin_revision FROM bms_restaurant_kiosk_devices WHERE id=$1", [device])).rows[0].pin_revision;
    assert.notEqual(changedPinVersion, initialPinVersion);
    const revision = await client.query<{ snapshot: Record<string, unknown> }>(
      "SELECT snapshot FROM bms_restaurant_kiosk_devices_revisions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1", [tenant]);
    assert.equal("credential_hash" in revision.rows[0].snapshot, false);
    assert.equal("pin_hash" in revision.rows[0].snapshot, false);
    await client.query("SET LOCAL ROLE bms_app");
    const visible = async () => Number((await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM bms_restaurant_kiosk_devices")).rows[0].n);
    assert.equal(await visible(), 0);
    await client.query("SELECT set_config('bms.kiosk_device_hash',$1,true)", ["a".repeat(64)]);
    assert.equal(await visible(), 1);
    const revisionsWithoutTenant = await client.query("SELECT count(*)::text AS n FROM bms_restaurant_kiosk_devices_revisions");
    assert.equal(Number(revisionsWithoutTenant.rows[0].n), 0);
    await client.query("SELECT set_config('bms.tenant_id',$1,true)", [other]);
    assert.equal(await visible(), 1); // locator remains bound to device hash, never broad tenant access
    await client.query("SELECT set_config('bms.kiosk_device_hash','',true)");
    assert.equal(await visible(), 0);
    await client.query("ROLLBACK");
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(); }
});

test("desktop kiosk PIN/device service serializes attempts and invalidates old credentials", {
  skip: process.env.BMS_KIOSK_RESTORED_DB !== "1" && "requires disposable restored development database",
}, async () => {
  const client = await getClient();
  let tenant = "";
  let user = "";
  try {
    const tag = `fake-kiosk-pin-${randomUUID()}`;
    tenant = (await client.query<{ id: string }>(
      "INSERT INTO bms_tenants(name,slug) VALUES($1,$1) RETURNING id", [tag])).rows[0].id;
    const branch = (await client.query<{ id: string }>(
      "INSERT INTO bms_locations(tenant_id,code,name,branch_code) VALUES($1,'MAIN',$2,'00000') RETURNING id",
      [tenant, tag])).rows[0].id;
    const otherBranch = (await client.query<{ id: string }>(
      "INSERT INTO bms_locations(tenant_id,code,name,branch_code) VALUES($1,'ALT',$2,'00001') RETURNING id",
      [tenant, `${tag}-other`])).rows[0].id;
    user = (await client.query<{ id: string }>(`INSERT INTO users(name,username,email,role,role_id,tenant_id,password_hash,fake_test)
      SELECT $2,$3,$3,'Administrator',r.id,$1,'x',TRUE FROM roles r WHERE r.name='Administrator' LIMIT 1 RETURNING id`,
    [tenant, tag, `${tag}@example.invalid`])).rows[0].id;
    const publicToken = randomBytes(32).toString("base64url");
    await client.query(`INSERT INTO bms_restaurant_kiosks(tenant_id,location_id,token_hash,created_by)
      VALUES($1,$2,$3,$4)`, [tenant, branch, createHash("sha256").update(publicToken).digest("hex"), user]);
    const issued = await issueKioskDesktopDevice({ tenantId: tenant, locationId: branch,
      actorUserId: user, label: "FAKE touch screen" });
    assert.equal((await kioskDesktopDeviceStatus(issued.credential))?.pinConfigured, false);
    await assert.rejects(issueKioskDesktopDevice({ tenantId: tenant, locationId: branch,
      actorUserId: user, label: "duplicate" }), /active|เปิดใช้งาน/);
    await assert.rejects(manageKioskDesktopDevice({ tenantId: tenant, locationId: otherBranch,
      deviceId: issued.deviceId, actorUserId: user, action: "setPin", pin: "123456" }), /ไม่พบเครื่อง/);
    await manageKioskDesktopDevice({ tenantId: tenant, locationId: branch,
      deviceId: issued.deviceId, actorUserId: user, action: "setPin", pin: "123456" });
    const before = await kioskDesktopDeviceStatus(issued.credential);
    assert.equal(before?.pinConfigured, true);
    assert.ok(await validateKioskDesktopBinding(issued.credential, publicToken, before!.pinVersion));
    assert.equal(await validateKioskDesktopBinding(issued.credential, publicToken, randomUUID()), null);
    const attempts = await Promise.all(Array.from({ length: 5 }, () =>
      verifyKioskDesktopPin(issued.credential, "000000")));
    assert.equal(attempts.filter((item) => item.status === "INVALID").length, 4);
    assert.equal(attempts.filter((item) => item.status === "LOCKED").length, 1);
    assert.equal((await verifyKioskDesktopPin(issued.credential, "123456")).status, "LOCKED");
    await manageKioskDesktopDevice({ tenantId: tenant, locationId: branch,
      deviceId: issued.deviceId, actorUserId: user, action: "resetPin", pin: "654321" });
    const after = await kioskDesktopDeviceStatus(issued.credential);
    assert.notEqual(after?.pinVersion, before?.pinVersion);
    assert.equal(await validateKioskDesktopBinding(issued.credential, publicToken, before!.pinVersion), null);
    assert.equal((await verifyKioskDesktopPin(issued.credential, "123456")).status, "INVALID");
    assert.equal((await verifyKioskDesktopPin(issued.credential, "654321")).status, "OK");
    const rotated = await manageKioskDesktopDevice({ tenantId: tenant, locationId: branch,
      deviceId: issued.deviceId, actorUserId: user, action: "rotateCredential" });
    assert.ok(rotated.credential);
    assert.equal(await kioskDesktopDeviceStatus(issued.credential), null);
    assert.ok(await kioskDesktopDeviceStatus(rotated.credential!));
    await manageKioskDesktopDevice({ tenantId: tenant, locationId: branch,
      deviceId: issued.deviceId, actorUserId: user, action: "revoke" });
    assert.equal(await kioskDesktopDeviceStatus(rotated.credential!), null);
    const audit = await client.query<{ meta: unknown }>(
      "SELECT meta FROM bms_audit_log WHERE tenant_id=$1", [tenant]);
    assert.ok(audit.rowCount);
    assert.doesNotMatch(JSON.stringify(audit.rows), /123456|654321|bmsk_/);
  } finally {
    if (tenant) {
      try {
        await client.query("DELETE FROM bms_restaurant_kiosk_devices WHERE tenant_id=$1", [tenant]);
        await client.query("DELETE FROM bms_restaurant_kiosks WHERE tenant_id=$1", [tenant]);
        if (user) await client.query("DELETE FROM users WHERE id=$1", [user]);
        await client.query("DELETE FROM bms_locations WHERE tenant_id=$1", [tenant]);
        await client.query("DELETE FROM bms_tenants WHERE id=$1", [tenant]);
      } finally { client.release(); }
    } else client.release();
  }
});

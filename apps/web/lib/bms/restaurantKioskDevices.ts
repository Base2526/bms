import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { kioskTenantRead } from "./restaurantKioskTenantRead";

const DEVICE_TOKEN = /^bmsk_[A-Za-z0-9_-]{43}$/;
const PUBLIC_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PIN = /^[0-9]{6,8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MINUTES = 15;

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function newCredential() { return `bmsk_${randomBytes(32).toString("base64url")}`; }

export type KioskDesktopDevice = {
  id: string; locationId: string; label: string; active: boolean;
  hasPin: boolean; pinSetAt: string | null; pinLockedUntil: string | null;
  createdAt: string;
};

export async function listKioskDesktopDevices(tenantId: string, locationId: string): Promise<KioskDesktopDevice[]> {
  return kioskTenantRead(tenantId, async (client) => {
    const rows = await client.query<{
      id: string; location_id: string; label: string; active: boolean;
      has_pin: boolean; pin_set_at: string | null; pin_locked_until: string | null; created_at: string;
    }>(`SELECT id, location_id, label, active, pin_hash IS NOT NULL AS has_pin,
               pin_set_at, pin_locked_until, created_at
          FROM bms_restaurant_kiosk_devices
         WHERE tenant_id = $1 AND location_id = $2 ORDER BY created_at DESC LIMIT 20`,
      [tenantId, locationId]);
    return rows.rows.map((row) => ({
      id: row.id, locationId: row.location_id, label: row.label, active: row.active,
      hasPin: row.has_pin, pinSetAt: row.pin_set_at, pinLockedUntil: row.pin_locked_until,
      createdAt: row.created_at,
    }));
  });
}

/** One-time credential for the native main process; never expose it to the guest web page. */
export async function issueKioskDesktopDevice(input: {
  tenantId: string; locationId: string; actorUserId: string; label: string;
}) {
  const label = input.label.trim();
  if (label.length < 1 || label.length > 80) throw new Error("ชื่อเครื่องต้องยาว 1–80 ตัวอักษร");
  const credential = newCredential();
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const location = await client.query(
      `SELECT id FROM bms_locations WHERE tenant_id = $1 AND id = $2 AND active FOR UPDATE`,
      [input.tenantId, input.locationId]);
    if (!location.rowCount) throw new Error("ไม่พบสาขาที่เปิดใช้งาน");
    const existing = await client.query(
      `SELECT id FROM bms_restaurant_kiosk_devices
        WHERE tenant_id = $1 AND location_id = $2 AND active`,
      [input.tenantId, input.locationId]);
    if (existing.rowCount) throw new Error("สาขานี้มีเครื่อง Kiosk ที่เปิดใช้งานแล้ว");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bms_restaurant_kiosk_devices
         (tenant_id, location_id, label, credential_hash, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [input.tenantId, input.locationId, label, digest(credential), input.actorUserId]);
    const deviceId = inserted.rows[0].id;
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'restaurant.kiosk_device.issue',$3,$4::jsonb)`,
      [input.tenantId, input.actorUserId, deviceId, JSON.stringify({ locationId: input.locationId })]);
    await client.query("COMMIT");
    return { deviceId, credential };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function manageKioskDesktopDevice(input: {
  tenantId: string; locationId: string; deviceId: string; actorUserId: string;
  action: "setPin" | "resetPin" | "clearPin" | "rotateCredential" | "revoke"; pin?: string;
}) {
  if (["setPin", "resetPin"].includes(input.action) && !PIN.test(input.pin ?? "")) {
    throw new Error("PIN ดูแลจอต้องเป็นตัวเลข 6–8 หลัก");
  }
  const pinHash = ["setPin", "resetPin"].includes(input.action) ? await bcrypt.hash(input.pin!, 10) : null;
  const credential = input.action === "rotateCredential" ? newCredential() : null;
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const row = await client.query<{ active: boolean; pin_hash: string | null }>(
      `SELECT active, pin_hash FROM bms_restaurant_kiosk_devices
        WHERE tenant_id=$1 AND location_id=$2 AND id=$3 FOR UPDATE`,
      [input.tenantId, input.locationId, input.deviceId]);
    if (!row.rowCount) throw new Error("ไม่พบเครื่อง Kiosk ในสาขานี้");
    if (!row.rows[0].active) throw new Error("เครื่อง Kiosk ถูกเพิกถอนแล้ว");
    if (input.action === "setPin" || input.action === "resetPin") {
      if (row.rows[0].pin_hash && await bcrypt.compare(input.pin!, row.rows[0].pin_hash)) {
        throw new Error("PIN ใหม่ต้องไม่ซ้ำ PIN เดิม");
      }
      await client.query(
        `UPDATE bms_restaurant_kiosk_devices SET pin_hash=$4, pin_set_at=now(), pin_revision=gen_random_uuid(),
            pin_failures=0, pin_locked_until=NULL, updated_at=now()
          WHERE tenant_id=$1 AND location_id=$2 AND id=$3`,
        [input.tenantId, input.locationId, input.deviceId, pinHash]);
    } else if (input.action === "clearPin") {
      await client.query(
        `UPDATE bms_restaurant_kiosk_devices SET pin_hash=NULL, pin_set_at=NULL, pin_revision=gen_random_uuid(),
            pin_failures=0, pin_locked_until=NULL, updated_at=now()
          WHERE tenant_id=$1 AND location_id=$2 AND id=$3`,
        [input.tenantId, input.locationId, input.deviceId]);
    } else if (input.action === "rotateCredential") {
      await client.query(
        `UPDATE bms_restaurant_kiosk_devices SET credential_hash=$4, updated_at=now()
          WHERE tenant_id=$1 AND location_id=$2 AND id=$3`,
        [input.tenantId, input.locationId, input.deviceId, digest(credential!)]);
    } else {
      await client.query(
        `UPDATE bms_restaurant_kiosk_devices SET active=FALSE, revoked_at=now(), updated_at=now()
          WHERE tenant_id=$1 AND location_id=$2 AND id=$3`,
        [input.tenantId, input.locationId, input.deviceId]);
    }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [input.tenantId, input.actorUserId, `restaurant.kiosk_device.${input.action}`,
        input.deviceId, JSON.stringify({ locationId: input.locationId })]);
    await client.query("COMMIT");
    return { credential };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

/** RLS locator reads only an active row matching this device credential. */
async function locateKioskDesktopDevice(credential: string) {
  if (!DEVICE_TOKEN.test(credential)) return null;
  const hash = digest(credential);
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bms_app");
    await client.query("SELECT set_config('bms.kiosk_device_hash', $1, true)", [hash]);
    const result = await client.query<{ id: string; tenant_id: string; location_id: string }>(
      `SELECT id, tenant_id, location_id FROM bms_restaurant_kiosk_devices
        WHERE credential_hash=$1 AND active`, [hash]);
    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function kioskDesktopDeviceStatus(credential: string) {
  const device = await locateKioskDesktopDevice(credential);
  if (!device) return null;
  return kioskTenantRead(device.tenant_id, async (client) => {
    const result = await client.query<{
      id: string; location_id: string; label: string; pin_set_at: string | null; pin_revision: string;
      store_name: string; location_name: string;
    }>(`SELECT d.id, d.location_id, d.label, d.pin_set_at, d.pin_revision,
               t.name AS store_name, l.name AS location_name
          FROM bms_restaurant_kiosk_devices d
          JOIN bms_locations l ON l.tenant_id=d.tenant_id AND l.id=d.location_id AND l.active
          JOIN bms_tenants t ON t.id=d.tenant_id
         WHERE d.tenant_id=$1 AND d.id=$2 AND d.active AND d.credential_hash=$3`,
      [device.tenant_id, device.id, digest(credential)]);
    const row = result.rows[0];
    return row ? {
      deviceId: row.id, locationId: row.location_id, label: row.label,
      pinConfigured: Boolean(row.pin_set_at), pinSetAt: row.pin_set_at, pinVersion: row.pin_revision,
      storeName: row.store_name, locationName: row.location_name,
    } : null;
  });
}

/** Server-side branch binding; two locations may have the same display name. */
export async function validateKioskDesktopBinding(credential: string, publicToken: string, pinVersion: string) {
  const device = await locateKioskDesktopDevice(credential);
  if (!device || !PUBLIC_TOKEN.test(publicToken) || !UUID.test(pinVersion)) return null;
  return kioskTenantRead(device.tenant_id, async (client) => {
    const result = await client.query<{
      store_name: string; location_name: string; kiosk_location_id: string | null;
      pin_configured: boolean; pin_revision: string;
    }>(`SELECT t.name AS store_name, l.name AS location_name,
                d.pin_hash IS NOT NULL AS pin_configured, d.pin_revision,
                k.location_id AS kiosk_location_id
         FROM bms_restaurant_kiosk_devices d
         JOIN bms_locations l ON l.tenant_id=d.tenant_id AND l.id=d.location_id AND l.active
         JOIN bms_tenants t ON t.id=d.tenant_id
         LEFT JOIN bms_restaurant_kiosks k
           ON k.tenant_id=d.tenant_id AND k.token_hash=$5 AND k.active
        WHERE d.tenant_id=$1 AND d.id=$2 AND d.active AND d.credential_hash=$3
          AND d.location_id=$4`,
      [device.tenant_id, device.id, digest(credential), device.location_id, digest(publicToken)]);
    const row = result.rows[0];
    if (!row) return null;
    if (!row.pin_configured) return { status: "NO_PIN" as const };
    if (row.pin_revision !== pinVersion.toLowerCase()) return { status: "PIN_CHANGED" as const };
    if (!row.kiosk_location_id) return { status: "URL_UNAVAILABLE" as const };
    if (row.kiosk_location_id !== device.location_id) return { status: "WRONG_BRANCH" as const };
    return { status: "OK" as const, storeName: row.store_name, locationName: row.location_name };
  });
}

export async function verifyKioskDesktopPin(credential: string, pin: string) {
  const device = await locateKioskDesktopDevice(credential);
  if (!device) return { status: "UNAUTHORIZED" as const };
  const client = await getClient();
  try {
    await beginTenantTx(client, device.tenant_id);
    const result = await client.query<{
      pin_hash: string | null; pin_failures: number; pin_locked: boolean; pin_revision: string;
    }>(`SELECT pin_hash, pin_failures, pin_locked_until > now() AS pin_locked, pin_revision
          FROM bms_restaurant_kiosk_devices
         WHERE tenant_id=$1 AND id=$2 AND active AND credential_hash=$3 FOR UPDATE`,
      [device.tenant_id, device.id, digest(credential)]);
    const row = result.rows[0];
    if (!row) { await client.query("ROLLBACK"); return { status: "UNAUTHORIZED" as const }; }
    if (!row.pin_hash) { await client.query("COMMIT"); return { status: "NO_PIN" as const }; }
    if (row.pin_locked) {
      await client.query("COMMIT"); return { status: "LOCKED" as const };
    }
    const valid = PIN.test(pin) && await bcrypt.compare(pin, row.pin_hash);
    if (!valid) {
      const failures = row.pin_failures + 1;
      await client.query(
        `UPDATE bms_restaurant_kiosk_devices
            SET pin_failures=$3, pin_locked_until=CASE WHEN $3 >= $4
                THEN now() + ($5::int * interval '1 minute') ELSE NULL END, updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [device.tenant_id, device.id, failures, PIN_MAX_FAILURES, PIN_LOCK_MINUTES]);
      if (failures === PIN_MAX_FAILURES) await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'restaurant.kiosk_device.pin_locked',$3,'{}'::jsonb)`,
        [device.tenant_id, `kiosk-device:${device.id}`, device.id]);
      await client.query("COMMIT");
      return { status: failures >= PIN_MAX_FAILURES ? "LOCKED" as const : "INVALID" as const };
    }
    await client.query(
      `UPDATE bms_restaurant_kiosk_devices SET pin_failures=0, pin_locked_until=NULL,
          updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [device.tenant_id, device.id]);
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'restaurant.kiosk_device.pin_unlock',$3,'{}'::jsonb)`,
      [device.tenant_id, `kiosk-device:${device.id}`, device.id]);
    await client.query("COMMIT");
    return { status: "OK" as const, pinVersion: row.pin_revision };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

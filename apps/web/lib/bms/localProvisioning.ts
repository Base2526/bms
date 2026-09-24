import crypto from "crypto";

import bcrypt from "bcryptjs";

import { getClient } from "@/lib/db";
import { normalizeEmail, validateEmail, validateNewPassword } from "@/lib/auth/identity";
import { isPosPinValid } from "@pos-core/posPin";
import { DEFAULT_TENANT_ID } from "./tenant";

export type RetailLocalProvisionInput = {
  shopName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  adminPin: string;
};

export type RetailLocalProvisionResult = {
  status: "PROVISIONED" | "ALREADY_PROVISIONED";
  tenantId: string;
  adminUserId: string;
  deviceId: string;
  deviceToken: string | null;
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

export async function provisionRetailLocal(
  input: RetailLocalProvisionInput
): Promise<RetailLocalProvisionResult> {
  if (process.env.BMS_DEPLOYMENT_MODE !== "retail-local") {
    throw new Error("Retail Local provisioning is disabled outside BMS_DEPLOYMENT_MODE=retail-local");
  }

  const shopName = input.shopName.trim();
  const adminName = input.adminName.trim();
  const slug = normalizeSlug(input.slug);
  const emailResult = validateEmail(input.adminEmail);
  const passwordResult = validateNewPassword(input.adminPassword);
  const adminPin = input.adminPin.trim();
  if (!shopName || shopName.length > 120) throw new Error("Shop name must be 1-120 characters");
  if (!adminName || adminName.length > 120) throw new Error("Administrator name must be 1-120 characters");
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw new Error("Slug must contain 3-40 lowercase letters, numbers, or hyphens");
  if (!emailResult.ok) throw new Error(`Invalid administrator email (${emailResult.code})`);
  if (!passwordResult.ok) throw new Error(`Invalid administrator password (${passwordResult.code})`);
  if (!isPosPinValid(adminPin)) throw new Error("Administrator PIN must be 4-8 digits");

  const adminEmail = normalizeEmail(emailResult.value);
  const [passwordHash, pinHash] = await Promise.all([
    bcrypt.hash(passwordResult.value, 10),
    bcrypt.hash(adminPin, 10),
  ]);
  const deviceToken = `pos_${crypto.randomBytes(32).toString("base64url")}`;

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('bms-retail-local-provision'))");

    const installed = await client.query<{
      tenant_id: string;
      admin_user_id: string;
      pos_device_id: string;
    }>(
      `SELECT tenant_id, admin_user_id, pos_device_id
         FROM bms_local_installation WHERE singleton = TRUE FOR UPDATE`
    );
    if (installed.rows[0]) {
      await client.query("COMMIT");
      return {
        status: "ALREADY_PROVISIONED",
        tenantId: installed.rows[0].tenant_id,
        adminUserId: installed.rows[0].admin_user_id,
        deviceId: installed.rows[0].pos_device_id,
        deviceToken: null,
      };
    }

    const identityExists = await client.query(
      `SELECT 1 FROM users WHERE lower(btrim(email)) = $1 LIMIT 1`,
      [adminEmail]
    );
    if (identityExists.rowCount) throw new Error("Administrator email is already in use");

    const tenant = await client.query<{ id: string }>(
      `INSERT INTO bms_tenants(name, slug, plan) VALUES ($1, $2, 'business') RETURNING id`,
      [shopName, slug]
    );
    const tenantId = tenant.rows[0].id;
    await client.query(
      `INSERT INTO bms_role_permissions(tenant_id, role_id, permission)
       SELECT $1, role_id, permission FROM bms_role_permissions WHERE tenant_id = $2
       ON CONFLICT DO NOTHING`,
      [tenantId, DEFAULT_TENANT_ID]
    );
    await client.query(
      `INSERT INTO bms_store_profile(tenant_id, business_type, business_archetype)
       VALUES ($1, 'general', 'mini_mart')`,
      [tenantId]
    );
    const location = await client.query<{ id: string }>(
      `INSERT INTO bms_locations(tenant_id, code, name, branch_code, is_head_office)
       VALUES ($1, 'MAIN', $2, '00000', TRUE) RETURNING id`,
      [tenantId, `${shopName} สาขาหลัก`]
    );
    const role = await client.query<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'Administrator' AND is_active LIMIT 1`
    );
    if (!role.rows[0]) throw new Error("Administrator role is missing after migrations");
    const admin = await client.query<{ id: string }>(
      `INSERT INTO users
         (name, username, email, role, role_id, tenant_id, password_hash,
          is_email_verified, language, pos_pin_hash, pos_pin_set_at)
       VALUES ($1, $2, $2, 'Administrator', $3, $4, $5, TRUE, 'th', $6, now())
       RETURNING id`,
      [adminName, adminEmail, role.rows[0].id, tenantId, passwordHash, pinHash]
    );
    const device = await client.query<{ id: string }>(
      `INSERT INTO bms_pos_devices
         (tenant_id, location_id, code, name, receipt_prefix, token_hash, token_issued_at)
       VALUES ($1, $2, 'POS-01', 'เครื่องขายหลัก', 'POS01', $3, now())
       RETURNING id`,
      [tenantId, location.rows[0].id, hashToken(deviceToken)]
    );
    await client.query(
      `INSERT INTO bms_local_installation
         (singleton, deployment_mode, tenant_id, admin_user_id, pos_device_id)
       VALUES (TRUE, 'retail-local', $1, $2, $3)`,
      [tenantId, admin.rows[0].id, device.rows[0].id]
    );
    await client.query(
      `INSERT INTO bms_audit_log(tenant_id, actor, action, target, meta)
       VALUES ($1, $2, 'retail_local.provision', $3, $4::jsonb)`,
      [tenantId, adminEmail, tenantId, JSON.stringify({ locationCode: "MAIN", deviceCode: "POS-01" })]
    );
    await client.query("COMMIT");
    return {
      status: "PROVISIONED",
      tenantId,
      adminUserId: admin.rows[0].id,
      deviceId: device.rows[0].id,
      deviceToken,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}


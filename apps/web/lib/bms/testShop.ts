// apps/web/lib/bms/testShop.ts
// =============================================================
// สร้างร้านทดสอบทั้งร้านในคลิกเดียว — สำหรับ platform admin ใช้ QA/demo
// (ดู lib/bms/signup.ts ที่ทำแบบเดียวกันสำหรับ self-serve signup จริง)
//
// slug การันตีขึ้นต้น "test-" เสมอ (nanoid ต่อท้าย ไม่ derive จากชื่อร้านที่ผู้ใช้พิมพ์)
// เพื่อให้ deleteTenant()/ปุ่มลบใน /admin/tenants ใช้ได้กับร้านนี้ได้ทันทีโดยไม่ต้อง validate ซ้ำ
// =============================================================

import bcrypt from "bcryptjs";
import { getClient } from "@/lib/db";
import { customAlphabet, nanoid } from "nanoid";
import { DEFAULT_TENANT_ID } from "./tenant";
import { archetypeToBusinessType, normalizeShopArchetype, type ShopArchetype } from "./shopArchetypes";
import { DEFAULT_LOCATION_CODE } from "./locations";
import { ensureFakePharmacyProtocolsInTx } from "./devPharmacySeed";
import { enforceUserQuota, requireCapacityForUpsert } from "./entitlements";

export type ProvisionTestShopResult = {
  tenantId: string;
  slug: string;
  name: string;
  adminEmail: string;
  adminPassword: string;
  planCode: string;
};

type ProvisionShopOpts = {
  name?: string;
  businessArchetype?: ShopArchetype | null;
  slug?: string;
  adminEmail?: string;
  adminPassword?: string;
  planCode?: string;
  generatedBy?: string | number;
};

const safeSlugSuffix = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

async function provisionShopWithIdentity(opts: ProvisionShopOpts = {}): Promise<ProvisionTestShopResult> {
  const suffix = safeSlugSuffix();
  const slug = opts.slug?.trim().toLowerCase() || `test-${suffix}`;
  const name = opts.name?.trim() || `ร้านทดสอบ ${suffix}`;
  const businessArchetype = normalizeShopArchetype(opts.businessArchetype);
  const businessType = archetypeToBusinessType(businessArchetype);
  const adminEmail = opts.adminEmail?.trim().toLowerCase() || `admin+${suffix}@test.bms.local`;
  const adminPassword = opts.adminPassword || nanoid(12);
  if (opts.planCode != null && (typeof opts.planCode !== "string" || !opts.planCode.trim())) {
    throw new Error("Unknown package");
  }

  if (!/^[a-z0-9-]{3,120}$/.test(slug)) {
    throw new Error("slug ร้านไม่ถูกต้อง");
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const planCode = opts.planCode ?? "free";
    const plan = await client.query(`SELECT code FROM bms_plans WHERE code = $1 FOR SHARE`, [planCode]);
    if (!plan.rowCount) throw new Error("Unknown package");

    const dupTenant = await client.query<{ id: string }>(
      `SELECT id FROM bms_tenants WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    if (dupTenant.rowCount) {
      throw new Error(`slug "${slug}" ถูกใช้แล้ว`);
    }

    const dupUser = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [adminEmail]
    );
    if (dupUser.rowCount) {
      throw new Error(`email "${adminEmail}" ถูกใช้แล้ว`);
    }

    const t = await client.query<{ id: string }>(
      `INSERT INTO bms_tenants (name, slug, plan) VALUES ($1, $2, $3) RETURNING id`,
      [name, slug, planCode]
    );
    const tenantId = t.rows[0].id;
    // Provisioning needs the privileged connection for users/role copies, but
    // tenant-owned writes and their triggers still receive a server-owned scope.
    await client.query(`SELECT set_config('bms.tenant_id', $1, true)`, [tenantId]);
    await requireCapacityForUpsert(tenantId, "branches", DEFAULT_LOCATION_CODE, client);
    await enforceUserQuota(tenantId, client);
    await client.query(
      `INSERT INTO bms_store_profile (tenant_id, business_type, business_archetype)
       VALUES ($1, $2, $3)`,
      [tenantId, businessType, businessArchetype]
    );
    await client.query(
      `INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office)
       VALUES ($1, $2, $3, '00000', TRUE)`,
      [tenantId, DEFAULT_LOCATION_CODE, `${name} สาขาหลัก`]
    );

    await client.query(
      `INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
       SELECT $1, role_id, permission FROM bms_role_permissions
        WHERE tenant_id = $2
       ON CONFLICT DO NOTHING`,
      [tenantId, DEFAULT_TENANT_ID]
    );

    const roleRes = await client.query<{ id: string }>(`SELECT id FROM roles WHERE name = 'Administrator'`);
    const roleId = roleRes.rows[0]?.id ?? null;

    const hash = await bcrypt.hash(adminPassword, 10);
    await client.query(
      `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash, fake_test)
       VALUES ($1, $2, $3, 'Administrator', $4, $5, $6, true)`,
      [`Admin ${slug}`, adminEmail, adminEmail, roleId, tenantId, hash]
    );

    if (businessArchetype === "pharmacy") {
      await ensureFakePharmacyProtocolsInTx(client, tenantId);
    }

    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, $2, 'dev.fake.shop.provision', $3, $4::jsonb)`,
      [tenantId, opts.generatedBy == null ? null : String(opts.generatedBy), tenantId, JSON.stringify({ planCode, slug })]
    );

    await client.query("COMMIT");
    return { tenantId, slug, name, adminEmail, adminPassword, planCode };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function provisionTestShop(opts: { name?: string; businessArchetype?: ShopArchetype | null; planCode?: string; generatedBy?: string | number } = {}): Promise<ProvisionTestShopResult> {
  const suffix = safeSlugSuffix();
  return provisionShopWithIdentity({
    ...opts,
    slug: `test-${suffix}`,
    adminEmail: `admin+${suffix}@test.bms.local`,
  });
}

export async function provisionDemoShop(opts: {
  name: string;
  slug: string;
  businessArchetype: ShopArchetype;
  planCode?: string;
  generatedBy?: string | number;
}): Promise<ProvisionTestShopResult> {
  return provisionShopWithIdentity({
    ...opts,
    adminEmail: `admin+${opts.slug}@demo.bms.local`,
  });
}

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
import { nanoid } from "nanoid";
import { DEFAULT_TENANT_ID } from "./tenant";

export type ProvisionTestShopResult = {
  tenantId: string;
  slug: string;
  name: string;
  adminEmail: string;
  adminPassword: string;
};

export async function provisionTestShop(opts: { name?: string } = {}): Promise<ProvisionTestShopResult> {
  const suffix = nanoid(8).toLowerCase();
  const slug = `test-${suffix}`;
  const name = opts.name?.trim() || `ร้านทดสอบ ${suffix}`;
  const adminEmail = `admin+${suffix}@test.bms.local`;
  const adminPassword = nanoid(12);

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const t = await client.query<{ id: string }>(
      `INSERT INTO bms_tenants (name, slug, plan) VALUES ($1, $2, 'free') RETURNING id`,
      [name, slug]
    );
    const tenantId = t.rows[0].id;

    // seed สิทธิ์ role ของร้านใหม่ (คัดลอก template จาก default tenant) — เหมือน signupShop()
    // ไม่ทำแบบนี้ = ร้านใหม่จะไม่มีแถวใน bms_role_permissions เลย → ทุก requirePermission() ของ role
    // ที่ไม่ใช่ Administrator จะ 403 หมดตั้งแต่แรก (Administrator เป็น super ในโค้ด ไม่ผ่านตารางนี้)
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
      [`Admin ${suffix}`, adminEmail, adminEmail, roleId, tenantId, hash]
    );

    await client.query("COMMIT");
    return { tenantId, slug, name, adminEmail, adminPassword };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

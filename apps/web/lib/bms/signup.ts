// =============================================================
// BMS SaaS — self-serve signup (สร้างร้าน + เจ้าของร้าน)
// -------------------------------------------------------------
// สร้าง tenant (plan free) + user เจ้าของร้าน (role Manager) ในทรานแซกชันเดียว
// role Manager = จัดการร้านได้ครบ แต่ไม่ใช่ super (แก้ RBAC ทั้งระบบไม่ได้)
// =============================================================

import bcrypt from "bcryptjs";
import { getClient } from "@/lib/db";

function slugify(name: string): string {
  const base = name.trim().toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "shop";
  return base;
}

export type SignupInput = { shopName: string; name?: string; email: string; password: string };
export type SignupResult =
  | { status: "OK"; tenantId: string; slug: string }
  | { status: "EMAIL_TAKEN" }
  | { status: "INVALID" };

export async function signupShop(input: SignupInput): Promise<SignupResult> {
  const shopName = input.shopName?.trim();
  const email = input.email?.trim().toLowerCase();
  const password = input.password ?? "";
  if (!shopName || !email || password.length < 6) return { status: "INVALID" };

  const client = await getClient();
  try {
    await client.query("BEGIN");

    // email ต้องไม่ซ้ำ
    const exists = await client.query(`SELECT 1 FROM users WHERE lower(email) = $1`, [email]);
    if (exists.rowCount) {
      await client.query("ROLLBACK");
      return { status: "EMAIL_TAKEN" };
    }

    // slug ไม่ซ้ำ (ต่อท้ายเลขถ้าชน)
    let slug = slugify(shopName);
    for (let n = 0; n < 50; n++) {
      const s = n === 0 ? slug : `${slug}-${n}`;
      const dup = await client.query(`SELECT 1 FROM bms_tenants WHERE slug = $1`, [s]);
      if (dup.rowCount === 0) { slug = s; break; }
    }

    const t = await client.query<{ id: string }>(
      `INSERT INTO bms_tenants (name, slug, plan) VALUES ($1, $2, 'free') RETURNING id`,
      [shopName, slug]
    );
    const tenantId = t.rows[0].id;

    const roleRes = await client.query<{ id: string }>(`SELECT id FROM roles WHERE name = 'Manager'`);
    const roleId = roleRes.rows[0]?.id ?? null;

    const hash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash)
       VALUES ($1, $2, $3, 'Manager', $4, $5, $6)`,
      [input.name?.trim() || shopName, email, email, roleId, tenantId, hash]
    );

    await client.query("COMMIT");
    return { status: "OK", tenantId, slug };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

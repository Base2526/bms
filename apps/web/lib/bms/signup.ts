// =============================================================
// BMS SaaS — self-serve signup (สร้างร้าน + เจ้าของร้าน)
// -------------------------------------------------------------
// เก็บคำขอไว้ก่อน แล้วสร้าง tenant + owner ในทรานแซกชันเดียวหลังยืนยันอีเมล
// role Manager = จัดการร้านได้ครบ แต่ไม่ใช่ super (แก้ RBAC ทั้งระบบไม่ได้)
// =============================================================

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getClient } from "@/lib/db";
import { getLatestEmailTemplate, renderEmailTemplate } from "@/lib/emailTemplates";
import { sendEmail } from "@/lib/mailer";

function slugify(name: string): string {
  const base = name.trim().toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "shop";
  return base;
}

export type SignupInput = { shopName: string; name?: string; email: string; password: string };
export type SignupResult =
  | { status: "PENDING_VERIFICATION" }
  | { status: "EMAIL_TAKEN" }
  | { status: "INVALID" };

export type VerifyShopSignupResult =
  | { status: "VERIFIED"; tenantId: string; slug: string }
  | { status: "INVALID_OR_EXPIRED" }
  | { status: "EMAIL_TAKEN" };

const VERIFY_EXPIRY_MINUTES = 30;

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function signupShop(input: SignupInput): Promise<SignupResult> {
  const shopName = input.shopName?.trim();
  const email = input.email?.trim().toLowerCase();
  const password = input.password ?? "";
  const ownerName = input.name?.trim() || null;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
  if (
    !shopName || shopName.length > 120 || !email || email.length > 254 || !validEmail ||
    password.length < 6 || password.length > 128 || (ownerName?.length ?? 0) > 120
  ) return { status: "INVALID" };

  const rawToken = crypto.randomBytes(32).toString("hex");
  const hash = await bcrypt.hash(password, 10);
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const exists = await client.query(`SELECT 1 FROM users WHERE lower(email) = $1`, [email]);
    if (exists.rowCount) {
      await client.query("ROLLBACK");
      return { status: "EMAIL_TAKEN" };
    }

    await client.query(
      `INSERT INTO bms_pending_shop_signups
         (email, shop_name, owner_name, password_hash, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 * interval '1 minute'))`,
      [email, shopName, ownerName, hash, tokenHash(rawToken), VERIFY_EXPIRY_MINUTES]
    );

    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl) throw new Error("Missing NEXT_PUBLIC_BASE_URL");
  const tpl = await getLatestEmailTemplate("auth.shop_verify", "th");
  const verifyUrl = `${baseUrl.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(rawToken)}`;
  const rendered = renderEmailTemplate(tpl, {
    user_name: ownerName || shopName,
    shop_name: shopName,
    verify_url: verifyUrl,
    expiry_minutes: VERIFY_EXPIRY_MINUTES,
  });
  await sendEmail({ to: email, ...rendered }, { category: "auth", triggeredBy: "signup:verify-email" });
  return { status: "PENDING_VERIFICATION" };
}

export async function verifyPendingShopSignup(rawToken: string): Promise<VerifyShopSignupResult> {
  if (!rawToken || rawToken.length > 256) return { status: "INVALID_OR_EXPIRED" };

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const pendingResult = await client.query<{
      id: string; email: string; shop_name: string; owner_name: string | null; password_hash: string;
    }>(
      `SELECT id, email, shop_name, owner_name, password_hash
         FROM bms_pending_shop_signups
        WHERE token_hash = $1 AND verified_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [tokenHash(rawToken)]
    );
    const pending = pendingResult.rows[0];
    if (!pending) {
      await client.query("ROLLBACK");
      return { status: "INVALID_OR_EXPIRED" };
    }

    // Serialize different valid tokens for the same email so only one can create an account.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext(lower($1)))`, [pending.email]);
    const exists = await client.query(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [pending.email]);
    if (exists.rowCount) {
      await client.query(
        `UPDATE bms_pending_shop_signups SET verified_at = now(), updated_at = now() WHERE id = $1`,
        [pending.id]
      );
      await client.query("COMMIT");
      return { status: "EMAIL_TAKEN" };
    }

    const baseSlug = slugify(pending.shop_name);
    let tenantId = "";
    let slug = "";
    for (let n = 0; n < 100; n++) {
      const candidate = n === 0 ? baseSlug : `${baseSlug}-${n}`;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO bms_tenants (name, slug, plan)
         VALUES ($1, $2, 'free') ON CONFLICT (slug) DO NOTHING RETURNING id`,
        [pending.shop_name, candidate]
      );
      if (inserted.rows[0]) {
        tenantId = inserted.rows[0].id;
        slug = candidate;
        break;
      }
    }
    if (!tenantId) throw new Error("Unable to allocate a unique shop slug");

    const roleRes = await client.query<{ id: string }>(`SELECT id FROM roles WHERE name = 'Manager'`);
    const roleId = roleRes.rows[0]?.id ?? null;
    await client.query(
      `INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
       SELECT $1, role_id, permission FROM bms_role_permissions
        WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
       ON CONFLICT DO NOTHING`,
      [tenantId]
    );
    await client.query(
      `INSERT INTO users
         (name, username, email, role, role_id, tenant_id, password_hash, is_email_verified)
       VALUES ($1, $2, $2, 'Manager', $3, $4, $5, TRUE)`,
      [pending.owner_name || pending.shop_name, pending.email, roleId, tenantId, pending.password_hash]
    );
    await client.query(
      `UPDATE bms_pending_shop_signups
          SET verified_at = now(), tenant_id = $2, updated_at = now()
        WHERE id = $1`,
      [pending.id, tenantId]
    );
    await client.query(
      `UPDATE bms_pending_shop_signups
          SET verified_at = now(), updated_at = now()
        WHERE lower(email) = lower($1) AND verified_at IS NULL AND id <> $2`,
      [pending.email, pending.id]
    );
    await client.query("COMMIT");
    return { status: "VERIFIED", tenantId, slug };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

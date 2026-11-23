// apps/web/lib/dev-guards.ts
import { NextRequest } from "next/server";
import { verifyAdminSession } from "@/lib/auth/server";
import type { JWTPayload } from "@/lib/auth/token";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { query } from "@/lib/db";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
// import { verifyInternal } from "@/lib/internal-verify"; // HMAC verify

export async function requireAdminOrInternal(req: NextRequest) {
  // server-side cookie check (Next.js server handler)
  const admin = await verifyAdminSession();
  if (admin) return { ok: true, actor: admin };

  // หรือถ้ามี internal signature (cron/worker)
  // Note: verifyInternal ต้องการ body text; ตัวอย่างที่ใช้ใน route จะเรียก verifyInternal(req, bodyText)
  return { ok: false, reason: "not admin or internal" };
}

/**
 * gate สำหรับ fake-data seeder โดยเฉพาะ — เข้มกว่า `requireAdminOrInternal()`
 *
 * ทำไมต้องแยกตัวใหม่ ไม่แก้ `requireAdminOrInternal()` ตรง ๆ: helper เดิมเป็นตัวอย่างเก่า
 * ส่วน route อัปโหลดไฟล์จริงใช้ `authorizeAdminRoute()` กับสิทธิ์ product.edit หรือ
 * inbox.reply ของตนเอง จึงไม่ควรผูกกฎ platform admin ของ seeder เข้ากับไฟล์ลูกค้า
 *
 * Seeder สร้าง/ลบข้อมูลจำนวนมาก จึงใช้ด่านเดียวกับ platform-admin REST routes:
 * ตรวจ session ที่ยัง active, refresh role/session version จากฐานข้อมูล, และยืนยัน
 * is_platform_admin ปัจจุบันก่อนทุกคำขอ รวมถึงเมื่อเปิด seeder ใน production โดยตั้งใจ
 */
export async function requirePlatformAdminSeeder(): Promise<
  { ok: true; actor: JWTPayload } | { ok: false; reason: string }
> {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return { ok: false, reason: auth.status === 401 ? "not admin" : "platform admin required" };
  return { ok: true, actor: auth.admin };
}

/**
 * fake-data seeder เปิดใช้ได้ไหม
 * - dev/staging (NODE_ENV != production) → เปิดเสมอ
 * - production → ปิด default เพื่อความปลอดภัย · เปิดได้เฉพาะตั้ง env `BMS_ALLOW_FAKE_SEED=1`
 *   และยังต้องผ่าน platform-admin guard (เช่นเครื่อง demo ที่ผู้ดูแลแพลตฟอร์มเตรียมข้อมูล)
 */
export function fakeSeedDisabled(): boolean {
  return process.env.NODE_ENV === "production" && process.env.BMS_ALLOW_FAKE_SEED !== "1";
}

export async function resolveExistingTenantId(rawTenantId: unknown, fallbackTenantId?: string | null): Promise<string> {
  const tenantId =
    typeof rawTenantId === "string" && rawTenantId.trim()
      ? rawTenantId.trim()
      : (fallbackTenantId && fallbackTenantId.trim()) || DEFAULT_TENANT_ID;

  const r = await query<{ id: string }>(`SELECT id FROM bms_tenants WHERE id = $1`, [tenantId]);
  if (!r.rowCount) {
    throw new Error("ไม่พบร้านที่เลือก");
  }
  return tenantId;
}

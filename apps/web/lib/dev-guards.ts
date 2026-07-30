// apps/web/lib/dev-guards.ts
import { NextRequest } from "next/server";
import { verifyAdminSession } from "@/lib/auth/server"; // จากที่เราเคยทำ
import type { JWTPayload } from "@/lib/auth/token";
import { query } from "@/lib/db";
// import { verifyInternal } from "@/lib/internal-verify"; // HMAC verify

export function requireAdminOrInternal(req: NextRequest) {
  // server-side cookie check (Next.js server handler)
  const admin = verifyAdminSession();
  if (admin) return { ok: true, actor: admin };

  // หรือถ้ามี internal signature (cron/worker)
  // Note: verifyInternal ต้องการ body text; ตัวอย่างที่ใช้ใน route จะเรียก verifyInternal(req, bodyText)
  return { ok: false, reason: "not admin or internal" };
}

/**
 * gate สำหรับ fake-data seeder โดยเฉพาะ — เข้มกว่า `requireAdminOrInternal()`
 *
 * ทำไมต้องแยกตัวใหม่ ไม่แก้ `requireAdminOrInternal()` ตรง ๆ: ฟังก์ชันนั้นถูกใช้โดย route
 * อัปโหลดไฟล์จริงด้วย (`api/bms/products/upload`, `api/bms/inbox/upload`) ซึ่ง staff ทั่วไป
 * ต้องใช้ได้ — ถ้าไปยกระดับตรงนั้นจะทำให้อัปรูปสินค้า/แชทพังทันที
 *
 * seeder สร้าง/ลบข้อมูลจำนวนมาก (และต่อไปจะสร้าง/ลบ tenant ได้) = platform-level action
 * ไม่ใช่แค่ "ล็อกอินแล้ว" · JWT ไม่ได้พก `is_platform_admin` จึงต้องอ่านจาก DB ทุกครั้ง
 * · fail closed ถ้า query ไม่ได้ (เช่น migration `5.6` ยังไม่ apply) — pattern เดียวกับ
 * `requirePlatformAdminPage()` ใน `lib/auth/platform-page.ts`
 */
export async function requirePlatformAdminSeeder(): Promise<
  { ok: true; actor: JWTPayload } | { ok: false; reason: string }
> {
  const admin = verifyAdminSession();
  if (!admin) return { ok: false, reason: "not admin" };
  try {
    const r = await query<{ is_platform_admin: boolean }>(
      `SELECT is_platform_admin FROM users WHERE id = $1`,
      [admin.id]
    );
    if (r.rows[0]?.is_platform_admin !== true) {
      return { ok: false, reason: "platform admin required" };
    }
  } catch {
    return { ok: false, reason: "platform admin check unavailable" };
  }
  return { ok: true, actor: admin };
}

/**
 * fake-data seeder เปิดใช้ได้ไหม
 * - dev/staging (NODE_ENV != production) → เปิดเสมอ
 * - production → ปิด default เพื่อความปลอดภัย · เปิดได้เฉพาะตั้ง env `BMS_ALLOW_FAKE_SEED=1`
 *   (ใช้กับเครื่อง demo ที่อยากให้ร้านค้าเทส seed ในมุมตัวเองได้)
 */
export function fakeSeedDisabled(): boolean {
  return process.env.NODE_ENV === "production" && process.env.BMS_ALLOW_FAKE_SEED !== "1";
}

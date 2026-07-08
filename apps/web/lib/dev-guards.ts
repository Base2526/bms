// apps/web/lib/dev-guards.ts
import { NextRequest } from "next/server";
import { verifyAdminSession } from "@/lib/auth/server"; // จากที่เราเคยทำ
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
 * fake-data seeder เปิดใช้ได้ไหม
 * - dev/staging (NODE_ENV != production) → เปิดเสมอ
 * - production → ปิด default เพื่อความปลอดภัย · เปิดได้เฉพาะตั้ง env `BMS_ALLOW_FAKE_SEED=1`
 *   (ใช้กับเครื่อง demo ที่อยากให้ร้านค้าเทส seed ในมุมตัวเองได้)
 */
export function fakeSeedDisabled(): boolean {
  return process.env.NODE_ENV === "production" && process.env.BMS_ALLOW_FAKE_SEED !== "1";
}

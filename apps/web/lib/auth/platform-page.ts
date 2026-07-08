import "server-only";
import { redirect } from "next/navigation";
import { verifyAdminSession } from "@/lib/auth/server";
import { query } from "@/lib/db";

// Gate หน้า admin ระดับแพลตฟอร์ม (ENV/Logs/Posts/Files/Queue/Architecture) ให้เฉพาะ platform admin
// เรียกใน layout.tsx (server component) ของแต่ละโฟลเดอร์
// middleware กันแค่ "ต้องล็อกอิน" — ตัวนี้กัน "ต้องเป็น platform admin" อีกชั้น
export async function requirePlatformAdminPage() {
  const admin = verifyAdminSession();
  if (!admin) redirect("/admin/login");
  let ok = false;
  try {
    const r = await query<{ is_platform_admin: boolean }>(
      `SELECT is_platform_admin FROM users WHERE id = $1`,
      [admin.id]
    );
    ok = r.rows[0]?.is_platform_admin === true;
  } catch {
    ok = false; // 5.6 ยังไม่ apply / column ไม่มี → ปฏิเสธไว้ก่อน
  }
  if (!ok) redirect("/admin/dashboard");
}

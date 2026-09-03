import "server-only";
import { redirect } from "next/navigation";
import { verifyAdminSession } from "@/lib/auth/server";
import { query } from "@/lib/db";

// Gate หน้าเครื่องมือระดับผู้ดูแลร้าน:
// Administrator ของร้านเข้าได้ และ platform admin เข้าได้ตอน drill-down/ดูแลระบบ.
export async function requireTenantAdministratorPage() {
  const admin = verifyAdminSession();
  if (!admin) redirect("/admin/login");

  let ok = false;
  try {
    const r = await query<{ role: string; is_platform_admin: boolean }>(
      `SELECT role, is_platform_admin FROM users WHERE id = $1`,
      [admin.id]
    );
    const user = r.rows[0];
    ok = user?.role === "Administrator" || user?.is_platform_admin === true;
  } catch {
    ok = false;
  }

  // ⚠️ ส่งไป /admin ไม่ใช่ /admin/dashboard — dashboard อ่านด้วยสิทธิ์ report.view ซึ่ง role
  // คลัง/แคตาล็อกไม่มี การ redirect ตายตัวจึงพาไปเจอการ์ด "ไม่มีสิทธิ์" · /admin เลือกปลายทาง
  // จากนิยามเมนู (firstAdminDestination) ให้ได้หน้าที่บัญชีนั้นเปิดได้จริง
  if (!ok) redirect("/admin");
}

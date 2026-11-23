import { redirect } from "next/navigation";
import { verifyAdminSession } from "@/lib/auth/server";
import { isAdminSessionActive } from "@/lib/redisSession";
import { refreshAdminIdentity } from "@/lib/auth/adminIdentity";

// guard: มี ADMIN_COOKIE ที่ยัง valid อยู่แล้ว → เด้งไป dashboard แทนโชว์ฟอร์ม login ซ้ำ
// เดิมหน้านี้อยู่ใน middleware.ts's PUBLIC list เฉยๆ (ข้ามการเช็ค token ไปเลย) —
// ถ้า submit ฟอร์มซ้ำจะ overwrite ADMIN_COOKIE ทันทีโดยไม่มีการเตือนว่าตอนนี้ล็อกอินเป็นใครอยู่
// (ยิ่งเสี่ยงบนเครื่องที่ใช้ร่วมกันหลายคน/autofill ผิดบัญชี)
export default async function Layout({ children }: { children: React.ReactNode }) {
  const admin = await verifyAdminSession();
  let activeAdmin = false;
  if (admin && await isAdminSessionActive(admin.jti)) {
    try {
      activeAdmin = Boolean(await refreshAdminIdentity(admin));
    } catch {
      // An identity-read outage must not turn the login route into a blank error page.
      // Authentication still happens in the login mutation and on every admin API call.
    }
  }
  // ⚠️ ส่งไป /admin ไม่ใช่ /admin/dashboard — dashboard อ่านด้วยสิทธิ์ report.view ซึ่ง role
  // คลัง/แคตาล็อกไม่มี การ redirect ตายตัวจึงพาไปเจอการ์ด "ไม่มีสิทธิ์" · /admin เลือกปลายทาง
  // จากนิยามเมนู (firstAdminDestination) ให้ได้หน้าที่บัญชีนั้นเปิดได้จริง
  // A signed JWT can outlive its Redis session or the account's current role/version.
  // /api/auth/me and GraphQL reject that cookie; redirecting it back to /admin here
  // otherwise makes the two routes bounce forever after logout or demotion.
  if (activeAdmin) {
    redirect("/admin");
  }
  return <>{children}</>;
}

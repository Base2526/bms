import { redirect } from "next/navigation";
import { verifyAdminSession } from "@/lib/auth/server";

// guard: มี ADMIN_COOKIE ที่ยัง valid อยู่แล้ว (ล็อกอินร้านไหนอยู่ก็ตาม) → เด้งไป dashboard
// แทนโชว์ฟอร์ม "สมัครร้านใหม่" — signupShop()/verifyPendingShopSignup() ไม่แตะ cookie เดิมเลย
// จึงไม่ overwrite session ตรงๆ แต่ยังขัดกับ convention เดียวกับหน้า / (AGENTS.md § Frontend and
// CSS Modules) ที่ให้ CTA/หน้า auth พาแอดมินที่ล็อกอินอยู่แล้วกลับเข้า operations แทน
export default function Layout({ children }: { children: React.ReactNode }) {
  const admin = verifyAdminSession();
  // ⚠️ ส่งไป /admin ไม่ใช่ /admin/dashboard — dashboard อ่านด้วยสิทธิ์ report.view ซึ่ง role
  // คลัง/แคตาล็อกไม่มี การ redirect ตายตัวจึงพาไปเจอการ์ด "ไม่มีสิทธิ์" · /admin เลือกปลายทาง
  // จากนิยามเมนู (firstAdminDestination) ให้ได้หน้าที่บัญชีนั้นเปิดได้จริง
  if (admin) redirect("/admin");
  return <>{children}</>;
}

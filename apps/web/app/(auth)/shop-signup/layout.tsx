import { redirect } from "next/navigation";
import { verifyAdminSession } from "@/lib/auth/server";

// guard: มี ADMIN_COOKIE ที่ยัง valid อยู่แล้ว (ล็อกอินร้านไหนอยู่ก็ตาม) → เด้งไป dashboard
// แทนโชว์ฟอร์ม "สมัครร้านใหม่" — signupShop()/verifyPendingShopSignup() ไม่แตะ cookie เดิมเลย
// จึงไม่ overwrite session ตรงๆ แต่ยังขัดกับ convention เดียวกับหน้า / (AGENTS.md § Frontend and
// CSS Modules) ที่ให้ CTA/หน้า auth พาแอดมินที่ล็อกอินอยู่แล้วกลับเข้า operations แทน
export default function Layout({ children }: { children: React.ReactNode }) {
  const admin = verifyAdminSession();
  if (admin) redirect("/admin/dashboard");
  return <>{children}</>;
}

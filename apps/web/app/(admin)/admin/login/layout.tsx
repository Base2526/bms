import { redirect } from "next/navigation";
import { verifyAdminSession } from "@/lib/auth/server";

// guard: มี ADMIN_COOKIE ที่ยัง valid อยู่แล้ว → เด้งไป dashboard แทนโชว์ฟอร์ม login ซ้ำ
// เดิมหน้านี้อยู่ใน middleware.ts's PUBLIC list เฉยๆ (ข้ามการเช็ค token ไปเลย) —
// ถ้า submit ฟอร์มซ้ำจะ overwrite ADMIN_COOKIE ทันทีโดยไม่มีการเตือนว่าตอนนี้ล็อกอินเป็นใครอยู่
// (ยิ่งเสี่ยงบนเครื่องที่ใช้ร่วมกันหลายคน/autofill ผิดบัญชี)
export default function Layout({ children }: { children: React.ReactNode }) {
  const admin = verifyAdminSession();
  if (admin) redirect("/admin/dashboard");
  return <>{children}</>;
}

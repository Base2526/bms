import { requirePlatformAdminPage } from "@/lib/auth/platform-page";

// gate: fake seeder สร้าง/ลบข้อมูลจำนวนมาก → เฉพาะ platform admin
// เดิมหน้านี้ไม่มี layout กันเลย (ต่างจาก /admin/env, /admin/logs, /admin/dev/sql-console)
// สิทธิ์ใน AdminSidebar เป็นแค่การซ่อนเมนู ไม่ใช่ authorization — เข้า URL ตรงได้
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdminPage();
  return <>{children}</>;
}

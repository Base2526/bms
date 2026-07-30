import { requirePlatformAdminPage } from "@/lib/auth/platform-page";

// gate: เห็นค่าตั้งส่งรายงานของทุกร้านข้ามร้าน = platform-level action (เหมือน /admin/tenants,
// /admin/dev/fake) — ต้องกันที่ layout.tsx server-side ไม่ใช่แค่ซ่อนเมนูใน AdminSidebar
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdminPage();
  return <>{children}</>;
}

import { requirePlatformAdminPage } from "@/lib/auth/platform-page";

// gate: หน้าระดับแพลตฟอร์ม (log อีเมลทุกร้าน) → เฉพาะ platform admin เหมือน /admin/logs
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdminPage();
  return <>{children}</>;
}

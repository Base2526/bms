import { requirePlatformAdminPage } from "@/lib/auth/platform-page";

// gate: System Health รวมสถานะ DB/Redis/AI/Channel/Cron ข้ามทุกร้าน → เฉพาะ platform admin
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdminPage();
  return <>{children}</>;
}

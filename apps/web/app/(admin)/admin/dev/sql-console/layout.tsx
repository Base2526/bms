import { requirePlatformAdminPage } from "@/lib/auth/platform-page";

// gate: SQL Console เข้าถึงข้าม tenant ได้ทั้งหมด → เฉพาะ platform admin
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdminPage();
  return <>{children}</>;
}

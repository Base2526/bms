import { requirePlatformAdminPage } from "@/lib/auth/platform-page";

// gate: หน้าระดับแพลตฟอร์ม → เฉพาะ platform admin (กัน shop user เข้าตรงผ่าน URL)
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdminPage();
  return <>{children}</>;
}

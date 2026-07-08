import { requirePlatformAdminPage } from "@/lib/auth/platform-page";

// gate: ENV = config ระดับแพลตฟอร์ม → เฉพาะ platform admin
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdminPage();
  return <>{children}</>;
}

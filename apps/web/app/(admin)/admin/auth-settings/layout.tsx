import { requirePlatformAdminPage } from "@/lib/auth/platform-page";

export default async function AuthSettingsLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdminPage();
  return children;
}

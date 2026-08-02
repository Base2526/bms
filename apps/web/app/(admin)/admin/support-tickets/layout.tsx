import { requirePlatformAdminPage } from "@/lib/auth/platform-page";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdminPage();
  return <>{children}</>;
}

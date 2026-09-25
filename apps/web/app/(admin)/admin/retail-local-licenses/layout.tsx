import { requirePlatformAdminPage } from "@/lib/auth/platform-page";

export default async function RetailLocalLicensesLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdminPage();
  return children;
}

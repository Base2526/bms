import { requireTenantAdministratorPage } from "@/lib/auth/tenant-admin-page";

// Realtime diagnostics exposes channel health and internal realtime probes.
// Keep it behind a server-side Administrator/platform-admin gate, not UI-only.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireTenantAdministratorPage();
  return <>{children}</>;
}

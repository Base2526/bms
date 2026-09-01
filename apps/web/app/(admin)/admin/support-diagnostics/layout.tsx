import { redirect } from "next/navigation";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const auth = await authorizeAdminRoute("support.logs.view");
  if (!auth.ok) redirect(auth.status === 401 ? "/admin/login" : "/admin/dashboard");
  return children;
}

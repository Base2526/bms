import { notFound, redirect } from "next/navigation";
import { isRetailLocalDeployment } from "@/lib/bms/deploymentMode";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { getLocalLicense } from "@/lib/bms/localLicense";
import LocalLicensePage from "@/components/retail-local/LocalLicense";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!isRetailLocalDeployment()) notFound();
  const auth = await authorizeAdminRoute("retail_local.license.view");
  if (!auth.ok) { if (auth.status === 401) redirect("/admin/login"); notFound(); }
  try { await getLocalLicense(auth.tenantId); } catch { notFound(); }
  return <LocalLicensePage />;
}

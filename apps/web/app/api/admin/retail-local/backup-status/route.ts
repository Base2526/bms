import { NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { isRetailLocalDeployment } from "@/lib/bms/deploymentMode";
import { getLocalBackup } from "@/lib/bms/localBackup";
export const dynamic = "force-dynamic";
export async function GET() {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!isRetailLocalDeployment()) return reply({ error: "not_found" }, 404);
  const auth = await authorizeAdminRoute("retail_local.license.view");
  if (!auth.ok) return reply({ error: "forbidden" }, auth.status);
  try {
    const result = await getLocalBackup(auth.tenantId);
    return result ? reply(result) : reply({ error: "not_found" }, 404);
  } catch { return reply({ status: "unknown", at: null }, 503); }
}

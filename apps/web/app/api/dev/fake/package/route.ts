import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled, resolveExistingTenantId } from "@/lib/dev-guards";
import { getFakeSeedPackage } from "@/lib/bms/devSeedPackage";
import { listPlans } from "@/lib/bms/entitlements";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production" }, { status: 403 });
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: guard.reason === "not admin" ? 401 : 403 });
  const tenantId = await resolveExistingTenantId(req.nextUrl.searchParams.get("tenantId"), guard.actor.tenant_id);
  const [budget, plans] = await Promise.all([getFakeSeedPackage(tenantId), listPlans()]);
  return NextResponse.json({ ...budget, plans });
}

export const GET = withRouteErrorLog("GET /api/dev/fake/package", handleGET);

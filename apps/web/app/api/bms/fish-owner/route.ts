import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute, type AdminRouteAuth } from "@/lib/bms/adminRouteAuth";
import { requirePermission, type BmsPermission } from "@/lib/bms/permissions";
import { getFishOwnerSnapshot } from "@/lib/bms/fishOwnerRead";
import { attachFishDeliveryOrder, createFishDeliveryPlan, FishOwnerError, saveFishStorageCount,
  type DeliveryPlanInput, type StorageCountInput } from "@/lib/bms/fishOwnerOperations";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Authorized = Extract<AdminRouteAuth, { ok: true }>;
async function authorizeAll(perms: BmsPermission[]): Promise<Authorized | NextResponse> {
  const auth = await authorizeAdminRoute(null);
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  try { for (const perm of perms) await requirePermission(auth.ctx, perm); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }
  return auth;
}

async function handleGET(req: NextRequest) {
  const result = await authorizeAll(["report.view", "purchase.view", "product.view", "shipping.view", "ar.view"]);
  if (result instanceof NextResponse) return result;
  try {
    return NextResponse.json(await getFishOwnerSnapshot(result.tenantId, String(result.adminId), req.nextUrl.searchParams.get("day")));
  } catch (error) {
    if (error instanceof FishOwnerError) return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    throw error;
  }
}

type ActionBody =
  | { action: "storage-count"; confirmed: true; input: StorageCountInput }
  | { action: "delivery-plan"; confirmed: true; input: DeliveryPlanInput }
  | { action: "delivery-link"; confirmed: true; planId: string; orderId: string };

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute(null);
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const body = await req.json().catch(() => null) as ActionBody | null;
  if (!body || body.confirmed !== true || !["storage-count", "delivery-plan", "delivery-link"].includes(body.action))
    return NextResponse.json({ error: "ต้องตรวจรายการและยืนยันก่อนบันทึก" }, { status: 400 });
  const permissions: BmsPermission[] = body.action === "storage-count" ? ["inventory.count.apply", "report.view"]
    : body.action === "delivery-plan" ? ["order.create"] : ["shipping.update"];
  try { for (const permission of permissions) await requirePermission(auth.ctx, permission); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }
  try {
    const tenant = auth.tenantId, actor = String(auth.adminId);
    const saved = body.action === "storage-count" ? await saveFishStorageCount(tenant, actor, body.input)
      : body.action === "delivery-plan" ? await createFishDeliveryPlan(tenant, actor, body.input)
      : await attachFishDeliveryOrder(tenant, actor, body.planId, body.orderId);
    return NextResponse.json(saved, { status: saved.status === "SAVED" ? 201 : 200 });
  } catch (error) {
    if (error instanceof FishOwnerError) return NextResponse.json({ error: error.message, code: error.code },
      { status: ["IDEMPOTENCY_CONFLICT", "STALE_COUNT", "STALE_LOT", "ORDER_ALREADY_LINKED", "OVER_COMMITTED"].includes(error.code) ? 409 : 400 });
    throw error;
  }
}

export const GET = withRouteErrorLog("GET /api/bms/fish-owner", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/fish-owner", handlePOST);

import { NextResponse, type NextRequest } from "next/server";

import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { listDeliveryMappings, upsertDeliveryLocationMapping, upsertDeliveryMenuMapping } from "@/lib/bms/deliveryMenuMappings";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("delivery.integration.view");
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status });
  const integrationId = new URL(req.url).searchParams.get("integrationId");
  return NextResponse.json(await listDeliveryMappings(auth.tenantId, integrationId));
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("delivery.mapping.manage");
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  try {
    const actorUserId = String(auth.adminId);
    if (body.action === "save_location") {
      return NextResponse.json(await upsertDeliveryLocationMapping({
        tenantId: auth.tenantId,
        actorUserId,
        id: typeof body.id === "string" ? body.id.trim() : null,
        integrationId: String(body.integrationId ?? "").trim(),
        locationId: String(body.locationId ?? "").trim(),
        providerStoreId: body.providerStoreId,
        providerStoreName: body.providerStoreName,
        timezone: body.timezone,
        active: body.active !== false,
      }));
    }
    if (body.action === "save_menu") {
      return NextResponse.json(await upsertDeliveryMenuMapping({
        tenantId: auth.tenantId,
        actorUserId,
        id: typeof body.id === "string" ? body.id.trim() : null,
        integrationId: String(body.integrationId ?? "").trim(),
        locationMappingId: String(body.locationMappingId ?? "").trim(),
        mappingKind: body.mappingKind,
        providerItemId: body.providerItemId,
        providerVariantId: body.providerVariantId,
        providerModifierId: body.providerModifierId,
        providerName: body.providerName,
        providerPrice: body.providerPrice,
        productSku: body.productSku,
        size: body.size,
        modifierCode: body.modifierCode,
        mappingStatus: body.mappingStatus,
        providerCatalogVersion: body.providerCatalogVersion,
      }));
    }
    return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "DELIVERY_MAPPING_INVALID";
    return NextResponse.json({ error: code }, { status: code.includes("NOT_FOUND") ? 404 : code.includes("SCOPE") ? 409 : 400 });
  }
}

export const GET = withRouteErrorLog("GET /api/bms/delivery/mappings", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/delivery/mappings", handlePOST);

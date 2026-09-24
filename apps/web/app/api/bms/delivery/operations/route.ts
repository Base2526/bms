import { NextResponse, type NextRequest } from "next/server";

import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { listDeliveryOperations, retryDeliveryCommand, retryDeliveryEvent } from "@/lib/bms/deliveryOperations";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("delivery.integration.view");
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status });
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 100);
  return NextResponse.json(await listDeliveryOperations(auth.tenantId, Number.isFinite(limit) ? limit : 100));
}

async function handlePOST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  const action = String(body.action ?? "");
  const permission = action === "retry_event" ? "restaurant.delivery.review" : "delivery.integration.manage";
  const auth = await authorizeAdminRoute(permission as "restaurant.delivery.review" | "delivery.integration.manage");
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status });
  try {
    if (action === "retry_event") {
      return NextResponse.json(await retryDeliveryEvent(auth.tenantId, String(auth.adminId), String(body.eventId ?? "")));
    }
    if (action === "retry_command") {
      return NextResponse.json(await retryDeliveryCommand(auth.tenantId, String(auth.adminId), String(body.commandId ?? "")));
    }
    return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "DELIVERY_OPERATION_INVALID";
    return NextResponse.json({ error: code }, { status: code.includes("NOT_RETRYABLE") ? 409 : 400 });
  }
}

export const GET = withRouteErrorLog("GET /api/bms/delivery/operations", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/delivery/operations", handlePOST);

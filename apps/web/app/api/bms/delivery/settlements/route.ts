import { NextResponse, type NextRequest } from "next/server";

import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  createDeliveryDispute,
  importManualDeliverySettlement,
  listDeliveryFinance,
  recordDeliveryAdjustment,
  transitionDeliveryDispute,
} from "@/lib/bms/deliverySettlements";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("delivery.settlement.view");
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status });
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 100);
  return NextResponse.json(await listDeliveryFinance(auth.tenantId, Number.isFinite(limit) ? limit : 100));
}

async function handlePOST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  const action = String(body.action ?? "");
  const permission = action === "create_dispute" || action === "transition_dispute"
    ? "delivery.dispute.manage" : "delivery.settlement.manage";
  const auth = await authorizeAdminRoute(permission as "delivery.dispute.manage" | "delivery.settlement.manage");
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status });
  const common = { tenantId: auth.tenantId, actorUserId: String(auth.adminId) };
  try {
    if (action === "import_manual") {
      return NextResponse.json(await importManualDeliverySettlement({
        ...common, integrationId: String(body.integrationId ?? ""), provider: body.provider,
        statementReference: body.statementReference, periodStart: body.periodStart, periodEnd: body.periodEnd,
        currency: body.currency, discountAmount: body.discountAmount,
        commissionAmount: body.commissionAmount, lines: body.lines,
      }));
    }
    if (action === "record_adjustment") {
      return NextResponse.json(await recordDeliveryAdjustment({
        ...common, integrationId: String(body.integrationId ?? ""), deliveryOrderId: body.deliveryOrderId,
        settlementLineId: body.settlementLineId, adjustmentType: body.adjustmentType, amount: body.amount,
        currency: body.currency, providerReference: body.providerReference, reason: body.reason,
        effectiveAt: body.effectiveAt,
      }));
    }
    if (action === "create_dispute") {
      return NextResponse.json(await createDeliveryDispute({
        ...common, integrationId: String(body.integrationId ?? ""), deliveryOrderId: body.deliveryOrderId,
        providerCaseId: body.providerCaseId, reason: body.reason, claimedAmount: body.claimedAmount,
        currency: body.currency,
      }));
    }
    if (action === "transition_dispute") {
      return NextResponse.json(await transitionDeliveryDispute({
        ...common, disputeId: String(body.disputeId ?? ""), status: body.status,
        providerCaseId: body.providerCaseId,
      }));
    }
    return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "DELIVERY_FINANCE_INVALID";
    const status = code.includes("NOT_FOUND") ? 404 : code.includes("ALREADY") || code.includes("SCOPE") || code.includes("TRANSITION") ? 409 : 400;
    return NextResponse.json({ error: code }, { status });
  }
}

export const GET = withRouteErrorLog("GET /api/bms/delivery/settlements", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/delivery/settlements", handlePOST);

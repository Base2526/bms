// POST /api/bms/payment/:id/confirm — PENDING → CONFIRMED + order → PAID  [Phase 1: default tenant]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { confirmPayment } from "@/lib/bms/payments";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "payment id required" }, { status: 400 });
  const result = await confirmPayment(DEFAULT_TENANT_ID, id);
  const httpStatus =
    result.status === "CONFIRMED" ? 200
      : result.status === "NOT_FOUND" ? 404
      : result.status === "INVALID_AMOUNT" ? 422
      : 409; // INVALID_STATE
  return NextResponse.json(result, { status: httpStatus });
}

export const POST = withRouteErrorLog("POST /api/bms/payment/[id]/confirm", handlePOST);

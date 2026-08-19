// POST /api/bms/payment/:id/refund — CONFIRMED → REFUNDED (manager)  [Phase 1: default tenant]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { refundPayment } from "@/lib/bms/payments";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "payment id required" }, { status: 400 });
  const ok = await refundPayment(DEFAULT_TENANT_ID, id);
  if (!ok) return NextResponse.json({ status: "INVALID_TRANSITION", id }, { status: 409 });
  return NextResponse.json({ ok: true, id });
}

export const POST = withRouteErrorLog("POST /api/bms/payment/[id]/refund", handlePOST);

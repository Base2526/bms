// POST /api/bms/payment/:id/refund — signed admin + payment.refund
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { refundPayment } from "@/lib/bms/payments";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("payment.refund");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "payment id required" }, { status: 400 });
  const ok = await refundPayment(auth.tenantId, id, String(auth.adminId));
  if (!ok) return NextResponse.json({ status: "INVALID_TRANSITION", id }, { status: 409 });
  return NextResponse.json({ ok: true, id });
}

export const POST = withRouteErrorLog("POST /api/bms/payment/[id]/refund", handlePOST);

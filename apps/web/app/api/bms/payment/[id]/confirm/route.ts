// POST /api/bms/payment/:id/confirm — signed admin + payment.confirm
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { confirmPayment } from "@/lib/bms/payments";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("payment.confirm");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "payment id required" }, { status: 400 });
  const result = await confirmPayment(auth.tenantId, id, String(auth.adminId));
  const httpStatus =
    result.status === "CONFIRMED" ? 200
      : result.status === "NOT_FOUND" ? 404
      : result.status === "INVALID_AMOUNT" ? 422
      : 409; // INVALID_STATE / INVALID_ORDER_STATE
  return NextResponse.json(result, { status: httpStatus });
}

export const POST = withRouteErrorLog("POST /api/bms/payment/[id]/confirm", handlePOST);

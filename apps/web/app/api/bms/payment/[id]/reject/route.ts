// POST /api/bms/payment/:id/reject — signed admin + payment.confirm
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { rejectPayment } from "@/lib/bms/payments";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("payment.confirm");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "payment id required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { note?: unknown };
  const note = typeof body.note === "string" ? body.note : null;
  const ok = await rejectPayment(auth.tenantId, id, note, String(auth.adminId));
  if (!ok) return NextResponse.json({ status: "INVALID_TRANSITION", id }, { status: 409 });
  return NextResponse.json({ ok: true, id });
}

export const POST = withRouteErrorLog("POST /api/bms/payment/[id]/reject", handlePOST);

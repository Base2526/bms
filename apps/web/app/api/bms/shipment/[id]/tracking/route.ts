// POST /api/bms/shipment/:id/tracking — แก้เลขพัสดุ / carrier  [signed admin + RBAC · tenant จาก session]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateTracking, type Carrier } from "@/lib/bms/shipping";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("shipping.update");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "shipment id required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { trackingNo?: unknown; carrier?: unknown };
  const ok = await updateTracking(auth.tenantId, id, {
    trackingNo: typeof body.trackingNo === "string" ? body.trackingNo : null,
    carrier: typeof body.carrier === "string" ? (body.carrier as Carrier) : null,
  });
  if (!ok) return NextResponse.json({ status: "INVALID", id }, { status: 409 });
  return NextResponse.json({ ok: true, id });
}

export const POST = withRouteErrorLog("POST /api/bms/shipment/[id]/tracking", handlePOST);

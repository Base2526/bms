// POST /api/bms/shipment/:id/tracking — แก้เลขพัสดุ / carrier  [Phase 1: default tenant]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateTracking, type Carrier } from "@/lib/bms/shipping";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "shipment id required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { trackingNo?: unknown; carrier?: unknown };
  const ok = await updateTracking(DEFAULT_TENANT_ID, id, {
    trackingNo: typeof body.trackingNo === "string" ? body.trackingNo : null,
    carrier: typeof body.carrier === "string" ? (body.carrier as Carrier) : null,
  });
  if (!ok) return NextResponse.json({ status: "INVALID", id }, { status: 409 });
  return NextResponse.json({ ok: true, id });
}

export const POST = withRouteErrorLog("POST /api/bms/shipment/[id]/tracking", handlePOST);

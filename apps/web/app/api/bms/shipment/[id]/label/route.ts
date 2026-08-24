// GET /api/bms/shipment/:id/label — ข้อมูลสำหรับพิมพ์ label  [signed admin + RBAC · tenant จาก session]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getShipmentLabel } from "@/lib/bms/shipping";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("shipping.view");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "shipment id required" }, { status: 400 });
  const label = await getShipmentLabel(auth.tenantId, id);
  if (!label) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(label);
}

export const GET = withRouteErrorLog("GET /api/bms/shipment/[id]/label", handleGET);

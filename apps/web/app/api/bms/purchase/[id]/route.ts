// GET /api/bms/purchase/:id — รายละเอียด PO + รายการ   [Phase 1: default tenant]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getPurchaseOrder } from "@/lib/bms/purchase";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_req: NextRequest, { params }: { params: { id: string } }) {
  const poId = params.id?.trim();
  if (!poId) return NextResponse.json({ error: "po id required" }, { status: 400 });
  const po = await getPurchaseOrder(DEFAULT_TENANT_ID, poId);
  if (!po) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(po);
}

export const GET = withRouteErrorLog("GET /api/bms/purchase/[id]", handleGET);

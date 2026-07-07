// GET /api/bms/shipment/:id/label — ข้อมูลสำหรับพิมพ์ label  [Phase 1: default tenant]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getShipmentLabel } from "@/lib/bms/shipping";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "shipment id required" }, { status: 400 });
  const label = await getShipmentLabel(DEFAULT_TENANT_ID, id);
  if (!label) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(label);
}

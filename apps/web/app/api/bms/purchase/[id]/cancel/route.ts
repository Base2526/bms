// POST /api/bms/purchase/:id/cancel — ยกเลิก PO (เฉพาะ OPEN/PARTIAL)  [Phase 1: default tenant]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cancelPurchaseOrder } from "@/lib/bms/purchase";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const poId = params.id?.trim();
  if (!poId) return NextResponse.json({ error: "po id required" }, { status: 400 });
  const ok = await cancelPurchaseOrder(DEFAULT_TENANT_ID, poId);
  if (!ok) return NextResponse.json({ status: "INVALID_TRANSITION", poId }, { status: 409 });
  return NextResponse.json({ ok: true, poId });
}

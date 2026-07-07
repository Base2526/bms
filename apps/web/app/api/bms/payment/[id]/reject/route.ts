// POST /api/bms/payment/:id/reject — PENDING → REJECTED  [Phase 1: default tenant]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { rejectPayment } from "@/lib/bms/payments";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "payment id required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { note?: unknown };
  const note = typeof body.note === "string" ? body.note : null;
  const ok = await rejectPayment(DEFAULT_TENANT_ID, id, note);
  if (!ok) return NextResponse.json({ status: "INVALID_TRANSITION", id }, { status: 409 });
  return NextResponse.json({ ok: true, id });
}

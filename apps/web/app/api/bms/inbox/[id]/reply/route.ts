// POST /api/bms/inbox/:id/reply — staff ตอบเอง (persist + ยิงกลับช่องทาง)  [Phase 1: default tenant]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sendStaffMessage } from "@/lib/bms/inbox";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "conversation id required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { body?: unknown };
  const text = typeof body.body === "string" ? body.body : "";
  if (!text.trim()) return NextResponse.json({ error: "body is required" }, { status: 400 });

  const result = await sendStaffMessage(DEFAULT_TENANT_ID, id, text, null);
  const httpStatus = result.status === "SENT" ? 200 : result.status === "NOT_FOUND" ? 404 : 400;
  return NextResponse.json(result, { status: httpStatus });
}

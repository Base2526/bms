// =============================================================
// POST /api/bms/chat — endpoint ทดสอบ pipeline ด้วย curl
// -------------------------------------------------------------
//   curl -X POST http://localhost:3000/api/bms/chat \
//     -H "content-type: application/json" \
//     -d '{"message":"Nike XL มีไหม"}'
// คืน trace ทุกขั้นของ AI_WORKFLOW เพื่อ debug
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runPipeline, type Channel } from "@/lib/bms/pipeline";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS: Channel[] = ["line", "tiktok", "facebook", "instagram", "web", "shopee", "lazada", "test"];

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    message?: unknown;
    channel?: unknown;
    customerRef?: unknown;
    tenantId?: unknown;
  };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  const channel = CHANNELS.includes(body.channel as Channel)
    ? (body.channel as Channel)
    : "test";
  const customerRef =
    typeof body.customerRef === "string" ? body.customerRef.trim() || null : null;
  const tenantId =
    typeof body.tenantId === "string" && body.tenantId.trim() ? body.tenantId.trim() : DEFAULT_TENANT_ID;

  const result = await runPipeline(message, channel, tenantId, customerRef);
  return NextResponse.json(result);
}

// =============================================================
// /api/bms/web/webhook/[tenantId] — Website Live Chat (public widget)
// -------------------------------------------------------------
// วิดเจ็ตหน้าเว็บ POST { message, sessionId } → pipeline → log inbox
//   → ตอบกลับใน HTTP response ทันที (synchronous, ไม่ต้อง push)
// public endpoint: ไม่มี signature (widget ฝั่ง client) — มี rate limit + CORS
// sessionId = customer_ref ต่อผู้เยี่ยมชม (ถ้าไม่ส่งมา ระบบจะสร้างให้)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { runPipeline } from "@/lib/bms/pipeline";
import { getChannel } from "@/lib/bms/channels";
import { rateLimit } from "@/lib/bms/rateLimit";
import { logConversation } from "@/lib/bms/inbox";
import { claimInboundEvent } from "@/lib/bms/inboundEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNEL = "web";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const tenantId = params.tenantId?.trim();
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400, headers: CORS });

  const rl = rateLimit(`${CHANNEL}:${tenantId}`, 120, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { ...CORS, "retry-after": String(rl.retryAfter) } });

  // ถ้าตั้ง channel ไว้และปิดอยู่ → ไม่ให้ใช้; ถ้ายังไม่ตั้ง = เปิดโดยปริยาย
  const cfg = await getChannel(tenantId, CHANNEL);
  if (cfg && !cfg.active) return NextResponse.json({ error: "web chat disabled" }, { status: 403, headers: CORS });

  const body = (await req.json().catch(() => ({}))) as {
    message?: unknown;
    sessionId?: unknown;
    messageId?: unknown;
  };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400, headers: CORS });

  const sessionId = (typeof body.sessionId === "string" && body.sessionId.trim()) || `web-${randomUUID()}`;
  const messageId =
    (typeof body.messageId === "string" && body.messageId.trim()) ||
    req.headers.get("idempotency-key");
  if (!(await claimInboundEvent(tenantId, CHANNEL, messageId))) {
    return NextResponse.json({ duplicate: true, sessionId }, { headers: CORS });
  }

  const result = await runPipeline(message, CHANNEL, tenantId, sessionId);
  await logConversation(tenantId, CHANNEL, sessionId, message, result.reply, result.quality);

  return NextResponse.json({ reply: result.reply, sessionId }, { headers: CORS });
}

// =============================================================
// /api/bms/web/webhook/[tenantId] — Website Live Chat (public widget)
// -------------------------------------------------------------
// วิดเจ็ตหน้าเว็บ POST { message, sessionId } → pipeline → log inbox
//   → ตอบกลับใน HTTP response ทันที (synchronous, ไม่ต้อง push)
// public endpoint: ไม่มี signature (widget ฝั่ง client) — มี rate limit + CORS
// sessionId is a signed bearer token; only its verified internal ref reaches CRM.
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash } from "crypto";
import { resolveWebChatSession, InvalidWebChatSession } from "@/lib/bms/webChatSession";
import { runPipeline } from "@/lib/bms/pipeline";
import { getChannel } from "@/lib/bms/channels";
import { rateLimit } from "@/lib/bms/rateLimit";
import { logConversation } from "@/lib/bms/inbox";
import { claimInboundEvent } from "@/lib/bms/inboundEvents";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNEL = "web";
const CORS = {
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, idempotency-key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function handlePOST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const tenantId = params.tenantId?.trim();
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400, headers: CORS });

  const rl = await rateLimit(`${CHANNEL}:${tenantId}`, 120, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { ...CORS, "retry-after": String(rl.retryAfter) } });

  // ถ้าตั้ง channel ไว้และปิดอยู่ → ไม่ให้ใช้; ถ้ายังไม่ตั้ง = เปิดโดยปริยาย
  const cfg = await getChannel(tenantId, CHANNEL);
  if (cfg && !cfg.active) return NextResponse.json({ error: "web chat disabled" }, { status: 403, headers: CORS });

  const parsed = await req.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "JSON object required" }, { status: 400, headers: CORS });
  }
  const body = parsed as {
    message?: unknown;
    sessionId?: unknown;
    messageId?: unknown;
  };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400, headers: CORS });

  let session;
  try {
    session = resolveWebChatSession(tenantId, body.sessionId);
  } catch (error) {
    if (!(error instanceof InvalidWebChatSession)) throw error;
    return NextResponse.json({ error: error.message, code: "INVALID_CHAT_SESSION" }, { status: 401, headers: CORS });
  }
  const { sessionId, customerRef, sessionReset } = session;
  const messageId =
    (typeof body.messageId === "string" && body.messageId.trim()) ||
    req.headers.get("idempotency-key")?.trim();
  if (messageId && messageId.length > 256) {
    return NextResponse.json({ error: "messageId is too long" }, { status: 400, headers: CORS });
  }
  // Before receiving a signed session, a retry mints another random ref. Claim
  // that bootstrap request independently so a lost first response cannot run
  // business actions twice. The legacy value namespaces dedup ONLY: it never
  // grants access to the original session, token, reply, or CRM history.
  const suppliedSession = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (messageId && suppliedSession !== sessionId) {
    const bootstrapKey = createHash("sha256").update(JSON.stringify(["web-bootstrap-v1", suppliedSession, messageId])).digest("hex");
    if (!(await claimInboundEvent(tenantId, CHANNEL, bootstrapKey))) {
      return NextResponse.json({ duplicate: true, sessionId, sessionReset }, { headers: CORS });
    }
  }
  // Also claim against the issued ref so a retry using the returned token is
  // deduplicated, including the very first message in that session.
  const eventKey = messageId ? createHash("sha256").update(JSON.stringify([customerRef, messageId])).digest("hex") : null;
  if (!(await claimInboundEvent(tenantId, CHANNEL, eventKey))) {
    return NextResponse.json({ duplicate: true, sessionId, sessionReset }, { headers: CORS });
  }

  const result = await runPipeline(message, CHANNEL, tenantId, customerRef);
  await logConversation(tenantId, CHANNEL, customerRef, message, result.reply, result.quality);

  return NextResponse.json({ reply: result.reply, sessionId, sessionReset }, { headers: CORS });
}

export const POST = withRouteErrorLog("POST /api/bms/web/webhook/[tenantId]", handlePOST);

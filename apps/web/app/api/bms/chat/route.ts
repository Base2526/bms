// =============================================================
// POST /api/bms/chat — endpoint ทดสอบ pipeline ด้วย curl
// -------------------------------------------------------------
//   curl -b /tmp/bms-cookies.txt -X POST http://localhost:3000/api/bms/chat \
//     -H "content-type: application/json" \
//     -d '{"message":"Nike XL มีไหม"}'
// ต้องมี signed admin cookie + ai_quality.view; tenant derive จาก session/drill-down เท่านั้น
// คืน trace ทุกขั้นของ AI_WORKFLOW เพื่อ debug
//
// logConversation() ต่อจาก runPipeline() เหมือน webhook จริงทุกตัว (line/facebook/...) —
// เดิม endpoint นี้ไม่เคย persist เลย ทำให้ทดสอบ P0 (conversation history) ผ่าน playground ไม่ได้
// (channel:"test" ยังไม่ persist เหมือนเดิม — logConversation() เองมี guard นี้อยู่แล้ว);
// ใช้ channel อื่น เช่น "web" คู่กับ customerRef ที่ตั้งเอง เพื่อทดสอบ multi-turn จริง — ดู scripts/ai-eval/
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runPipeline, type Channel } from "@/lib/bms/pipeline";
import { logConversation } from "@/lib/bms/inbox";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { readBoundedBodyBytes } from "@/lib/bms/webhookBody";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS: Channel[] = ["line", "tiktok", "facebook", "instagram", "web", "shopee", "lazada", "test"];
const MAX_CHAT_BODY_BYTES = 64 * 1024;
const MAX_CHAT_MESSAGE_LENGTH = 10_000;
const MAX_CUSTOMER_REF_LENGTH = 256;

async function handlePOST(req: NextRequest) {
  // หน้า Playground ใช้ ai_quality.view; API ต้องบังคับสิทธิ์เดียวกันก่อนเรียก AI
  // หรือเขียน conversation ซึ่งอาจเกิดขึ้นเมื่อเลือก channel อื่นที่ไม่ใช่ test
  const auth = await authorizeAdminRoute("ai_quality.view");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });

  const bounded = await readBoundedBodyBytes(req, MAX_CHAT_BODY_BYTES);
  if (!bounded.ok) return NextResponse.json({ error: "CHAT_INPUT_TOO_LARGE" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bounded.bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid json object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  if (message.length > MAX_CHAT_MESSAGE_LENGTH)
    return NextResponse.json({ error: "CHAT_INPUT_TOO_LARGE" }, { status: 413 });
  const channel = CHANNELS.includes(body.channel as Channel)
    ? (body.channel as Channel)
    : "test";
  const customerRef =
    typeof body.customerRef === "string" ? body.customerRef.trim() || null : null;
  if (customerRef && customerRef.length > MAX_CUSTOMER_REF_LENGTH)
    return NextResponse.json({ error: "INVALID_CUSTOMER_REF" }, { status: 400 });
  const result = await runPipeline(message, channel, auth.tenantId, customerRef);
  await logConversation(auth.tenantId, channel, customerRef, message, result.reply, result.quality);
  return NextResponse.json(result);
}

export const POST = withRouteErrorLog("POST /api/bms/chat", handlePOST);

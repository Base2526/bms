// =============================================================
// POST /api/bms/chat — endpoint ทดสอบ pipeline ด้วย curl
// -------------------------------------------------------------
//   curl -b /tmp/bms-cookies.txt -X POST http://localhost:3000/api/bms/chat \
//     -H "content-type: application/json" \
//     -d '{"message":"Nike XL มีไหม"}'
// ต้องมี signed admin cookie; tenant derive จาก session/drill-down เท่านั้น
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
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS: Channel[] = ["line", "tiktok", "facebook", "instagram", "web", "shopee", "lazada", "test"];

async function handlePOST(req: NextRequest) {
  // Playground ทำ write จริงได้ จึงต้อง derive tenant จาก signed admin session เท่านั้น
  // permission = null: ยังไม่มีสิทธิ์ตรงตัวใน catalog สำหรับ playground — ที่ต้องมีคือ
  // "ล็อกอินแล้ว + tenant มาจาก session" ซึ่ง helper จัดการรวมกับคุกกี้ drill-down ให้
  const auth = await authorizeAdminRoute(null);
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as {
    message?: unknown;
    channel?: unknown;
    customerRef?: unknown;
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
  const result = await runPipeline(message, channel, auth.tenantId, customerRef);
  await logConversation(auth.tenantId, channel, customerRef, message, result.reply, result.quality);
  return NextResponse.json(result);
}

export const POST = withRouteErrorLog("POST /api/bms/chat", handlePOST);

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
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { verifyAdminSession } from "@/lib/auth/server";
import { ACT_TENANT_COOKIE, verifyActTenant } from "@/lib/auth/token";
import { cookies } from "next/headers";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS: Channel[] = ["line", "tiktok", "facebook", "instagram", "web", "shopee", "lazada", "test"];

async function handlePOST(req: NextRequest) {
  // Playground ทำ write จริงได้ จึงต้อง derive tenant จาก signed admin session เท่านั้น
  const admin = verifyAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
  const acting = verifyActTenant(cookies().get(ACT_TENANT_COOKIE)?.value);
  const tenantId =
    acting?.actTenantId && String(acting.by) === String(admin.id)
      ? acting.actTenantId
      : admin.tenant_id || DEFAULT_TENANT_ID;

  const result = await runPipeline(message, channel, tenantId, customerRef);
  await logConversation(tenantId, channel, customerRef, message, result.reply, result.quality);
  return NextResponse.json(result);
}

export const POST = withRouteErrorLog("POST /api/bms/chat", handlePOST);

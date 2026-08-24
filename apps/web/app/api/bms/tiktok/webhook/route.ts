// =============================================================
// POST /api/bms/tiktok/webhook — TikTok DM webhook (mock)
// -------------------------------------------------------------
//   curl -X POST http://localhost:3000/api/bms/tiktok/webhook \
//     -H "content-type: application/json" \
//     -d '{"messages":[{"user_id":"u123","content":{"text":"Adidas XL มีไหม"}}]}'
// โครงสร้าง event ต่างจาก LINE จึง parse คนละแบบ แต่เข้า pipeline เดียวกัน
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runPipeline } from "@/lib/bms/pipeline";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { claimInboundEvent } from "@/lib/bms/inboundEvents";
import { logConversation } from "@/lib/bms/inbox";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * mock ยุคร้านเดียว — ไม่มี signature ให้ verify และเขียนเข้าร้าน default ตายตัว
 *
 * ปล่อยไว้ใน production คือให้ใครก็ยิงข้อความปลอมเข้ากล่องข้อความของร้าน default
 * **และเรียก AI ให้ตอบทุกครั้ง** (ค่า token เป็นของเจ้าของระบบ ไม่ใช่ของผู้ยิง)
 * ทางจริงคือ webhook ต่อร้านที่ verify ลายเซ็นแบบ fail-closed:
 * `/api/bms/{channel}/webhook/[tenantId]` — ตัวนี้เหลือไว้ให้ curl ตอน dev เท่านั้น
 */
function mockWebhookDisabled() {
  return process.env.NODE_ENV === "production";
}


type TikTokMessage = {
  id?: string;
  message_id?: string;
  user_id?: string;
  content?: { text?: string };
};

async function handlePOST(req: NextRequest) {
  if (mockWebhookDisabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    messages?: TikTokMessage[];
  };
  const messages = Array.isArray(body.messages) ? body.messages : [];

  const replies = [];
  for (const m of messages) {
    const text = m.content?.text?.trim() ?? "";
    if (!text) continue;
    if (!(await claimInboundEvent(DEFAULT_TENANT_ID, "tiktok", m.message_id ?? m.id))) {
      replies.push({ userId: m.user_id, duplicate: true });
      continue;
    }

    const customerRef = m.user_id ?? null;
    const result = await runPipeline(text, "tiktok", DEFAULT_TENANT_ID, customerRef);
    await logConversation(DEFAULT_TENANT_ID, "tiktok", customerRef, text, result.reply, result.quality);
    // TODO(prod): ยิงกลับผ่าน TikTok Business Messaging API
    replies.push({ userId: m.user_id, reply: result.reply });
  }

  return NextResponse.json({ ok: true, replies });
}

export const POST = withRouteErrorLog("POST /api/bms/tiktok/webhook", handlePOST);

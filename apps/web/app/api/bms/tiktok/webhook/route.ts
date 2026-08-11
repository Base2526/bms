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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TikTokMessage = {
  id?: string;
  message_id?: string;
  user_id?: string;
  content?: { text?: string };
};

export async function POST(req: NextRequest) {
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

// =============================================================
// POST /api/bms/shopee/webhook/[tenantId] — Shopee webhook ต่อร้าน
// -------------------------------------------------------------
// ⚠️ SCAFFOLD — โครงนี้ทำตาม pattern เดียวกับ tiktok webhook (verify
// HMAC ด้วย channel_secret ของร้าน + parse body → pipeline → log inbox)
// แต่ "ชื่อ field ใน body" และ "scheme การ verify signature" ด้านล่าง
// เป็นการเดา ยังไม่เคยตรวจกับเอกสาร Shopee Open Platform จริง —
// ต้องแก้ parseShopeeMessages() + header signature ให้ตรง spec จริงก่อนใช้ production
// (Shopee Open Platform ใช้ OAuth + HMAC-SHA256 บน partner_key เป็นหลัก
//  ไม่ใช่ channel_secret ต่อร้านแบบนี้ตรง ๆ — ต้องตรวจสอบก่อน)
// send API (ตอบกลับลูกค้าใน Shopee Chat) ยังไม่ implement (roadmap)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runPipeline } from "@/lib/bms/pipeline";
import { getChannel } from "@/lib/bms/channels";
import { rateLimit } from "@/lib/bms/rateLimit";
import { logConversation } from "@/lib/bms/inbox";
import { recordInboundEvent, recordWebhookVerifyFailed } from "@/lib/bms/channelHealth";
import crypto from "crypto";
import { claimInboundEvent } from "@/lib/bms/inboundEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShopeeMessage = { id?: string; message_id?: string; from_id?: string; sender_id?: string; content?: { text?: string }; message?: string };

function parseShopeeMessages(body: any): ShopeeMessage[] {
  // TODO(prod): แทนที่ด้วย mapping จริงตาม payload ของ Shopee Open Platform
  if (Array.isArray(body?.messages)) return body.messages;
  if (body?.data) return [body.data];
  return [];
}

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const tenantId = params.tenantId?.trim();
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });

  const rl = rateLimit(`shopee:${tenantId}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  }

  const cfg = await getChannel(tenantId, "shopee");
  if (!cfg || !cfg.active) {
    return NextResponse.json({ ok: true, skipped: "channel not configured" });
  }

  const raw = await req.text();
  // TODO(prod): ยืนยัน scheme จริงจาก Shopee Open Platform ก่อนใช้ — โครงนี้เป็น placeholder
  if (cfg.channel_secret) {
    const sig = req.headers.get("x-shopee-signature") || req.headers.get("authorization");
    const mac = crypto.createHmac("sha256", cfg.channel_secret).update(raw).digest("hex");
    if (!sig || sig !== mac) {
      await recordWebhookVerifyFailed(tenantId, "shopee");
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  const body = (() => { try { return JSON.parse(raw); } catch { return {}; } })();
  const messages = parseShopeeMessages(body);

  const replies = [];
  for (const m of messages) {
    const text = (m.content?.text ?? m.message ?? "").trim();
    if (!text) continue;
    if (!(await claimInboundEvent(tenantId, "shopee", m.message_id ?? m.id))) {
      replies.push({ userId: m.from_id ?? m.sender_id, duplicate: true });
      continue;
    }
    const userId = m.from_id ?? m.sender_id ?? null;
    const result = await runPipeline(text, "shopee", tenantId, userId);

    await logConversation(tenantId, "shopee", userId, text, result.reply);

    // TODO(prod): ยิงกลับผ่าน Shopee Chat API ด้วย cfg.access_token (ยังไม่ implement)
    replies.push({ userId, reply: result.reply });
  }
  if (replies.length > 0) await recordInboundEvent(tenantId, "shopee");

  return NextResponse.json({ ok: true, tenantId, replies });
}

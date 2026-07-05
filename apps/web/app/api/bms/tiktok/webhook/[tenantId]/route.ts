// =============================================================
// POST /api/bms/tiktok/webhook/[tenantId] — TikTok webhook ต่อร้าน
// -------------------------------------------------------------
// verify signature ด้วย channel_secret ของร้าน (ถ้าตั้งไว้)
// โครง event ต่างจาก LINE จึง parse คนละแบบ แต่เข้า pipeline เดียวกัน
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runPipeline } from "@/lib/bms/pipeline";
import { getChannel } from "@/lib/bms/channels";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TikTokMessage = { user_id?: string; content?: { text?: string } };

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const tenantId = params.tenantId?.trim();
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });

  const cfg = await getChannel(tenantId, "tiktok");
  if (!cfg || !cfg.active) {
    return NextResponse.json({ ok: true, skipped: "channel not configured" });
  }

  const raw = await req.text();
  // TikTok: HMAC-SHA256 hex ใน header (ตามที่ตั้ง) — verify ถ้ามี secret
  if (cfg.channel_secret) {
    const sig = req.headers.get("x-tiktok-signature") || req.headers.get("x-signature");
    const mac = crypto.createHmac("sha256", cfg.channel_secret).update(raw).digest("hex");
    if (!sig || sig !== mac) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  const body = (() => { try { return JSON.parse(raw); } catch { return {}; } })() as { messages?: TikTokMessage[] };
  const messages = Array.isArray(body.messages) ? body.messages : [];

  const replies = [];
  for (const m of messages) {
    const text = m.content?.text?.trim() ?? "";
    if (!text) continue;
    const result = await runPipeline(text, "tiktok", tenantId, m.user_id ?? null);
    // TODO(prod): ยิงกลับผ่าน TikTok Business Messaging API ด้วย cfg.access_token
    replies.push({ userId: m.user_id, reply: result.reply });
  }

  return NextResponse.json({ ok: true, tenantId, replies });
}

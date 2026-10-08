// =============================================================
// POST /api/bms/line/webhook/[tenantId] — LINE webhook ต่อร้าน
// -------------------------------------------------------------
// แต่ละร้านเอา URL นี้ไปใส่ใน LINE Developers Console ของตัวเอง
//   • verify X-Line-Signature ด้วย channel_secret ของร้าน
//   • ตอบกลับด้วย access_token ของร้าน (LINE reply API)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runPipeline } from "@/lib/bms/pipeline";
import { getChannel } from "@/lib/bms/channels";
import { verifyLineSignature } from "@/lib/bms/crypto";
import { rateLimit } from "@/lib/bms/rateLimit";
import { logConversation, notifyInboxConversationChanged, logInboundMessage, type Attachment } from "@/lib/bms/inbox";
import { fallbackEvidenceQuality } from "@/lib/bms/customerAnswerEvidence";
import { persistBuffer, buildFileUrlById } from "@/lib/storage";
import { syncLineBotInfo, syncLineUserProfile } from "@/lib/bms/lineProfile";
import {
  recordInboundEvent,
  recordWebhookVerifyFailed,
  recordOutboundSuccess,
  recordOutboundError,
  formatOutboundErrorDetail,
} from "@/lib/bms/channelHealth";
import { claimInboundEvent } from "@/lib/bms/inboundEvents";
import { reportBmsFailure } from "@/lib/bms/failureAlert";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: {
    id?: string;
    type: string;
    text?: string;
    fileName?: string;
    fileSize?: number;
    packageId?: string;
    stickerId?: string;
    title?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  };
};

const LINE_MEDIA_TYPES = new Set(["image", "video", "audio", "file"]);
const LINE_MEDIA_DEFAULTS: Record<string, { mimeType: string; extension: string; label: string }> = {
  image: { mimeType: "image/jpeg", extension: "jpg", label: "รูปภาพจาก LINE" },
  video: { mimeType: "video/mp4", extension: "mp4", label: "วิดีโอจาก LINE" },
  audio: { mimeType: "audio/m4a", extension: "m4a", label: "เสียงจาก LINE" },
  file: { mimeType: "application/octet-stream", extension: "bin", label: "ไฟล์จาก LINE" },
};
const LINE_INBOUND_MAX_BYTES = 10 * 1024 * 1024;

type LineChannelConfig = NonNullable<Awaited<ReturnType<typeof getChannel>>>;

function lineInboundBody(message: NonNullable<LineEvent["message"]>, hasAttachment: boolean): string {
  if (message.type === "location") {
    return [
      message.title,
      message.address,
      typeof message.latitude === "number" && typeof message.longitude === "number"
        ? `${message.latitude}, ${message.longitude}`
        : null,
    ].filter(Boolean).join("\n") || "[ตำแหน่งจาก LINE]";
  }
  if (message.type === "sticker") {
    return `[สติกเกอร์ LINE package:${message.packageId ?? "-"} sticker:${message.stickerId ?? "-"}]`;
  }
  if (hasAttachment) return "";
  const defaults = LINE_MEDIA_DEFAULTS[message.type];
  return defaults ? `[${defaults.label}]` : `[ข้อความ LINE ชนิด ${message.type}]`;
}

async function fetchLineInboundAttachment(
  tenantId: string,
  accessToken: string | null | undefined,
  message: NonNullable<LineEvent["message"]>
): Promise<Attachment | null> {
  if (!accessToken || !message.id || !LINE_MEDIA_TYPES.has(message.type)) return null;
  const defaults = LINE_MEDIA_DEFAULTS[message.type] ?? LINE_MEDIA_DEFAULTS.file;
  try {
    const resp = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(message.id)}/content`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return null;
    const len = Number(resp.headers.get("content-length") || "0");
    if (Number.isFinite(len) && len > LINE_INBOUND_MAX_BYTES) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > LINE_INBOUND_MAX_BYTES) return null;
    const mimeType = resp.headers.get("content-type")?.split(";", 1)[0]?.trim() || defaults.mimeType;
    const filename = message.fileName || `line-${message.type}-${message.id}.${defaults.extension}`;
    const row = await persistBuffer(buf, filename, mimeType, "private", tenantId);
    return { url: buildFileUrlById(row.id), name: row.original_name ?? filename, mimeType: row.mimetype ?? mimeType };
  } catch (error) {
    console.error("[BMS] LINE inbound media fetch failed:", error);
    return null;
  }
}

async function pushLineReply(
  tenantId: string,
  token: string,
  replyToken: string,
  text: string,
  customerRef?: string | null
) {
  try {
    const resp = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    });
    if (resp.ok) {
      await recordOutboundSuccess(tenantId, "line");
    } else {
      const detail = formatOutboundErrorDetail(resp, await resp.text().catch(() => ""));
      await recordOutboundError(tenantId, "line", resp.status, detail);
      // channel health บอกได้แค่ว่า "ช่องทางส่งไม่ออก" — ต้องแจ้งร้านด้วยเพราะ
      // ลูกค้ารายนี้ไม่ได้รับคำตอบเลย และต้องมีคนตามส่งซ้ำให้
      await reportBmsFailure({
        tenantId,
        code: "channel.push_failed",
        error: detail,
        surface: "customer",
        channel: "line",
        customerRef: customerRef ?? null,
        meta: { httpStatus: resp.status },
      });
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : "LINE reply request failed";
    await recordOutboundError(tenantId, "line", 500, detail).catch(() => {});
    console.error("[BMS] LINE push failed:", e);
    await reportBmsFailure({
      tenantId,
      code: "channel.push_failed",
      error: e,
      surface: "customer",
      channel: "line",
      customerRef: customerRef ?? null,
    });
  }
}

async function processLineEvent(
  tenantId: string,
  cfg: LineChannelConfig,
  ev: LineEvent
): Promise<{ replyToken?: string | null; handled?: boolean; duplicate?: boolean; logged?: string; reply?: string; error?: string }> {
  if (ev.type !== "message" || !ev.message) return { replyToken: ev.replyToken, handled: false };
  if (!(await claimInboundEvent(tenantId, "line", ev.message.id ?? ev.replyToken))) {
    return { replyToken: ev.replyToken, duplicate: true, handled: true };
  }

  const userId = ev.source?.userId ?? null;
  if (ev.message.type !== "text") {
    const attachment = await fetchLineInboundAttachment(tenantId, cfg.access_token, ev.message);
    await logInboundMessage(tenantId, "line", userId, {
      body: lineInboundBody(ev.message, Boolean(attachment)),
      attachment,
      meta: {
        type: ev.message.type,
        providerMessageId: ev.message.id ?? null,
        unsupportedForAi: true,
        raw: {
          fileName: ev.message.fileName,
          fileSize: ev.message.fileSize,
          packageId: ev.message.packageId,
          stickerId: ev.message.stickerId,
          hasAttachment: Boolean(attachment),
        },
      },
    });
    return { replyToken: ev.replyToken, logged: ev.message.type, handled: true };
  }

  const text = ev.message.text?.trim() ?? "";
  if (!text) return { replyToken: ev.replyToken, handled: false };
  try {
    const result = await runPipeline(text, "line", tenantId, userId);

    // บันทึกลง inbox (เข้า+ออก) — best-effort
    await logConversation(tenantId, "line", userId, text, result.reply, result.quality);

    // ตอบกลับด้วย token ของร้าน (ถ้ามี)
    if (cfg.access_token && ev.replyToken) {
      await pushLineReply(tenantId, cfg.access_token, ev.replyToken, result.reply, userId);
    }

    // Best-effort LINE profile cache. This is intentionally after the
    // Inbox write/reply path: profile sync must never block the sale-critical
    // message from appearing in Inbox.
    if (userId && cfg.access_token) {
      const profileSync = await syncLineUserProfile(tenantId, userId, cfg.access_token);
      if (profileSync.ok) {
        for (const conversationId of profileSync.conversationIds) {
          notifyInboxConversationChanged(tenantId, conversationId, "CONVERSATION_CHANGED");
        }
      } else if (!profileSync.skipped) {
        console.warn("[BMS] LINE profile sync skipped/failed:", {
          tenantId,
          status: profileSync.status,
          error: profileSync.error,
        });
      }
      const botInfoSync = await syncLineBotInfo(tenantId, cfg.access_token);
      if (!botInfoSync.ok && !botInfoSync.skipped) {
        console.warn("[BMS] LINE bot info sync skipped/failed:", {
          tenantId,
          status: botInfoSync.status,
          error: botInfoSync.error,
        });
      }
    }
    return { replyToken: ev.replyToken, reply: result.reply, handled: true };
  } catch (error) {
    const fallbackReply = "ขออภัยค่ะ ระบบขัดข้องชั่วคราว รบกวนลองใหม่อีกครั้งในสักครู่นะคะ 🙏";
    console.error("[BMS] LINE webhook event handling failed:", {
      tenantId,
      userId,
      messageId: ev.message?.id ?? null,
      error,
    });
    await reportBmsFailure({
      tenantId,
      code: "channel.reply_failed",
      error,
      surface: "customer",
      channel: "line",
      customerRef: userId,
      meta: { messageId: ev.message?.id ?? null },
    });
    await logConversation(tenantId, "line", userId, text, fallbackReply, fallbackEvidenceQuality(error));
    if (cfg.access_token && ev.replyToken) {
      await pushLineReply(tenantId, cfg.access_token, ev.replyToken, fallbackReply, userId);
    }
    return {
      replyToken: ev.replyToken,
      reply: fallbackReply,
      error: error instanceof Error ? error.message : "event handling failed",
      handled: true,
    };
  }
}

async function handlePOST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const tenantId = params.tenantId?.trim();
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });

  // rate limit ต่อร้าน (กัน abuse / flood)
  const rl = await rateLimit(`line:${tenantId}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  }

  const cfg = await getChannel(tenantId, "line");
  if (!cfg || !cfg.active) {
    // ยังไม่เชื่อม LINE — ตอบ 200 กัน LINE retry รัว ๆ
    return NextResponse.json({ ok: true, skipped: "channel not configured" });
  }

  // ต้องอ่าน raw body เพื่อ verify signature
  const raw = await req.text();
  // fail-closed: channel active ต้องมี channel_secret เสมอ ไม่งั้นใครก็ปลอม request เข้ามาได้
  // (เดิมข้ามการ verify ไปเลยถ้าไม่มี secret — เป็นช่องโหว่ ไม่ใช่ fallback ที่ตั้งใจ)
  if (!cfg.channel_secret) {
    await recordWebhookVerifyFailed(tenantId, "line");
    return NextResponse.json({ error: "channel secret not configured" }, { status: 401 });
  }
  const ok = verifyLineSignature(cfg.channel_secret, raw, req.headers.get("x-line-signature"));
  if (!ok) {
    await recordWebhookVerifyFailed(tenantId, "line");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  })() as { events?: LineEvent[] };
  const events = Array.isArray(body.events) ? body.events : [];

  // Until events have a durable work queue, keep processing within the request.
  // A later message in this batch must see the preceding turn's saved history.
  const replies = [];
  for (const ev of events) {
    replies.push(await processLineEvent(tenantId, cfg, ev));
  }
  if (replies.some((reply) => reply.handled)) await recordInboundEvent(tenantId, "line");

  return NextResponse.json({ ok: true, tenantId, replies });
}

export const POST = withRouteErrorLog("POST /api/bms/line/webhook/[tenantId]", handlePOST);

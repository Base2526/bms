// =============================================================
// BMS Channel Health — สถานะเชื่อมต่อจริงของแต่ละช่องทาง (tenant-scoped)
// -------------------------------------------------------------
// แยกจาก `active` ใน bms_tenant_channels (channels.ts) โดยเจตนา:
//   active   = สวิตช์ที่ admin กดเปิด/ปิดเอง
//   status   = สุขภาพจริงหลังตั้งค่าแล้ว (token หมดอายุ/webhook fail/rate limit/
//              ไม่มี event เข้า/ส่งไม่ได้) — คำนวณจาก error จริงที่เจอตอน
//              webhook เข้า/เรียก Send API เท่านั้น ไม่เดา
//
// เขียนผ่าน setChannelStatus() เท่านั้น (single entrypoint) — กัน log กระจาย
// ไม่ตรงกับ status จริงบนตาราง และกัน spam log ซ้ำถ้า status ไม่เปลี่ยน
//
// wire เข้าจุดจริงแล้ว (ดู CLAUDE.local.md § Channel Health สำหรับ list ทั้งหมด):
//   - webhook handler รับ event สำเร็จ      → recordInboundEvent()
//   - webhook signature verify ไม่ผ่าน      → recordWebhookVerifyFailed()
//   - เรียก Send API แล้วสำเร็จ              → recordOutboundSuccess()
//   - เรียก Send API แล้วโดน error           → recordOutboundError()
//   - cron ตรวจ "ไม่มี event เกิน X วัน"      → detectStaleChannels()
//   - admin กดปุ่ม "ทดสอบ" ในหน้า Settings   → testChannelConnection()
// =============================================================

import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { getChannel } from "./channels";

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";

export type ChannelHealthStatus =
  | "connected"
  | "token_expired"
  | "webhook_failed"
  | "rate_limited"
  | "no_events"
  | "send_failed";

export type ChannelHealth = {
  channel: string;
  active: boolean;
  status: ChannelHealthStatus;
  status_detail: string | null;
  last_error_at: string | null;
  last_inbound_event_at: string | null;
  last_outbound_success_at: string | null;
  last_checked_at: string | null;
};

/** ไม่มี event เข้าเกินกี่วัน ถึงจะถือว่า "no_events" (ใช้โดย detectStaleChannels) */
export const NO_EVENTS_THRESHOLD_DAYS = 3;

/**
 * ตั้ง status ใหม่ — เขียน log เฉพาะตอน status เปลี่ยนจริง (กัน spam ทุก webhook call)
 * ใช้ beginTenantTx เสมอ (แม้เรียกจาก webhook/cron ที่ไม่มี ctx ผู้ใช้) เพื่อให้ RLS บังคับใช้
 */
export async function setChannelStatus(
  tenantId: string,
  channel: string,
  status: ChannelHealthStatus,
  detail?: string | null
): Promise<void> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const cur = await client.query<{ status: ChannelHealthStatus }>(
      `SELECT status FROM bms_tenant_channels WHERE tenant_id = $1 AND channel = $2 FOR UPDATE`,
      [tenantId, channel]
    );
    const prevStatus = cur.rows[0]?.status;

    await client.query(
      `UPDATE bms_tenant_channels
          SET status = $3, status_detail = $4, last_checked_at = now(),
              last_error_at = CASE WHEN $3 <> 'connected' THEN now() ELSE last_error_at END
        WHERE tenant_id = $1 AND channel = $2`,
      [tenantId, channel, status, detail ?? null]
    );

    if (prevStatus !== undefined && prevStatus !== status) {
      await client.query(
        `INSERT INTO bms_channel_health_log (tenant_id, channel, status, detail)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, channel, status, detail ?? null]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/** webhook รับ event เข้าสำเร็จ — ตั้งเวลาล่าสุด + เคลียร์ no_events/webhook_failed กลับเป็นปกติ */
export async function recordInboundEvent(tenantId: string, channel: string): Promise<void> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    await client.query(
      `UPDATE bms_tenant_channels SET last_inbound_event_at = now() WHERE tenant_id = $1 AND channel = $2`,
      [tenantId, channel]
    );
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
  await setChannelStatus(tenantId, channel, "connected", null);
}

/** webhook signature verify ไม่ผ่าน (secret ผิด/เปลี่ยน) */
export async function recordWebhookVerifyFailed(
  tenantId: string,
  channel: string,
  detail?: string | null
): Promise<void> {
  await setChannelStatus(tenantId, channel, "webhook_failed", detail ?? "signature verify failed");
}

/** เรียก Send API สำเร็จ — เคลียร์ token_expired/rate_limited/send_failed กลับเป็นปกติ */
export async function recordOutboundSuccess(tenantId: string, channel: string): Promise<void> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    await client.query(
      `UPDATE bms_tenant_channels SET last_outbound_success_at = now() WHERE tenant_id = $1 AND channel = $2`,
      [tenantId, channel]
    );
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
  await setChannelStatus(tenantId, channel, "connected", null);
}

/**
 * สร้าง detail text จาก fetch Response ที่ error — แนบ Retry-After ของ platform ไว้ด้วยถ้ามี
 * (429 ส่วนใหญ่ส่ง header นี้กลับมาบอกว่าต้องรอกี่วินาที) ใช้ตอนเรียก recordOutboundError()
 */
export function formatOutboundErrorDetail(resp: Response, bodyText: string): string | null {
  const retryAfter = resp.headers.get("retry-after");
  const body = bodyText.slice(0, 300);
  const suffix = retryAfter ? ` (retry-after: ${retryAfter}s)` : "";
  const combined = `${body}${suffix}`.trim();
  return combined || null;
}

/** เรียก Send API แล้วโดน error — map httpStatus ของ platform เป็น status ที่เหมาะสม */
export async function recordOutboundError(
  tenantId: string,
  channel: string,
  httpStatus: number,
  detail?: string | null
): Promise<void> {
  const status: ChannelHealthStatus =
    httpStatus === 401 || httpStatus === 403
      ? "token_expired"
      : httpStatus === 429
      ? "rate_limited"
      : "send_failed";
  await setChannelStatus(tenantId, channel, status, detail ?? `HTTP ${httpStatus}`);
}

/** list สถานะทุกช่องทางของร้าน — ใช้แสดงหน้า Settings/Dashboard */
export async function listChannelHealth(tenantId: string): Promise<ChannelHealth[]> {
  const res = await query<ChannelHealth>(
    `SELECT channel, active, status, status_detail, last_error_at,
            last_inbound_event_at, last_outbound_success_at, last_checked_at
       FROM bms_tenant_channels WHERE tenant_id = $1 ORDER BY channel`,
    [tenantId]
  );
  return res.rows;
}

/** จำนวนช่องทางที่ active แต่สถานะไม่ปกติ — ใช้กับ badge sidebar (bmsChannelHealthCount) */
export async function countUnhealthyChannels(tenantId: string): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT COUNT(*) FROM bms_tenant_channels
      WHERE tenant_id = $1 AND active = true AND status <> 'connected'`,
    [tenantId]
  );
  return Number(res.rows[0]?.count ?? 0);
}

/**
 * cron: สแกนช่องทางที่ active + status ยัง 'connected' แต่ไม่มี event เข้าเกิน
 * NO_EVENTS_THRESHOLD_DAYS วัน → เปลี่ยนเป็น 'no_events' (ข้าม tenant ทั้งหมดถ้าไม่ระบุ tenantId)
 * ไม่ downgrade สถานะ error อื่น (token_expired/webhook_failed/...) ทับด้วย no_events
 */
export async function detectStaleChannels(tenantId?: string): Promise<{ tenantId: string; channel: string }[]> {
  const res = await query<{ tenant_id: string; channel: string }>(
    `SELECT tenant_id, channel FROM bms_tenant_channels
      WHERE active = true AND status = 'connected'
        AND ($1::uuid IS NULL OR tenant_id = $1)
        AND (
          (last_inbound_event_at IS NOT NULL AND last_inbound_event_at < now() - ($2 || ' days')::interval)
          OR (last_inbound_event_at IS NULL AND updated_at < now() - ($2 || ' days')::interval)
        )`,
    [tenantId ?? null, NO_EVENTS_THRESHOLD_DAYS]
  );

  const stale = res.rows.map((r) => ({ tenantId: r.tenant_id, channel: r.channel }));
  for (const { tenantId: tId, channel } of stale) {
    await setChannelStatus(
      tId,
      channel,
      "no_events",
      `ไม่มีข้อความเข้ามาเกิน ${NO_EVENTS_THRESHOLD_DAYS} วัน — ตรวจสอบ webhook URL ฝั่ง console ของแพลตฟอร์ม`
    );
  }
  return stale;
}

export type TestConnectionResult = { ok: boolean; message: string };

/**
 * ปุ่ม "ทดสอบ" ในหน้า Settings (เฉพาะช่องทางที่ active สถานะ 'connected') — เรียก endpoint
 * แบบ "verify token" ของแพลตฟอร์มที่ไม่ต้องมีผู้รับ (ไม่ต้องส่งข้อความหาลูกค้าจริง):
 *   LINE       → GET /v2/bot/info            (คืนชื่อบอทถ้า token ยังใช้ได้)
 *   FB/IG      → GET /me?access_token=...    (คืนชื่อเพจถ้า token ยังใช้ได้)
 * TikTok/Shopee/Lazada ไม่มี endpoint แบบนี้ (ไม่มี send API จริงด้วย — ดู docs/integrations/lazada.md)
 * และ Web ไม่มี token ให้ทดสอบ — คืน ok:false พร้อมข้อความอธิบายแทนที่จะเดา
 *
 * ผลการทดสอบ "จริง" ต่อ token ตอนนี้ — ใช้ recordOutboundSuccess()/recordOutboundError() เดิม
 * เพื่ออัปเดต status ให้ตรงกับผลจริงไปในตัว (เหมือน exercise Send API ครั้งหนึ่ง)
 */
export async function testChannelConnection(tenantId: string, channel: string): Promise<TestConnectionResult> {
  const cfg = await getChannel(tenantId, channel);
  if (!cfg || !cfg.access_token) {
    return { ok: false, message: "ยังไม่ได้ตั้งค่า Access Token — กรอกแล้วบันทึกก่อนทดสอบ" };
  }

  if (channel === "line") {
    try {
      const resp = await fetch("https://api.line.me/v2/bot/info", {
        headers: { authorization: `Bearer ${cfg.access_token}` },
      });
      const bodyText = await resp.text().catch(() => "");
      if (resp.ok) {
        await recordOutboundSuccess(tenantId, channel);
        const info = (() => { try { return JSON.parse(bodyText); } catch { return {}; } })();
        return { ok: true, message: `เชื่อมต่อสำเร็จ — บอท "${info.displayName || "LINE OA"}"` };
      }
      const detail = formatOutboundErrorDetail(resp, bodyText);
      await recordOutboundError(tenantId, channel, resp.status, detail);
      return { ok: false, message: detail || `เชื่อมต่อไม่สำเร็จ (HTTP ${resp.status})` };
    } catch (e: any) {
      return { ok: false, message: `เรียก LINE API ไม่สำเร็จ: ${e?.message || "unknown error"}` };
    }
  }

  if (channel === "facebook" || channel === "instagram") {
    try {
      const resp = await fetch(
        `https://graph.facebook.com/${META_GRAPH_VERSION}/me?access_token=${encodeURIComponent(cfg.access_token)}`
      );
      const bodyText = await resp.text().catch(() => "");
      if (resp.ok) {
        await recordOutboundSuccess(tenantId, channel);
        const info = (() => { try { return JSON.parse(bodyText); } catch { return {}; } })();
        return { ok: true, message: `เชื่อมต่อสำเร็จ — เพจ "${info.name || "ไม่ทราบชื่อ"}"` };
      }
      const detail = formatOutboundErrorDetail(resp, bodyText);
      await recordOutboundError(tenantId, channel, resp.status, detail);
      return { ok: false, message: detail || `เชื่อมต่อไม่สำเร็จ (HTTP ${resp.status})` };
    } catch (e: any) {
      return { ok: false, message: `เรียก Graph API ไม่สำเร็จ: ${e?.message || "unknown error"}` };
    }
  }

  return { ok: false, message: "ช่องทางนี้ยังไม่รองรับปุ่มทดสอบ (ไม่มี API ตรวจสอบ token โดยตรง — ดู docs/integrations/lazada.md)" };
}

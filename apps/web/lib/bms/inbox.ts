// =============================================================
// BMS Omnichannel Inbox — conversations, messages, notes, timeline
// -------------------------------------------------------------
// logConversation : hook จาก pipeline — บันทึกข้อความเข้า (ลูกค้า) + ออก (AI)
// list/get         : อ่านกล่องข้อความ + ประวัติแชท
// assign/tags/status/markRead : จัดการงานในทีม
// addNote/listNotes : โน้ตภายใน (ลูกค้าไม่เห็น)
// sendStaffMessage : แอดมินตอบเอง → persist + ยิงกลับช่องทาง (LINE push)
// getTimeline      : รวม message + note + order + system event เรียงตามเวลาที่เกิดจริง
//                    (ORDER = เวลาสร้างออร์เดอร์ · สถานะปัจจุบันอยู่ใน status/statusAt แยกกัน)
//
// tenant-scoped ทุก query; logConversation เป็น best-effort (ไม่ทำให้ webhook ล้ม)
// =============================================================

import { getClient, query } from "@/lib/db";
import { pubsub } from "@/lib/pubsub";
import {
  topicBmsInboxChanged,
  type BmsInboxChangedPayload,
} from "../../../../packages/graphql-core/src/bmsInboxSync";
import { getChannel } from "./channels";
import { recordOutboundSuccess, recordOutboundError, formatOutboundErrorDetail } from "./channelHealth";
import { createNotification } from "@/lib/notifications/service";
import { assignCouponToCustomer, couponCodeFromShareText, createCouponWalletToken } from "./coupons";
import { beginTenantTx } from "./tenant";
import { enqueueAiQualityReview, type AiTurnQuality } from "./aiQuality";

export type ConvStatus = "OPEN" | "PENDING" | "CLOSED";

let lastInboxRealtimeErrorAt = 0;

function publishInboxChanged(
  tenantId: string,
  conversationId: string,
  kind: BmsInboxChangedPayload["kind"]
): void {
  const event: BmsInboxChangedPayload = {
    tenantId,
    conversationId,
    kind,
    occurredAt: new Date().toISOString(),
  };
  // Do not make a channel webhook wait on Redis. Realtime is a delivery
  // optimization, never the source of truth; polling recovers a missed event.
  void pubsub.publish(topicBmsInboxChanged(tenantId), { bmsInboxChanged: event }).catch((error) => {
    const now = Date.now();
    if (now - lastInboxRealtimeErrorAt >= 60_000) {
      lastInboxRealtimeErrorAt = now;
      console.error("[BMS] inbox realtime publish failed:", error);
    }
  });
}

export function notifyInboxConversationChanged(
  tenantId: string,
  conversationId: string,
  kind: BmsInboxChangedPayload["kind"] = "CONVERSATION_CHANGED"
): void {
  publishInboxChanged(tenantId, conversationId, kind);
}

export type Attachment = { url: string; name?: string | null; mimeType?: string | null };

export function isImageMime(mime?: string | null): boolean {
  return !!mime && /^image\//i.test(mime);
}

/** ข้อความสำหรับ preview/timeline — body ว่างได้ถ้าเป็น attachment ล้วน จึงต้องมี placeholder */
export function messagePreview(body: string | null | undefined, att?: Attachment | null): string {
  const text = (body ?? "").trim();
  if (text) return text;
  if (!att?.url) return "";
  return isImageMime(att.mimeType) ? "[รูปภาพ]" : `[ไฟล์] ${att.name ?? ""}`.trim();
}

// ช่องที่ push ออกได้จริง (มี API ส่ง) → FAILED มีความหมาย
// web/tiktok/test = ไม่ push (widget poll / ยังไม่มี API) → ถือว่า SENT เมื่อ persist สำเร็จ
export function channelSupportsPush(channel: string): boolean {
  return channel === "line" || channel === "facebook" || channel === "instagram";
}

/** สถานะ outbound (Phase 1): push channel → delivered?SENT:FAILED · อื่น → SENT (บันทึกแล้ว) */
export function outboundStatus(channel: string, delivered: boolean): "SENT" | "FAILED" {
  if (!channelSupportsPush(channel)) return "SENT";
  return delivered ? "SENT" : "FAILED";
}

/** แปลง url ให้เป็น absolute https (สำหรับ push ออกช่องทางภายนอก เช่น LINE/Meta) */
function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!base) return url;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`.replace(":443/", "/");
}

// ---- hook: บันทึกบทสนทนา (เรียกจาก pipeline หลังได้ reply) ---------
/**
 * บันทึกข้อความเข้า (ลูกค้า) + ออก (AI) ลง inbox
 * ข้ามถ้าไม่มี customerRef หรือเป็น channel ทดสอบ (playground)
 * ห้าม throw — ครอบ try/catch ใน caller อยู่แล้ว แต่กันไว้อีกชั้น
 */
export async function logConversation(
  tenantId: string,
  channel: string,
  customerRef: string | null,
  incoming: string,
  reply: string,
  quality?: AiTurnQuality
): Promise<void> {
  if (!customerRef || channel === "test") return;
  try {
    // best-effort link ลูกค้า (ถ้าเคยสั่งซื้อ/มี identity แล้ว)
    const cust = await query<{ customer_id: string }>(
      `SELECT customer_id FROM bms_customer_identities
        WHERE tenant_id = $1 AND channel = $2 AND external_ref = $3 LIMIT 1`,
      [tenantId, channel, customerRef]
    );
    const customerId = cust.rows[0]?.customer_id ?? null;

    // upsert conversation — (xmax = 0) บอกว่าเป็น INSERT จริง (ไม่ใช่ไปเข้า DO UPDATE)
    // ใช้แยกว่าควร auto-assign staff หลักไหม (ครั้งแรกที่ลูกค้าทักเท่านั้น ไม่ใช่ทุกข้อความ)
    const conv = await query<{ id: string; inserted: boolean }>(
      `INSERT INTO bms_conversations
         (tenant_id, channel, customer_ref, customer_id, status, unread, last_message, last_message_at)
       VALUES ($1, $2, $3, $4, 'OPEN', 1, $5, now())
       ON CONFLICT (tenant_id, channel, customer_ref) DO UPDATE
         SET unread = bms_conversations.unread + 1,
             last_message = EXCLUDED.last_message,
             last_message_at = now(),
             customer_id = COALESCE(bms_conversations.customer_id, EXCLUDED.customer_id),
             status = CASE WHEN bms_conversations.status = 'CLOSED' THEN 'OPEN' ELSE bms_conversations.status END,
             updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [tenantId, channel, customerRef, customerId, incoming.slice(0, 500)]
    );
    const convId = conv.rows[0].id;

    const messages = await query<{ id: string; direction: "IN" | "OUT" }>(
      `INSERT INTO bms_messages (tenant_id, conversation_id, direction, body, sender, meta)
       VALUES
         ($1, $2, 'IN', $3, 'customer', '{}'::jsonb),
         ($1, $2, 'OUT', $4, 'ai', $5::jsonb)
       RETURNING id, direction`,
      [
        tenantId,
        convId,
        incoming,
        reply,
        JSON.stringify(quality ? { aiQuality: quality } : {}),
      ]
    );
    const aiMessage = messages.rows.find((message) => message.direction === "OUT");
    if (quality && aiMessage) {
      try {
        await enqueueAiQualityReview(tenantId, convId, String(aiMessage.id), quality);
      } catch (error) {
        // Quality analytics must never block Inbox assignment/realtime delivery.
        console.error("[BMS] AI quality enqueue failed:", error);
      }
    }

    if (conv.rows[0].inserted) {
      await autoAssignConversation(tenantId, convId);
    }
    publishInboxChanged(tenantId, convId, "MESSAGES_CHANGED");
  } catch (e) {
    console.error("[BMS] logConversation failed:", e);
  }
}

export type DiagnosticInboxMessageResult = {
  conversationId: string;
  messageId: string;
  channel: string;
  customerRef: string;
  occurredAt: string;
};

export type DiagnosticInboxLatest = {
  channel: string;
  conversationId: string;
  customerRef: string;
  lastInboundAt: string;
};

/**
 * สร้างข้อความทดสอบใน Inbox จริง โดยไม่เรียก pipeline และไม่ push ออกแพลตฟอร์ม.
 * ใช้กับหน้า Realtime Diagnostics เพื่อทดสอบ DB write → realtime → Inbox UI end-to-end.
 */
export async function createDiagnosticInboxMessage(
  tenantId: string,
  channel: string,
  actorId: string,
  body?: string | null
): Promise<DiagnosticInboxMessageResult> {
  const customerRef = `diagnostic:${channel}:${actorId}`;
  const messageBody = (body || "").trim() || `[DIAGNOSTIC] ข้อความทดสอบจาก ${channel} ${new Date().toLocaleString("th-TH")}`;

  const conv = await query<{ id: string; inserted: boolean }>(
    `INSERT INTO bms_conversations
       (tenant_id, channel, customer_ref, customer_id, status, unread, last_message, last_message_at)
     VALUES ($1, $2, $3, NULL, 'OPEN', 1, $4, now())
     ON CONFLICT (tenant_id, channel, customer_ref) DO UPDATE
       SET unread = bms_conversations.unread + 1,
           last_message = EXCLUDED.last_message,
           last_message_at = now(),
           status = CASE WHEN bms_conversations.status = 'CLOSED' THEN 'OPEN' ELSE bms_conversations.status END,
           updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [tenantId, channel, customerRef, messageBody.slice(0, 500)]
  );

  const conversationId = conv.rows[0].id;
  const msg = await query<{ id: string; created_at: Date | string }>(
    `INSERT INTO bms_messages (tenant_id, conversation_id, direction, body, sender, meta)
     VALUES ($1, $2, 'IN', $3, 'diagnostic', $4)
     RETURNING id, created_at`,
    [tenantId, conversationId, messageBody, JSON.stringify({ diagnostic: true, channel, actorId })]
  );

  if (conv.rows[0].inserted) {
    await autoAssignConversation(tenantId, conversationId);
  }

  publishInboxChanged(tenantId, conversationId, "MESSAGES_CHANGED");

  const occurredAt = msg.rows[0].created_at instanceof Date
    ? msg.rows[0].created_at.toISOString()
    : String(msg.rows[0].created_at);

  return {
    conversationId,
    messageId: msg.rows[0].id,
    channel,
    customerRef,
    occurredAt,
  };
}

export async function listDiagnosticInboxLatest(tenantId: string): Promise<DiagnosticInboxLatest[]> {
  const res = await query<{ channel: string; conversation_id: string; customer_ref: string; created_at: Date | string }>(
    `SELECT DISTINCT ON (c.channel)
            c.channel,
            c.id AS conversation_id,
            c.customer_ref,
            m.created_at
       FROM bms_conversations c
       JOIN bms_messages m ON m.tenant_id = c.tenant_id AND m.conversation_id = c.id
      WHERE c.tenant_id = $1
        AND c.customer_ref LIKE 'diagnostic:%'
        AND m.direction = 'IN'
        AND m.sender = 'diagnostic'
        AND COALESCE((m.meta->>'diagnostic')::boolean, false) = true
      ORDER BY c.channel, m.created_at DESC, m.id DESC`,
    [tenantId]
  );
  return res.rows.map((r) => ({
    channel: r.channel,
    conversationId: r.conversation_id,
    customerRef: r.customer_ref,
    lastInboundAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/** เลือก staff หลักให้แชทใหม่: Sales ที่ว่าง ถือแชท OPEN/PENDING น้อยสุดก่อน
 *  ไม่มี Sales ว่างเลย → ตกไป Manager → Administrator (กันไม่ให้แชทไม่มี staff)
 *  excludeUserId ใช้ตอนกำลังจะลบ/ปิดใช้งาน user คนหนึ่ง — กันเลือกกลับไปหาคนเดิม */
async function pickAutoAssignee(tenantId: string, excludeUserId?: string): Promise<string | null> {
  for (const roleName of ["Sales", "Manager", "Administrator"]) {
    const res = await query<{ id: string }>(
      `SELECT u.id
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.tenant_id = $1 AND r.name = $2 AND u.is_available = true
          AND ($3::uuid IS NULL OR u.id <> $3)
        ORDER BY ${WORKLOAD_COUNT_SQL} ASC, u.created_at ASC
        LIMIT 1`,
      [tenantId, roleName, excludeUserId ?? null]
    );
    if (res.rowCount) return res.rows[0].id;
  }
  return null;
}

/** รายชื่อ staff ที่ auto-assign เลือกได้ (tier เดียวกับ pickAutoAssignee: Sales ว่าง → Manager → Administrator)
 *  ไม่มี ORDER BY ตามภาระงาน — ใช้กรณี bulk seed/round-robin ที่ query ทีละแถวไม่คุ้ม (เช่น fake data) */
export async function listAutoAssignPool(tenantId: string): Promise<string[]> {
  for (const roleName of ["Sales", "Manager", "Administrator"]) {
    const res = await query<{ id: string }>(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.tenant_id = $1 AND r.name = $2 AND u.is_available = true
        ORDER BY u.created_at`,
      [tenantId, roleName]
    );
    if (res.rowCount) return res.rows.map((r) => r.id);
  }
  return [];
}

/** โอนแชท OPEN/PENDING ทั้งหมดออกจาก user คนหนึ่ง — เรียกก่อนลบ user เสมอ กันแชทค้างไม่มี staff
 *  คืนจำนวนแชทที่โอนสำเร็จ (แชทที่โอนไม่ได้เพราะร้านเหลือ staff คนเดียว จะไม่ถูกแตะ) */
export async function reassignStaffConversations(tenantId: string, fromUserId: string): Promise<number> {
  const convs = await query<{ id: string }>(
    `SELECT id FROM bms_conversations
      WHERE tenant_id = $1 AND assigned_to_user_id = $2 AND status IN ('OPEN','PENDING')`,
    [tenantId, fromUserId]
  );
  let moved = 0;
  for (const { id } of convs.rows) {
    const staffId = await pickAutoAssignee(tenantId, fromUserId);
    if (!staffId) continue;
    await query(
      `UPDATE bms_conversations SET assigned_to_user_id = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, staffId]
    );
    // ถ้าคนใหม่เคยเป็นผู้ช่วยตอบของแชทนี้อยู่ → ถอดออก (กันซ้ำสองบทบาท)
    await query(
      `DELETE FROM bms_conversation_helpers WHERE tenant_id = $1 AND conversation_id = $2 AND user_id = $3`,
      [tenantId, id, staffId]
    );
    await query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1, 'system:reassign-on-delete', 'inbox.assign', $2, $3)`,
      [tenantId, id, JSON.stringify({ toUserId: staffId, fromUserId, auto: true, reason: "staff_removed" })]
    );
    moved++;
  }
  return moved;
}

async function autoAssignConversation(tenantId: string, conversationId: string): Promise<void> {
  const staffId = await pickAutoAssignee(tenantId);
  if (!staffId) return; // ร้านนี้ยังไม่มี staff เลยสักคน — ปล่อยว่างไว้ก่อน (edge case ร้านเพิ่งสมัคร)
  await query(
    `UPDATE bms_conversations SET assigned_to_user_id = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, conversationId, staffId]
  );
  await query(
    `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
     VALUES ($1, 'system:auto-assign', 'inbox.assign', $2, $3)`,
    [tenantId, conversationId, JSON.stringify({ toUserId: staffId, auto: true })]
  );
}

// ---- read ----------------------------------------------------
export async function listConversations(
  tenantId: string,
  // assignedTo = user id ของ staff (แทน staff หลัก หรือช่วยตอบก็ติด filter นี้ได้ — ใช้ทำ filter "ของฉัน")
  opts: { status?: string | null; assignedTo?: string | null; tag?: string | null; search?: string | null; limit?: number; offset?: number } = {}
) {
  const limit = Math.min(Math.max(Number(opts.limit ?? 50), 1), 200);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const search = opts.search?.trim() || null;
  const res = await query(
    `SELECT c.id, c.channel, c.customer_ref, c.customer_id, c.status,
            c.assigned_to_user_id, au.name AS assigned_name, au.avatar AS assigned_avatar,
            c.tags, c.unread, c.last_message, c.last_message_at, c.created_at, c.updated_at,
            COALESCE(NULLIF(cu.name, c.customer_ref), ci.display_name) AS customer_name,
            ci.picture_url AS customer_avatar,
            tc.extra->>'botDisplayName' AS source_display_name,
            tc.extra->>'botBasicId' AS source_handle,
            tc.extra->>'botPictureUrl' AS source_avatar
       FROM bms_conversations c
       LEFT JOIN bms_customers cu ON cu.id = c.customer_id
       LEFT JOIN bms_customer_identities ci
         ON ci.tenant_id = c.tenant_id AND ci.channel = c.channel AND ci.external_ref = c.customer_ref
       LEFT JOIN bms_tenant_channels tc
         ON tc.tenant_id = c.tenant_id AND tc.channel = c.channel
       LEFT JOIN users au ON au.id = c.assigned_to_user_id
      WHERE c.tenant_id = $1
        AND ($2::text IS NULL OR c.status = $2)
        AND ($3::uuid IS NULL OR c.assigned_to_user_id = $3
             OR EXISTS (SELECT 1 FROM bms_conversation_helpers h WHERE h.conversation_id = c.id AND h.user_id = $3))
        AND ($4::text IS NULL OR $4 = ANY(c.tags))
        AND (
          $5::text IS NULL
          OR c.last_message ILIKE '%'||$5||'%'
          OR cu.name ILIKE '%'||$5||'%'
          OR ci.display_name ILIKE '%'||$5||'%'
          OR c.customer_ref ILIKE '%'||$5||'%'
          OR EXISTS (
            SELECT 1
              FROM bms_messages m
             WHERE m.tenant_id = c.tenant_id
               AND m.conversation_id = c.id
               AND m.body ILIKE '%'||$5||'%'
          )
        )
      ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
      LIMIT $6 OFFSET $7`,
    [tenantId, opts.status ?? null, opts.assignedTo ?? null, opts.tag ?? null, search, limit, offset]
  );
  return res.rows;
}

/** จำนวนแชทที่ยังไม่อ่านรวม (เฉพาะ OPEN/PENDING) — ใช้ทำ badge บนเมนู Inbox
 *  assignedTo (ถ้ามี) = scope เดียวกับ listConversations (Sales เห็นแค่ของตัวเอง) */
export async function countUnreadConversations(tenantId: string, assignedTo?: string | null): Promise<number> {
  const res = await query<{ total: string }>(
    `SELECT COUNT(*) AS total
       FROM bms_conversations c
      WHERE c.tenant_id = $1
        AND c.status IN ('OPEN','PENDING')
        AND c.unread > 0
        AND ($2::uuid IS NULL OR c.assigned_to_user_id = $2
             OR EXISTS (SELECT 1 FROM bms_conversation_helpers h WHERE h.conversation_id = c.id AND h.user_id = $2))`,
    [tenantId, assignedTo ?? null]
  );
  return Number(res.rows[0]?.total ?? 0);
}

export async function getConversation(tenantId: string, id: string) {
  const res = await query(
    `SELECT c.id, c.channel, c.customer_ref, c.customer_id, c.status,
            c.assigned_to_user_id, au.name AS assigned_name, au.avatar AS assigned_avatar, au.email AS assigned_email,
            c.tags, c.unread, c.last_message, c.last_message_at, c.created_at, c.updated_at,
            COALESCE(NULLIF(cu.name, c.customer_ref), ci.display_name) AS customer_name,
            ci.picture_url AS customer_avatar,
            tc.extra->>'botDisplayName' AS source_display_name,
            tc.extra->>'botBasicId' AS source_handle,
            tc.extra->>'botPictureUrl' AS source_avatar
       FROM bms_conversations c
       LEFT JOIN bms_customers cu ON cu.id = c.customer_id
       LEFT JOIN bms_customer_identities ci
         ON ci.tenant_id = c.tenant_id AND ci.channel = c.channel AND ci.external_ref = c.customer_ref
       LEFT JOIN bms_tenant_channels tc
         ON tc.tenant_id = c.tenant_id AND tc.channel = c.channel
       LEFT JOIN users au ON au.id = c.assigned_to_user_id
      WHERE c.tenant_id = $1 AND c.id = $2`,
    [tenantId, id]
  );
  return res.rows[0] ?? null;
}

export async function listMessages(tenantId: string, conversationId: string, limit = 200) {
  const lim = Math.min(Math.max(limit, 1), 500);
  const res = await query(
    `SELECT id, direction, body, sender, meta, created_at
       FROM (
         SELECT id, direction, body, sender, meta, created_at
           FROM bms_messages
          WHERE tenant_id = $1 AND conversation_id = $2
          ORDER BY created_at DESC, id DESC
          LIMIT $3
       ) recent
      ORDER BY created_at, id`,
    [tenantId, conversationId, lim]
  );
  return res.rows;
}

export type AiHistoryTurn = { role: "user" | "assistant"; content: string };

/**
 * หา conversation id ของลูกค้าคนนี้ (ถ้ามีแล้ว) — ใช้ร่วมกันระหว่าง getRecentAiHistory และ
 * bumpAiTurnCounter กันเสียเวลา query ซ้ำ คืน null ถ้ายังไม่เคยมีบทสนทนา (ข้อความแรกของลูกค้า)
 * หรือเป็น channel "test" (playground ไม่ persist อยู่แล้วเหมือน logConversation)
 */
export async function resolveConversationId(
  tenantId: string,
  channel: string,
  customerRef: string | null | undefined
): Promise<string | null> {
  if (!customerRef || channel === "test") return null;
  const conv = await query<{ id: string }>(
    `SELECT id FROM bms_conversations WHERE tenant_id = $1 AND channel = $2 AND customer_ref = $3 LIMIT 1`,
    [tenantId, channel, customerRef]
  );
  return conv.rows[0]?.id ?? null;
}

/**
 * P0 — ดึงบทสนทนาล่าสุดของลูกค้าคนนี้ (ไม่รวมข้อความปัจจุบัน) แปลงเป็น alternating user/assistant
 * เพื่อป้อนกลับเข้า AI tool loop (เดิม pipeline.ts ส่งแค่ข้อความปัจจุบันข้อความเดียว ทำให้ AI ไม่เห็น
 * เลยว่าตัวเองเพิ่งถามอะไรไปเมื่อ turn ก่อนหน้า) รับ convId ที่ resolve ไว้แล้ว (null = ยังไม่มีบทสนทนา)
 */
export async function getRecentAiHistory(
  tenantId: string,
  convId: string | null,
  maxMessages = 20
): Promise<AiHistoryTurn[]> {
  if (!convId) return [];

  const res = await query<{ direction: "IN" | "OUT"; body: string }>(
    `SELECT direction, body FROM bms_messages
      WHERE tenant_id = $1 AND conversation_id = $2 AND sender <> 'diagnostic'
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [tenantId, convId, Math.min(Math.max(maxMessages, 1), 100)]
  );

  const turns: AiHistoryTurn[] = [];
  for (const row of res.rows.reverse()) {
    const text = (row.body || "").trim();
    if (!text) continue;
    const role: "user" | "assistant" = row.direction === "IN" ? "user" : "assistant";
    const last = turns[turns.length - 1];
    // Claude API ต้องการ role สลับ user/assistant เสมอ — merge ข้อความติดกัน role เดียวกัน
    // (เช่น staff ตอบเองหลายข้อความติดกัน) กัน error strict alternation
    if (last && last.role === role) {
      last.content += `\n${text}`;
    } else {
      turns.push({ role, content: text });
    }
  }
  return turns;
}

export type AiConversationState = {
  product?: string | null;
  size?: string | null;
  qty?: number | null;
  confirmed?: boolean;
  lastIntent?: string | null;
  lastAskedField?: string | null;
  updatedAt?: string;
};

export async function getAiConversationState(
  tenantId: string,
  convId: string | null
): Promise<AiConversationState> {
  if (!convId) return {};
  const result = await query<{ ai_state: AiConversationState }>(
    `SELECT ai_state FROM bms_conversations WHERE tenant_id = $1 AND id = $2`,
    [tenantId, convId]
  );
  const state = result.rows[0]?.ai_state;
  return state && typeof state === "object" && !Array.isArray(state) ? state : {};
}

export async function setAiConversationState(
  tenantId: string,
  convId: string,
  state: AiConversationState
): Promise<void> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    await client.query(
      `UPDATE bms_conversations
          SET ai_state = $3::jsonb, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, convId, JSON.stringify({ ...state, updatedAt: new Date().toISOString() })]
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * P1 — Turn/Handoff counter (migration 7.28, bms_conversations.ai_consecutive_askbacks)
 * reset=true → กลับเป็น 0 (มีความคืบหน้าจริง เช่น create_order/submit_payment สำเร็จ)
 * reset=false → +1 (AI ตอบไปแต่ไม่คืบหน้า) คืนค่าใหม่หลังอัปเดตให้ caller เทียบ threshold เอง
 */
export async function bumpAiTurnCounter(tenantId: string, convId: string, reset: boolean): Promise<number> {
  const res = await query<{ ai_consecutive_askbacks: number }>(
    `UPDATE bms_conversations
        SET ai_consecutive_askbacks = CASE WHEN $3 THEN 0 ELSE ai_consecutive_askbacks + 1 END,
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING ai_consecutive_askbacks`,
    [tenantId, convId, reset]
  );
  return res.rows[0]?.ai_consecutive_askbacks ?? 0;
}

// ---- manage --------------------------------------------------
// เปลี่ยน staff หลัก — ต้องมี user จริงเสมอ (ทุก conversation ห้ามไม่มี staff)
// ถ้า user คนนี้เคยเป็นผู้ช่วยตอบอยู่ → ถอดออก (เลื่อนขึ้นเป็นเจ้าของแล้ว ห้ามซ้ำสองบทบาท)
export async function assignConversation(tenantId: string, id: string, userId: string): Promise<boolean> {
  const res = await query(
    `UPDATE bms_conversations SET assigned_to_user_id = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, userId]
  );
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) {
    await query(
      `DELETE FROM bms_conversation_helpers WHERE tenant_id = $1 AND conversation_id = $2 AND user_id = $3`,
      [tenantId, id, userId]
    );
    publishInboxChanged(tenantId, id, "CONVERSATION_CHANGED");
  }
  return ok;
}

// ---- staff picker + คนช่วยตอบ (helpers) -----------------------
// จำนวนแชท OPEN/PENDING ที่ user ถืออยู่ = เจ้าของหลัก + ผู้ช่วยตอบ (นับ conversation ไม่ให้ซ้ำ)
// ใช้ถ่วงน้ำหนัก auto-assign + โชว์ใน dropdown — ต้องอยู่ในบริบทที่มี alias u (users) และ $1 = tenant_id
const WORKLOAD_COUNT_SQL = `(
  SELECT COUNT(*) FROM bms_conversations c
   WHERE c.tenant_id = $1 AND c.status IN ('OPEN','PENDING')
     AND (c.assigned_to_user_id = u.id
          OR EXISTS (SELECT 1 FROM bms_conversation_helpers h WHERE h.conversation_id = c.id AND h.user_id = u.id))
)`;

/** รายชื่อ staff ที่มอบหมาย/เพิ่มเป็นคนช่วยตอบได้ (Sales/Manager/Administrator — ไม่รวม Warehouse)
 *  พร้อมจำนวนแชท OPEN/PENDING ที่ถืออยู่ (หลัก+ช่วยตอบ) ใช้เรียงลำดับใน dropdown (คนว่างขึ้นก่อน) */
export async function listAssignableStaff(tenantId: string) {
  const res = await query(
    `SELECT u.id, u.name, u.avatar, u.email, r.name AS role, u.is_available,
            ${WORKLOAD_COUNT_SQL}::int AS open_count
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1 AND r.name IN ('Sales','Manager','Administrator')
      ORDER BY open_count ASC, u.name ASC NULLS LAST`,
    [tenantId]
  );
  return res.rows;
}

export async function addConversationHelper(tenantId: string, id: string, userId: string, addedBy: string | null): Promise<boolean> {
  const res = await query(
    `INSERT INTO bms_conversation_helpers (tenant_id, conversation_id, user_id, added_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (conversation_id, user_id) DO NOTHING`,
    [tenantId, id, userId, addedBy]
  );
  if ((res.rowCount ?? 0) > 0) publishInboxChanged(tenantId, id, "CONVERSATION_CHANGED");
  return true;
}

export async function removeConversationHelper(tenantId: string, id: string, userId: string): Promise<boolean> {
  const res = await query(
    `DELETE FROM bms_conversation_helpers WHERE tenant_id = $1 AND conversation_id = $2 AND user_id = $3`,
    [tenantId, id, userId]
  );
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) publishInboxChanged(tenantId, id, "CONVERSATION_CHANGED");
  return ok;
}

export async function listConversationHelpers(tenantId: string, id: string) {
  const res = await query(
    `SELECT u.id, u.name, u.avatar, u.email
       FROM bms_conversation_helpers h
       JOIN users u ON u.id = h.user_id
      WHERE h.tenant_id = $1 AND h.conversation_id = $2
      ORDER BY h.added_at`,
    [tenantId, id]
  );
  return res.rows;
}

export async function setUserAvailability(userId: string, available: boolean): Promise<boolean> {
  const res = await query(`UPDATE users SET is_available = $2 WHERE id = $1`, [userId, available]);
  return (res.rowCount ?? 0) > 0;
}

// ---- system events (แทรกในสายแชท) ----------------------------
// รวม event มอบหมาย/ช่วยตอบ/เปลี่ยนสถานะ จาก bms_audit_log (target = conversation id)
// resolve ชื่อคนจาก UUID/email → ชื่อจริง เพื่อให้ frontend ประกอบข้อความเองได้
export type SystemEvent = {
  id: string;
  kind: "assign" | "helper_add" | "helper_remove" | "status";
  at: string;
  actorName: string;          // ใครเป็นคนทำ ("ระบบ" ถ้า auto)
  targetName: string | null;  // ผู้ถูกมอบหมาย/ช่วยตอบ (assign/helper)
  statusValue: string | null; // สถานะใหม่ (kind=status)
  auto: boolean;
};

export async function listSystemEvents(tenantId: string, conversationId: string, limit = 50): Promise<SystemEvent[]> {
  const lim = Math.min(Math.max(Number(limit || 50), 1), 200);
  const res = await query<{ id: string; actor: string | null; action: string; meta: any; created_at: any }>(
    `SELECT id, actor, action, meta, created_at
       FROM (
         SELECT id, actor, action, meta, created_at
           FROM bms_audit_log
          WHERE tenant_id = $1 AND target = $2
            AND action IN ('inbox.assign','inbox.helper_add','inbox.helper_remove','inbox.status')
          ORDER BY created_at DESC, id DESC
          LIMIT $3
       ) recent
      ORDER BY created_at, id`,
    [tenantId, conversationId, lim]
  );
  if (res.rowCount === 0) return [];

  // เก็บ id/email ที่ต้อง resolve เป็นชื่อ
  const userIds = new Set<string>();
  const emails = new Set<string>();
  for (const r of res.rows) {
    const m = r.meta || {};
    [m.toUserId, m.fromUserId, m.userId].forEach((x: string) => x && userIds.add(x));
    if (r.actor && !r.actor.startsWith("system:") && r.actor.includes("@")) emails.add(r.actor);
  }
  const nameById = new Map<string, string>();
  const nameByEmail = new Map<string, string>();
  if (userIds.size) {
    const u = await query<{ id: string; name: string | null; email: string | null }>(
      `SELECT id, name, email FROM users WHERE id = ANY($1::uuid[])`, [[...userIds]]
    );
    u.rows.forEach((x) => nameById.set(x.id, x.name || x.email || x.id));
  }
  if (emails.size) {
    const u = await query<{ email: string; name: string | null }>(
      `SELECT email, name FROM users WHERE email = ANY($1::text[])`, [[...emails]]
    );
    u.rows.forEach((x) => nameByEmail.set(x.email, x.name || x.email));
  }

  const toISO = (d: any) => (d instanceof Date ? d.toISOString() : String(d));
  const nameOf = (id?: string) => (id ? (nameById.get(id) ?? "ผู้ใช้ที่ถูกลบ") : "ไม่ทราบ");

  return res.rows.map((r) => {
    const m = r.meta || {};
    const auto = m.auto === true || (r.actor?.startsWith("system:") ?? false);
    const actorName = r.actor?.startsWith("system:") ? "ระบบ" : (nameByEmail.get(r.actor ?? "") ?? r.actor ?? "ไม่ทราบ");
    let kind: SystemEvent["kind"] = "assign";
    let targetName: string | null = null;
    let statusValue: string | null = null;
    if (r.action === "inbox.assign") { kind = "assign"; targetName = nameOf(m.toUserId); }
    else if (r.action === "inbox.helper_add") { kind = "helper_add"; targetName = nameOf(m.userId); }
    else if (r.action === "inbox.helper_remove") { kind = "helper_remove"; targetName = nameOf(m.userId); }
    else if (r.action === "inbox.status") { kind = "status"; statusValue = m.status ?? null; }
    return { id: String(r.id), kind, at: toISO(r.created_at), actorName, targetName, statusValue, auto };
  });
}

export async function setConversationStatus(tenantId: string, id: string, status: ConvStatus): Promise<boolean> {
  if (!["OPEN", "PENDING", "CLOSED"].includes(status)) return false;
  const res = await query(
    `UPDATE bms_conversations SET status = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, status]
  );
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) publishInboxChanged(tenantId, id, "CONVERSATION_CHANGED");
  return ok;
}

export async function setConversationTags(tenantId: string, id: string, tags: string[]): Promise<boolean> {
  const clean = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean))).slice(0, 30);
  const res = await query(
    `UPDATE bms_conversations SET tags = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, clean]
  );
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) publishInboxChanged(tenantId, id, "CONVERSATION_CHANGED");
  return ok;
}

export async function markRead(tenantId: string, id: string): Promise<boolean> {
  const res = await query(
    `UPDATE bms_conversations SET unread = 0, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) publishInboxChanged(tenantId, id, "CONVERSATION_CHANGED");
  return ok;
}

// ---- notes (internal) ----------------------------------------
// mentionedUserIds มาจาก @picker ฝั่ง client ตรงๆ (ไม่ regex-parse body) — กัน
// ปัญหาชื่อซ้ำ/สะกดผิด; "@ชื่อ" ใน body เป็นแค่ข้อความ display เฉยๆ
export async function addNote(
  tenantId: string,
  id: string,
  author: string | null,
  body: string,
  mentionedUserIds?: string[] | null
) {
  const text = body.trim();
  if (!text) return null;
  const res = await query(
    `INSERT INTO bms_conversation_notes (tenant_id, conversation_id, author, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, author, body, created_at`,
    [tenantId, id, author, text]
  );
  const note = res.rows[0];
  note.mentionedUserIds = note && mentionedUserIds?.length
    ? await notifyMentionedStaff(tenantId, id, note as { id: string | number; body: string }, mentionedUserIds, author)
    : [];
  publishInboxChanged(tenantId, id, "CONVERSATION_CHANGED");
  return note;
}

// รับ mentionedUserIds ตรงจากไคลเอนต์ (ไม่เชื่อว่าเป็นของจริง) — เช็คซ้ำว่าอยู่
// tenant เดียวกัน + role ที่ mention ได้ (เหมือน listAssignableStaff) ก่อนเสมอ
async function notifyMentionedStaff(
  tenantId: string,
  conversationId: string,
  note: { id: string | number; body: string },
  mentionedUserIds: string[],
  authorLabel: string | null
): Promise<string[]> {
  const validRes = await query(
    `SELECT u.id FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[])
        AND r.name IN ('Sales','Manager','Administrator')`,
    [tenantId, mentionedUserIds]
  );
  const validIds: string[] = validRes.rows.map((r: any) => r.id);
  if (!validIds.length) return [];

  for (const userId of validIds) {
    await query(
      `INSERT INTO bms_conversation_note_mentions (tenant_id, note_id, conversation_id, mentioned_user_id)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, note.id, conversationId, userId]
    );
    // best-effort — การแจ้งเตือนล้มเหลวไม่ควรทำให้บันทึกโน้ตล้ม (เหมือน publishInboxChanged)
    try {
      await createNotification({
        user_id: userId,
        type: "bms_mention",
        title: `${authorLabel || "เพื่อนร่วมทีม"} กล่าวถึงคุณในแชท`,
        message: note.body.slice(0, 200),
        entity_type: "bms_conversation_note_mention",
        entity_id: conversationId, // conversation_id เป็น UUID ตรงกับคอลัมน์ entity_id — note.id เป็น bigint ใส่ตรงไม่ได้
        data: { tenantId, conversationId, noteId: note.id },
      });
    } catch (error) {
      console.error("[BMS] mention notification failed:", error);
    }
  }
  return validIds;
}

export async function listNotes(tenantId: string, id: string, limit = 50) {
  const lim = Math.min(Math.max(Number(limit || 50), 1), 200);
  const res = await query(
    `SELECT n.id, n.author, n.body, n.created_at,
            COALESCE(
              (SELECT array_agg(m.mentioned_user_id) FROM bms_conversation_note_mentions m WHERE m.note_id = n.id),
              '{}'
            ) AS mentioned_user_ids
       FROM bms_conversation_notes n
      WHERE n.tenant_id = $1 AND n.conversation_id = $2
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT $3`,
    [tenantId, id, lim]
  );
  return res.rows;
}

// ---- @mention ของฉัน (badge + หน้า "เมนชันของฉัน") ------------
export async function countUnreadMentions(tenantId: string, userId: string): Promise<number> {
  const res = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM bms_conversation_note_mentions
      WHERE tenant_id = $1 AND mentioned_user_id = $2 AND read_at IS NULL`,
    [tenantId, userId]
  );
  return Number(res.rows[0]?.total ?? 0);
}

export async function listMyMentions(
  tenantId: string,
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {}
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const res = await query(
    `SELECT m.id, m.conversation_id, m.read_at, m.created_at,
            n.author, n.body,
            c.channel,
            COALESCE(NULLIF(cu.name, c.customer_ref), ci.display_name) AS customer_name
       FROM bms_conversation_note_mentions m
       JOIN bms_conversation_notes n ON n.id = m.note_id
       JOIN bms_conversations c ON c.id = m.conversation_id
       LEFT JOIN bms_customers cu ON cu.id = c.customer_id
       LEFT JOIN bms_customer_identities ci
         ON ci.tenant_id = c.tenant_id AND ci.channel = c.channel AND ci.external_ref = c.customer_ref
      WHERE m.tenant_id = $1 AND m.mentioned_user_id = $2
        AND ($3::boolean IS FALSE OR m.read_at IS NULL)
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $4`,
    [tenantId, userId, opts.unreadOnly ?? false, limit]
  );
  return res.rows;
}

export async function markMentionRead(tenantId: string, userId: string, mentionId: string): Promise<boolean> {
  const res = await query(
    `UPDATE bms_conversation_note_mentions SET read_at = now()
      WHERE id = $1 AND tenant_id = $2 AND mentioned_user_id = $3 AND read_at IS NULL`,
    [mentionId, tenantId, userId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function markAllMentionsRead(tenantId: string, userId: string): Promise<number> {
  const res = await query(
    `UPDATE bms_conversation_note_mentions SET read_at = now()
      WHERE tenant_id = $1 AND mentioned_user_id = $2 AND read_at IS NULL`,
    [tenantId, userId]
  );
  return res.rowCount ?? 0;
}

// ---- staff reply (persist + ยิงกลับช่องทาง) ------------------
export type SendResult = { status: "SENT"; delivered: boolean; messageId?: string } | { status: "NOT_FOUND" } | { status: "EMPTY" };

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";

/**
 * ยิงข้อความออกช่องทางจริง (คืน true ถ้าส่งสำเร็จ)
 *   • line              → LINE push API
 *   • facebook/instagram → Meta Graph Send API (/me/messages)
 *   • web               → ไม่ต้อง push (ตอบผ่าน HTTP response ของ widget)
 *   • tiktok            → ยังไม่ผูก send API — persist อย่างเดียว
 */
export async function deliverToChannel(
  tenantId: string, channel: string, to: string | null, text: string, attachment?: Attachment | null
): Promise<boolean> {
  if (!to) return false;
  const img = attachment && isImageMime(attachment.mimeType) ? absoluteUrl(attachment.url) : null;
  // ไฟล์ที่ไม่ใช่รูป → แนบเป็นลิงก์ท้ายข้อความ (channel ส่วนใหญ่ไม่มี generic file message)
  const fileLink = attachment && !img ? absoluteUrl(attachment.url) : null;
  const outText = [text, fileLink].filter(Boolean).join(fileLink ? "\n" : "");

  if (channel === "line") {
    const cfg = await getChannel(tenantId, "line");
    if (!cfg?.active || !cfg.access_token) return false;
    const messages: any[] = [];
    if (outText) messages.push({ type: "text", text: outText });
    if (img) messages.push({ type: "image", originalContentUrl: img, previewImageUrl: img });
    if (messages.length === 0) return false;
    try {
      const resp = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.access_token}` },
        body: JSON.stringify({ to, messages }),
      });
      if (resp.ok) {
        await recordOutboundSuccess(tenantId, "line");
      } else {
        const detail = formatOutboundErrorDetail(resp, await resp.text().catch(() => ""));
        await recordOutboundError(tenantId, "line", resp.status, detail);
      }
      return resp.ok;
    } catch (e) {
      console.error("[BMS] LINE push failed:", e);
      return false;
    }
  }

  if (channel === "facebook" || channel === "instagram") {
    const cfg = await getChannel(tenantId, channel);
    if (!cfg?.active || !cfg.access_token) return false;
    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/messages?access_token=${encodeURIComponent(cfg.access_token)}`;
    const send = (msg: any) => fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipient: { id: to }, messaging_type: "RESPONSE", message: msg }),
    });
    try {
      let ok = true;
      let lastFailed: Response | null = null;
      if (outText) {
        const resp = await send({ text: outText });
        if (!resp.ok) lastFailed = resp;
        ok = resp.ok && ok;
      }
      if (img) {
        const resp = await send({ attachment: { type: "image", payload: { url: img, is_reusable: true } } });
        if (!resp.ok) lastFailed = resp;
        ok = resp.ok && ok;
      }
      if (lastFailed) {
        const detail = formatOutboundErrorDetail(lastFailed, await lastFailed.text().catch(() => ""));
        await recordOutboundError(tenantId, channel, lastFailed.status, detail);
      } else {
        await recordOutboundSuccess(tenantId, channel);
      }
      return ok;
    } catch (e) {
      console.error(`[BMS] ${channel} send failed:`, e);
      return false;
    }
  }

  // web (ตอบผ่าน HTTP response) / tiktok (ยังไม่ผูก API) → persist อย่างเดียว
  return false;
}

export async function sendStaffMessage(
  tenantId: string,
  conversationId: string,
  body: string,
  staff: string | null,
  attachment?: Attachment | null
): Promise<SendResult> {
  const text = (body || "").trim();
  const att = attachment?.url ? attachment : null;
  if (!text && !att) return { status: "EMPTY" };

  const conv = await query<{ channel: string; customer_ref: string | null; customer_id: string | null }>(
    `SELECT channel, customer_ref, customer_id FROM bms_conversations WHERE tenant_id = $1 AND id = $2`,
    [tenantId, conversationId]
  );
  if (conv.rowCount === 0) return { status: "NOT_FOUND" };

  const channel = conv.rows[0].channel;
  const customerId = conv.rows[0].customer_id ?? null;
  const couponCode = couponCodeFromShareText(text);
  let outgoingText = text;
  let couponWalletLink: string | null = null;

  if (couponCode && customerId && !/\/coupon\/wallet\?t=/i.test(text)) {
    try {
      const assigned = await assignCouponToCustomer(tenantId, customerId, couponCode, {
        actor: staff,
        source: "MANUAL_CHAT",
        note: "Assigned from Inbox coupon share",
      });
      if (assigned) {
        const token = createCouponWalletToken({ tenantId, customerId });
        couponWalletLink = absoluteUrl(`/coupon/wallet?t=${encodeURIComponent(token)}`);
        outgoingText = `${text}\n\nดูคูปองของคุณ / View your coupons:\n${couponWalletLink}`;
      }
    } catch (error) {
      console.error("[BMS] assign customer coupon wallet failed:", error);
    }
  }

  const delivered = await deliverToChannel(tenantId, channel, conv.rows[0].customer_ref, outgoingText, att);
  const status = outboundStatus(channel, delivered);

  // body NOT NULL — เก็บข้อความ (อาจว่างถ้าเป็น attachment ล้วน)
  const inserted = await query<{ id: string }>(
    `INSERT INTO bms_messages (tenant_id, conversation_id, direction, body, sender, meta)
     VALUES ($1, $2, 'OUT', $3, $4, $5)
     RETURNING id`,
    [tenantId, conversationId, outgoingText, `staff:${staff ?? "admin"}`, JSON.stringify({ delivered, status, attachment: att, couponWalletLink })]
  );
  // preview: ข้อความ · ถ้าไม่มีข้อความใช้ [รูปภาพ]/[ไฟล์]
  const preview = messagePreview(outgoingText, att);
  await query(
    `UPDATE bms_conversations SET last_message = $3, last_message_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, conversationId, preview.slice(0, 500)]
  );
  publishInboxChanged(tenantId, conversationId, "MESSAGES_CHANGED");

  return { status: "SENT", delivered, messageId: inserted.rows[0]?.id };
}

/** ส่งข้อความเดิมซ้ำ (retry จากสถานะ FAILED) — ยิงช่องทางใหม่ + อัปเดต meta.status ในแถวเดิม */
export async function retryMessage(tenantId: string, messageId: string): Promise<SendResult> {
  const m = await query<{ conversation_id: string; body: string; meta: any }>(
    `SELECT conversation_id, body, meta FROM bms_messages
      WHERE tenant_id = $1 AND id = $2 AND direction = 'OUT'`,
    [tenantId, messageId]
  );
  if (m.rowCount === 0) return { status: "NOT_FOUND" };
  const row = m.rows[0];

  const conv = await query<{ channel: string; customer_ref: string | null }>(
    `SELECT channel, customer_ref FROM bms_conversations WHERE tenant_id = $1 AND id = $2`,
    [tenantId, row.conversation_id]
  );
  if (conv.rowCount === 0) return { status: "NOT_FOUND" };

  const att: Attachment | null = row.meta?.attachment ?? null;
  const channel = conv.rows[0].channel;
  const delivered = await deliverToChannel(tenantId, channel, conv.rows[0].customer_ref, row.body || "", att);
  const status = outboundStatus(channel, delivered);

  // merge เข้า meta เดิม (คง attachment ไว้)
  await query(
    `UPDATE bms_messages SET meta = meta || $3::jsonb WHERE tenant_id = $1 AND id = $2`,
    [tenantId, messageId, JSON.stringify({ delivered, status })]
  );
  publishInboxChanged(tenantId, row.conversation_id, "CONVERSATION_CHANGED");
  return { status: "SENT", delivered };
}

// ---- timeline (message + note + order) -----------------------
// `at` = เวลาที่เหตุการณ์นั้นเกิดจริงเสมอ · ORDER = เวลา "สร้างออร์เดอร์" (created_at) ไม่ใช่เวลาที่ได้สถานะปัจจุบัน
// สถานะปัจจุบันแยกไปที่ field `status`/`statusAt` เพื่อไม่ให้อ่านเหมือนว่า "SHIPPED ตอน created_at"
export type TimelineEntry = {
  type: string;
  at: string;
  text: string;
  ref: string | null;
  channel: string | null;   // ORDER: ช่องทางที่สั่ง (ออร์เดอร์ scope ตามลูกค้า จึงข้ามช่องทางได้)
  entityId: string | null;  // ORDER: order id เต็ม (ใช้ลิงก์/preview)
  status: string | null;    // ORDER: สถานะปัจจุบัน
  statusAt: string | null;  // ORDER: updated_at ของแถว = ครั้งล่าสุดที่สถานะถูกแก้
};

// timeline เป็น query ที่หนักสุดของ panel (รวมทุกข้อความ + ทุกออร์เดอร์ของลูกค้า) → ต้องมีเพดานเสมอ
export const TIMELINE_MAX_PER_SOURCE = 200;

export async function getTimeline(
  tenantId: string,
  conversationId: string,
  limitPerSource = TIMELINE_MAX_PER_SOURCE
): Promise<TimelineEntry[]> {
  const conv = await query<{ customer_id: string | null }>(
    `SELECT customer_id FROM bms_conversations WHERE tenant_id = $1 AND id = $2`,
    [tenantId, conversationId]
  );
  if (conv.rowCount === 0) return [];
  const customerId = conv.rows[0].customer_id;
  const cap = Math.max(1, Math.min(limitPerSource, TIMELINE_MAX_PER_SOURCE));

  const [msgs, notes, orders, systemEvents] = await Promise.all([
    query(`SELECT direction, body, sender, meta, created_at FROM bms_messages
             WHERE tenant_id = $1 AND conversation_id = $2
             ORDER BY created_at DESC, id DESC LIMIT $3`, [tenantId, conversationId, cap]),
    query(`SELECT author, body, created_at FROM bms_conversation_notes
             WHERE tenant_id = $1 AND conversation_id = $2
             ORDER BY created_at DESC, id DESC LIMIT $3`, [tenantId, conversationId, cap]),
    customerId
      ? query(`SELECT id, channel, status, total_amount, created_at, updated_at FROM bms_orders
                 WHERE tenant_id = $1 AND customer_id = $2
                 ORDER BY created_at DESC LIMIT $3`, [tenantId, customerId, cap])
      : Promise.resolve({ rows: [] as any[] }),
    // มอบหมาย/ช่วยตอบ/เปลี่ยนสถานะ — reuse listSystemEvents เพื่อได้ "ชื่อคน" ไม่ใช่ UUID/email ดิบ
    listSystemEvents(tenantId, conversationId),
  ]);

  const toISO = (d: any) => (d instanceof Date ? d.toISOString() : String(d));
  const base = { channel: null, entityId: null, status: null, statusAt: null };
  const systemLabel = (e: SystemEvent) => {
    if (e.kind === "assign") return `มอบหมาย/โอน staff หลัก → ${e.targetName ?? "ไม่ทราบ"}`;
    if (e.kind === "helper_add") return `เพิ่มคนช่วยตอบ → ${e.targetName ?? "ไม่ทราบ"}`;
    if (e.kind === "helper_remove") return `ถอดคนช่วยตอบ → ${e.targetName ?? "ไม่ทราบ"}`;
    return `เปลี่ยนสถานะแชท → ${e.statusValue ?? "ไม่ทราบ"}`;
  };
  const entries: TimelineEntry[] = [
    ...msgs.rows.map((m: any) => ({
      ...base,
      type: m.direction === "IN" ? "MESSAGE_IN" : "MESSAGE_OUT",
      at: toISO(m.created_at),
      // body ว่างได้ถ้าเป็นรูป/ไฟล์ล้วน — ใช้ placeholder เดียวกับ preview ในคิวแชท
      text: messagePreview(m.body, m.meta?.attachment ?? null),
      ref: m.sender ?? null,
    })),
    ...notes.rows.map((n: any) => ({
      ...base,
      type: "NOTE", at: toISO(n.created_at), text: n.body, ref: n.author ?? null,
    })),
    ...orders.rows.map((o: any) => ({
      ...base,
      type: "ORDER",
      at: toISO(o.created_at),
      // ป้าย "สร้างออร์เดอร์" อยู่ที่ type แล้ว — text เก็บแค่ยอดเงิน (สุทธิหลังหักส่วนลด) ไม่ต้องซ้ำ
      text: `${Number(o.total_amount).toLocaleString("th-TH")} ฿`,
      ref: String(o.id).slice(0, 8),
      channel: o.channel ?? null,
      entityId: String(o.id),
      status: o.status ?? null,
      statusAt: o.updated_at ? toISO(o.updated_at) : null,
    })),
    ...systemEvents.map((e) => ({
      ...base,
      type: e.kind === "status" ? "STATUS" : "ASSIGN",
      at: e.at,
      text: `${systemLabel(e)}${e.auto ? " (auto)" : ""}`,
      ref: e.actorName,
    })),
  ];
  // tie-break ด้วย type+ref กัน event วินาทีเดียวกันสลับลำดับไปมาทุกครั้งที่โหลด
  entries.sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1
      : a.type < b.type ? -1 : a.type > b.type ? 1
        : String(a.ref).localeCompare(String(b.ref))
  );
  return entries;
}

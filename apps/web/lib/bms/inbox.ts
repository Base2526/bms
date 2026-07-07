// =============================================================
// BMS Omnichannel Inbox — conversations, messages, notes, timeline
// -------------------------------------------------------------
// logConversation : hook จาก pipeline — บันทึกข้อความเข้า (ลูกค้า) + ออก (AI)
// list/get         : อ่านกล่องข้อความ + ประวัติแชท
// assign/tags/status/markRead : จัดการงานในทีม
// addNote/listNotes : โน้ตภายใน (ลูกค้าไม่เห็น)
// sendStaffMessage : แอดมินตอบเอง → persist + ยิงกลับช่องทาง (LINE push)
// getTimeline      : รวม message + note + order เรียงตามเวลา
//
// tenant-scoped ทุก query; logConversation เป็น best-effort (ไม่ทำให้ webhook ล้ม)
// =============================================================

import { query } from "@/lib/db";
import { getChannel } from "./channels";

export type ConvStatus = "OPEN" | "PENDING" | "CLOSED";

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
  reply: string
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

    // upsert conversation
    const conv = await query<{ id: string }>(
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
       RETURNING id`,
      [tenantId, channel, customerRef, customerId, incoming.slice(0, 500)]
    );
    const convId = conv.rows[0].id;

    await query(
      `INSERT INTO bms_messages (tenant_id, conversation_id, direction, body, sender)
       VALUES ($1, $2, 'IN', $3, 'customer'), ($1, $2, 'OUT', $4, 'ai')`,
      [tenantId, convId, incoming, reply]
    );
  } catch (e) {
    console.error("[BMS] logConversation failed:", e);
  }
}

// ---- read ----------------------------------------------------
export async function listConversations(
  tenantId: string,
  opts: { status?: string | null; assignedTo?: string | null; tag?: string | null; search?: string | null; limit?: number; offset?: number } = {}
) {
  const limit = Math.min(Math.max(Number(opts.limit ?? 50), 1), 200);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const res = await query(
    `SELECT c.id, c.channel, c.customer_ref, c.customer_id, c.status, c.assigned_to,
            c.tags, c.unread, c.last_message, c.last_message_at, c.created_at, c.updated_at,
            cu.name AS customer_name
       FROM bms_conversations c
       LEFT JOIN bms_customers cu ON cu.id = c.customer_id
      WHERE c.tenant_id = $1
        AND ($2::text IS NULL OR c.status = $2)
        AND ($3::text IS NULL OR c.assigned_to = $3)
        AND ($4::text IS NULL OR $4 = ANY(c.tags))
        AND ($5::text IS NULL OR c.last_message ILIKE '%'||$5||'%' OR cu.name ILIKE '%'||$5||'%' OR c.customer_ref ILIKE '%'||$5||'%')
      ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
      LIMIT $6 OFFSET $7`,
    [tenantId, opts.status ?? null, opts.assignedTo ?? null, opts.tag ?? null, opts.search ?? null, limit, offset]
  );
  return res.rows;
}

export async function getConversation(tenantId: string, id: string) {
  const res = await query(
    `SELECT c.id, c.channel, c.customer_ref, c.customer_id, c.status, c.assigned_to,
            c.tags, c.unread, c.last_message, c.last_message_at, c.created_at, c.updated_at,
            cu.name AS customer_name
       FROM bms_conversations c
       LEFT JOIN bms_customers cu ON cu.id = c.customer_id
      WHERE c.tenant_id = $1 AND c.id = $2`,
    [tenantId, id]
  );
  return res.rows[0] ?? null;
}

export async function listMessages(tenantId: string, conversationId: string, limit = 200) {
  const lim = Math.min(Math.max(limit, 1), 500);
  const res = await query(
    `SELECT id, direction, body, sender, created_at
       FROM bms_messages
      WHERE tenant_id = $1 AND conversation_id = $2
      ORDER BY created_at, id
      LIMIT $3`,
    [tenantId, conversationId, lim]
  );
  return res.rows;
}

// ---- manage --------------------------------------------------
export async function assignConversation(tenantId: string, id: string, assignedTo: string | null): Promise<boolean> {
  const res = await query(
    `UPDATE bms_conversations SET assigned_to = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, assignedTo]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function setConversationStatus(tenantId: string, id: string, status: ConvStatus): Promise<boolean> {
  if (!["OPEN", "PENDING", "CLOSED"].includes(status)) return false;
  const res = await query(
    `UPDATE bms_conversations SET status = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, status]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function setConversationTags(tenantId: string, id: string, tags: string[]): Promise<boolean> {
  const clean = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean))).slice(0, 30);
  const res = await query(
    `UPDATE bms_conversations SET tags = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, clean]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function markRead(tenantId: string, id: string): Promise<boolean> {
  const res = await query(
    `UPDATE bms_conversations SET unread = 0, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return (res.rowCount ?? 0) > 0;
}

// ---- notes (internal) ----------------------------------------
export async function addNote(tenantId: string, id: string, author: string | null, body: string) {
  const text = body.trim();
  if (!text) return null;
  const res = await query(
    `INSERT INTO bms_conversation_notes (tenant_id, conversation_id, author, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, author, body, created_at`,
    [tenantId, id, author, text]
  );
  return res.rows[0];
}

export async function listNotes(tenantId: string, id: string) {
  const res = await query(
    `SELECT id, author, body, created_at FROM bms_conversation_notes
      WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY created_at DESC, id DESC`,
    [tenantId, id]
  );
  return res.rows;
}

// ---- staff reply (persist + ยิงกลับช่องทาง) ------------------
export type SendResult = { status: "SENT"; delivered: boolean } | { status: "NOT_FOUND" } | { status: "EMPTY" };

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";

/**
 * ยิงข้อความออกช่องทางจริง (คืน true ถ้าส่งสำเร็จ)
 *   • line              → LINE push API
 *   • facebook/instagram → Meta Graph Send API (/me/messages)
 *   • web               → ไม่ต้อง push (ตอบผ่าน HTTP response ของ widget)
 *   • tiktok            → ยังไม่ผูก send API — persist อย่างเดียว
 */
export async function deliverToChannel(tenantId: string, channel: string, to: string | null, text: string): Promise<boolean> {
  if (!to) return false;

  if (channel === "line") {
    const cfg = await getChannel(tenantId, "line");
    if (!cfg?.active || !cfg.access_token) return false;
    try {
      const resp = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.access_token}` },
        body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
      });
      return resp.ok;
    } catch (e) {
      console.error("[BMS] LINE push failed:", e);
      return false;
    }
  }

  if (channel === "facebook" || channel === "instagram") {
    const cfg = await getChannel(tenantId, channel);
    if (!cfg?.active || !cfg.access_token) return false;
    try {
      const resp = await fetch(
        `https://graph.facebook.com/${META_GRAPH_VERSION}/me/messages?access_token=${encodeURIComponent(cfg.access_token)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recipient: { id: to }, messaging_type: "RESPONSE", message: { text } }),
        }
      );
      return resp.ok;
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
  staff: string | null
): Promise<SendResult> {
  const text = body.trim();
  if (!text) return { status: "EMPTY" };

  const conv = await query<{ channel: string; customer_ref: string | null }>(
    `SELECT channel, customer_ref FROM bms_conversations WHERE tenant_id = $1 AND id = $2`,
    [tenantId, conversationId]
  );
  if (conv.rowCount === 0) return { status: "NOT_FOUND" };

  const delivered = await deliverToChannel(tenantId, conv.rows[0].channel, conv.rows[0].customer_ref, text);

  await query(
    `INSERT INTO bms_messages (tenant_id, conversation_id, direction, body, sender, meta)
     VALUES ($1, $2, 'OUT', $3, $4, $5)`,
    [tenantId, conversationId, text, `staff:${staff ?? "admin"}`, JSON.stringify({ delivered })]
  );
  await query(
    `UPDATE bms_conversations SET last_message = $3, last_message_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, conversationId, text.slice(0, 500)]
  );

  return { status: "SENT", delivered };
}

// ---- timeline (message + note + order) -----------------------
export type TimelineEntry = { type: string; at: string; text: string; ref: string | null };

export async function getTimeline(tenantId: string, conversationId: string): Promise<TimelineEntry[]> {
  const conv = await query<{ customer_id: string | null }>(
    `SELECT customer_id FROM bms_conversations WHERE tenant_id = $1 AND id = $2`,
    [tenantId, conversationId]
  );
  if (conv.rowCount === 0) return [];
  const customerId = conv.rows[0].customer_id;

  const [msgs, notes, orders] = await Promise.all([
    query(`SELECT direction, body, sender, created_at FROM bms_messages
             WHERE tenant_id = $1 AND conversation_id = $2`, [tenantId, conversationId]),
    query(`SELECT author, body, created_at FROM bms_conversation_notes
             WHERE tenant_id = $1 AND conversation_id = $2`, [tenantId, conversationId]),
    customerId
      ? query(`SELECT id, status, total_amount, created_at FROM bms_orders
                 WHERE tenant_id = $1 AND customer_id = $2`, [tenantId, customerId])
      : Promise.resolve({ rows: [] as any[] }),
  ]);

  const toISO = (d: any) => (d instanceof Date ? d.toISOString() : String(d));
  const entries: TimelineEntry[] = [
    ...msgs.rows.map((m: any) => ({
      type: m.direction === "IN" ? "MESSAGE_IN" : "MESSAGE_OUT",
      at: toISO(m.created_at), text: m.body, ref: m.sender ?? null,
    })),
    ...notes.rows.map((n: any) => ({
      type: "NOTE", at: toISO(n.created_at), text: n.body, ref: n.author ?? null,
    })),
    ...orders.rows.map((o: any) => ({
      type: "ORDER", at: toISO(o.created_at),
      text: `ออร์เดอร์ ${o.status} · ${Number(o.total_amount).toLocaleString()} ฿`,
      ref: String(o.id).slice(0, 8),
    })),
  ];
  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return entries;
}

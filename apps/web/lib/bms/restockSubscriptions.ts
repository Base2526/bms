import { query } from "@/lib/db";
import { channelSupportsPush, sendStaffMessage } from "./inbox";

export const RESTOCK_STATUSES = [
  "ACTIVE",
  "READY_TO_NOTIFY",
  "NOTIFIED",
  "PURCHASED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type RestockStatus = (typeof RESTOCK_STATUSES)[number];

const MAX_BODY_LENGTH = 2000;
const SUCCESS_RESEND_COOLDOWN_MS = 5 * 60 * 1000;

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function shapeSubscription(row: any) {
  return {
    id: row.id,
    conversationId: row.conversation_id ?? null,
    customerId: row.customer_id ?? null,
    customerName: row.customer_name ?? null,
    channel: row.channel,
    customerRef: row.customer_ref,
    productSku: row.product_sku,
    productName: row.product_name,
    size: row.size,
    requestedQty: row.requested_qty,
    available: Number(row.available ?? 0),
    status: row.status,
    source: row.source,
    consentedAt: iso(row.consented_at),
    readyAt: iso(row.ready_at),
    lastNotifiedAt: iso(row.last_notified_at),
    resolvedAt: iso(row.resolved_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function subscribeToRestock(input: {
  tenantId: string;
  channel: string;
  customerRef: string;
  sku: string;
  size: string;
  requestedQty?: number;
  actor?: string | null;
}) {
  const channel = input.channel.trim().toLowerCase();
  if (!channelSupportsPush(channel)) {
    return { status: "UNSUPPORTED_CHANNEL" as const };
  }
  const sku = input.sku.trim();
  const size = input.size.trim().toUpperCase();
  const requestedQty = Math.min(Math.max(input.requestedQty ?? 1, 1), 999);

  const product = await query<{ name: string; available: number }>(
    `SELECT p.name, (i.current_stock - i.reserved_stock)::int AS available
       FROM bms_products p
       JOIN bms_inventory i ON i.tenant_id = p.tenant_id AND i.product_sku = p.sku
      WHERE p.tenant_id = $1 AND p.sku = $2 AND i.size = $3 AND p.active
      LIMIT 1`,
    [input.tenantId, sku, size]
  );
  if (!product.rowCount) return { status: "NOT_FOUND" as const };
  if (product.rows[0].available > 0) {
    return { status: "IN_STOCK" as const, available: product.rows[0].available, productName: product.rows[0].name };
  }

  const conversation = await query<{ id: string; customer_id: string | null }>(
    `INSERT INTO bms_conversations
       (tenant_id, channel, customer_ref, customer_id, status, unread, last_message, last_message_at)
     SELECT $1, $2, $3, ci.customer_id, 'OPEN', 0, NULL, NULL
       FROM (SELECT 1) seed
       LEFT JOIN bms_customer_identities ci
         ON ci.tenant_id = $1 AND ci.channel = $2 AND ci.external_ref = $3
     ON CONFLICT (tenant_id, channel, customer_ref)
     DO UPDATE SET customer_id = COALESCE(bms_conversations.customer_id, EXCLUDED.customer_id), updated_at = now()
     RETURNING id, customer_id`,
    [input.tenantId, channel, input.customerRef]
  );

  const saved = await query<{ id: string }>(
    `INSERT INTO bms_restock_subscriptions
       (tenant_id, conversation_id, customer_id, channel, customer_ref, product_sku, size,
        requested_qty, status, source, consented_at, created_by)
     VALUES ($1, $8, $9, $2, $3, $4, $5, $6, 'ACTIVE', 'AI_CHAT', now(), $7)
      ON CONFLICT (tenant_id, channel, customer_ref, product_sku, size)
      DO UPDATE SET conversation_id = EXCLUDED.conversation_id,
                    customer_id = COALESCE(EXCLUDED.customer_id, bms_restock_subscriptions.customer_id),
                    requested_qty = EXCLUDED.requested_qty,
                    status = 'ACTIVE', source = 'AI_CHAT', consented_at = now(), ready_at = NULL,
                    resolved_at = NULL, created_by = EXCLUDED.created_by, updated_at = now()
      RETURNING id`,
    [
      input.tenantId, channel, input.customerRef, sku, size, requestedQty,
      input.actor ?? "ai:customer", conversation.rows[0].id, conversation.rows[0].customer_id,
    ]
  );

  await query(
    `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
     VALUES ($1, $2, 'restock.subscribe', $3, $4::jsonb)`,
    [input.tenantId, input.actor ?? "ai:customer", saved.rows[0].id, JSON.stringify({ sku, size, requestedQty, channel })]
  );
  return { status: "SUBSCRIBED" as const, id: saved.rows[0].id, productName: product.rows[0].name, sku, size };
}

export async function markRestockSubscriptionsReady(tenantId: string, sku: string, size: string): Promise<number> {
  const result = await query(
    `UPDATE bms_restock_subscriptions s
        SET status = 'READY_TO_NOTIFY', ready_at = COALESCE(s.ready_at, now()), updated_at = now()
      WHERE s.tenant_id = $1 AND s.product_sku = $2 AND s.size = $3 AND s.status = 'ACTIVE'
        AND EXISTS (
          SELECT 1 FROM bms_inventory i
           WHERE i.tenant_id = s.tenant_id AND i.product_sku = s.product_sku AND i.size = s.size
             AND (i.current_stock - i.reserved_stock) > 0
        )`,
    [tenantId, sku, size.trim().toUpperCase()]
  );
  return result.rowCount ?? 0;
}

export async function markRestockSubscriptionsReadyForOrders(orderIds: string[]): Promise<void> {
  if (!orderIds.length) return;
  try {
    const items = await query<{ tenant_id: string; product_sku: string; size: string }>(
      `SELECT DISTINCT tenant_id, product_sku, size
         FROM bms_order_items WHERE order_id = ANY($1::uuid[])`,
      [orderIds]
    );
    for (const item of items.rows) {
      await markRestockSubscriptionsReady(item.tenant_id, item.product_sku, item.size);
    }
  } catch (error) {
    console.error("[BMS] restock ready hook failed after order stock release:", error);
  }
}

export async function markRestockSubscriptionsPurchased(input: {
  tenantId: string;
  channel: string;
  customerRef?: string | null;
  customerId?: string | null;
  items: Array<{ sku: string; size: string }>;
}): Promise<void> {
  for (const item of input.items) {
    await query(
      `UPDATE bms_restock_subscriptions
          SET status = 'PURCHASED', resolved_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND product_sku = $2 AND size = $3
          AND status IN ('ACTIVE','READY_TO_NOTIFY','NOTIFIED')
          AND (($4::uuid IS NOT NULL AND customer_id = $4)
               OR (channel = $5 AND customer_ref = $6))`,
      [
        input.tenantId,
        item.sku,
        item.size.trim().toUpperCase(),
        input.customerId ?? null,
        input.channel,
        input.customerRef ?? null,
      ]
    );
  }
}

export async function listRestockSubscriptions(
  tenantId: string,
  options: { status?: string | null; search?: string | null; limit?: number; offset?: number; assignedTo?: string | null } = {}
) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const status = RESTOCK_STATUSES.includes(options.status as RestockStatus) ? options.status : null;
  const search = options.search?.trim() || null;
  const rows = await query(
    `SELECT s.*, p.name AS product_name,
            COALESCE(NULLIF(cu.name, s.customer_ref), ci.display_name, s.customer_ref) AS customer_name,
            COALESCE(i.current_stock - i.reserved_stock, 0)::int AS available
       FROM bms_restock_subscriptions s
       JOIN bms_products p ON p.tenant_id = s.tenant_id AND p.sku = s.product_sku
       LEFT JOIN bms_inventory i ON i.tenant_id = s.tenant_id AND i.product_sku = s.product_sku AND i.size = s.size
       LEFT JOIN bms_customers cu ON cu.id = s.customer_id
       LEFT JOIN bms_customer_identities ci
         ON ci.tenant_id = s.tenant_id AND ci.channel = s.channel AND ci.external_ref = s.customer_ref
      WHERE s.tenant_id = $1
        AND ($2::text IS NULL OR s.status = $2)
        AND ($3::text IS NULL OR p.name ILIKE '%'||$3||'%' OR s.product_sku ILIKE '%'||$3||'%'
             OR cu.name ILIKE '%'||$3||'%' OR ci.display_name ILIKE '%'||$3||'%' OR s.customer_ref ILIKE '%'||$3||'%')
        AND ($6::uuid IS NULL OR EXISTS (
          SELECT 1 FROM bms_conversations c
           WHERE c.tenant_id = s.tenant_id AND c.id = s.conversation_id
             AND (c.assigned_to_user_id = $6 OR EXISTS (
               SELECT 1 FROM bms_conversation_helpers h
                WHERE h.tenant_id = c.tenant_id AND h.conversation_id = c.id AND h.user_id = $6
             ))
        ))
      ORDER BY CASE s.status WHEN 'READY_TO_NOTIFY' THEN 0 WHEN 'ACTIVE' THEN 1 WHEN 'NOTIFIED' THEN 2 ELSE 3 END,
               s.ready_at DESC NULLS LAST, s.created_at DESC
      LIMIT $4 OFFSET $5`,
    [tenantId, status, search, limit, offset, options.assignedTo ?? null]
  );
  const count = await query<{ total: string }>(
    `SELECT COUNT(*) AS total
       FROM bms_restock_subscriptions s
       JOIN bms_products p ON p.tenant_id = s.tenant_id AND p.sku = s.product_sku
       LEFT JOIN bms_customers cu ON cu.id = s.customer_id
       LEFT JOIN bms_customer_identities ci
         ON ci.tenant_id = s.tenant_id AND ci.channel = s.channel AND ci.external_ref = s.customer_ref
      WHERE s.tenant_id = $1 AND ($2::text IS NULL OR s.status = $2)
        AND ($3::text IS NULL OR p.name ILIKE '%'||$3||'%' OR s.product_sku ILIKE '%'||$3||'%'
             OR cu.name ILIKE '%'||$3||'%' OR ci.display_name ILIKE '%'||$3||'%' OR s.customer_ref ILIKE '%'||$3||'%')
        AND ($4::uuid IS NULL OR EXISTS (
          SELECT 1 FROM bms_conversations c
           WHERE c.tenant_id = s.tenant_id AND c.id = s.conversation_id
             AND (c.assigned_to_user_id = $4 OR EXISTS (
               SELECT 1 FROM bms_conversation_helpers h
                WHERE h.tenant_id = c.tenant_id AND h.conversation_id = c.id AND h.user_id = $4
             ))
        ))`,
    [tenantId, status, search, options.assignedTo ?? null]
  );
  return { items: rows.rows.map(shapeSubscription), total: Number(count.rows[0]?.total ?? 0) };
}

export async function canAccessRestockSubscription(
  tenantId: string,
  subscriptionId: string,
  assignedTo?: string | null
): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM bms_restock_subscriptions s
      WHERE s.tenant_id = $1 AND s.id = $2
        AND ($3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM bms_conversations c
           WHERE c.tenant_id = s.tenant_id AND c.id = s.conversation_id
             AND (c.assigned_to_user_id = $3 OR EXISTS (
               SELECT 1 FROM bms_conversation_helpers h
                WHERE h.tenant_id = c.tenant_id AND h.conversation_id = c.id AND h.user_id = $3
             ))
        ))`,
    [tenantId, subscriptionId, assignedTo ?? null]
  );
  return (result.rowCount ?? 0) > 0;
}

// ยอดรวมจริงต่อสถานะ (ไม่ผูกกับ pagination) — ใช้กับ tab บนหน้า /admin/restock-subscriptions
// แทนที่การนับจากแค่ items ของหน้าปัจจุบันที่ผิด scope เดิม
export async function countRestockSubscriptionsByStatus(
  tenantId: string,
  options: { search?: string | null; assignedTo?: string | null } = {}
): Promise<{ total: number; active: number; readyToNotify: number; notified: number }> {
  const search = options.search?.trim() || null;
  const rows = await query<{ status: string; count: string }>(
    `SELECT s.status, COUNT(*) AS count
       FROM bms_restock_subscriptions s
       JOIN bms_products p ON p.tenant_id = s.tenant_id AND p.sku = s.product_sku
       LEFT JOIN bms_customers cu ON cu.id = s.customer_id
       LEFT JOIN bms_customer_identities ci
         ON ci.tenant_id = s.tenant_id AND ci.channel = s.channel AND ci.external_ref = s.customer_ref
      WHERE s.tenant_id = $1
        AND ($2::text IS NULL OR p.name ILIKE '%'||$2||'%' OR s.product_sku ILIKE '%'||$2||'%'
             OR cu.name ILIKE '%'||$2||'%' OR ci.display_name ILIKE '%'||$2||'%' OR s.customer_ref ILIKE '%'||$2||'%')
        AND ($3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM bms_conversations c
           WHERE c.tenant_id = s.tenant_id AND c.id = s.conversation_id
             AND (c.assigned_to_user_id = $3 OR EXISTS (
               SELECT 1 FROM bms_conversation_helpers h
                WHERE h.tenant_id = c.tenant_id AND h.conversation_id = c.id AND h.user_id = $3
             ))
        ))
      GROUP BY s.status`,
    [tenantId, search, options.assignedTo ?? null]
  );
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows.rows) {
    const count = Number(r.count);
    byStatus[r.status] = count;
    total += count;
  }
  return {
    total,
    active: byStatus.ACTIVE ?? 0,
    readyToNotify: byStatus.READY_TO_NOTIFY ?? 0,
    notified: byStatus.NOTIFIED ?? 0,
  };
}

export async function countReadyRestockSubscriptions(tenantId: string, assignedTo?: string | null): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM bms_restock_subscriptions s
      WHERE s.tenant_id = $1 AND s.status = 'READY_TO_NOTIFY'
        AND ($2::uuid IS NULL OR EXISTS (
          SELECT 1 FROM bms_conversations c
           WHERE c.tenant_id = s.tenant_id AND c.id = s.conversation_id
             AND (c.assigned_to_user_id = $2 OR EXISTS (
               SELECT 1 FROM bms_conversation_helpers h
                WHERE h.tenant_id = c.tenant_id AND h.conversation_id = c.id AND h.user_id = $2
             ))
        ))`,
    [tenantId, assignedTo ?? null]
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function listRestockDeliveries(tenantId: string, subscriptionId: string) {
  const result = await query(
    `SELECT id, attempt_no, channel, body, status, inbox_message_id, error, triggered_by, created_at, completed_at
       FROM bms_restock_deliveries
      WHERE tenant_id = $1 AND subscription_id = $2
      ORDER BY attempt_no DESC`,
    [tenantId, subscriptionId]
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    attemptNo: row.attempt_no,
    channel: row.channel,
    body: row.body,
    status: row.status,
    inboxMessageId: row.inbox_message_id == null ? null : String(row.inbox_message_id),
    error: row.error ?? null,
    triggeredBy: row.triggered_by ?? null,
    createdAt: iso(row.created_at),
    completedAt: iso(row.completed_at),
  }));
}

export async function sendRestockNotification(
  tenantId: string,
  subscriptionId: string,
  body: string,
  actor: string
) {
  const text = body.trim();
  if (!text) return { status: "EMPTY" as const, delivered: false, message: "กรุณาระบุข้อความ" };
  if (text.length > MAX_BODY_LENGTH) return { status: "TOO_LONG" as const, delivered: false, message: "ข้อความยาวเกิน 2,000 ตัวอักษร" };

  const subscription = await query<any>(
    `SELECT s.*, p.name AS product_name,
            COALESCE(i.current_stock - i.reserved_stock, 0)::int AS available
       FROM bms_restock_subscriptions s
       JOIN bms_products p ON p.tenant_id = s.tenant_id AND p.sku = s.product_sku
       LEFT JOIN bms_inventory i
         ON i.tenant_id = s.tenant_id AND i.product_sku = s.product_sku AND i.size = s.size
      WHERE s.tenant_id = $1 AND s.id = $2`,
    [tenantId, subscriptionId]
  );
  if (!subscription.rowCount) return { status: "NOT_FOUND" as const, delivered: false, message: "ไม่พบรายการแจ้งเตือน" };
  const row = subscription.rows[0];
  if (!["READY_TO_NOTIFY", "NOTIFIED"].includes(row.status)) {
    return { status: "INVALID_STATE" as const, delivered: false, message: "สถานะนี้ยังส่งข้อความไม่ได้" };
  }
  if (Number(row.available) <= 0) {
    await query(
      `UPDATE bms_restock_subscriptions SET status = 'ACTIVE', ready_at = NULL, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, subscriptionId]
    );
    return { status: "OUT_OF_STOCK" as const, delivered: false, message: "สินค้าหมดอีกครั้งแล้ว ระบบย้ายกลับไปรอของเข้า" };
  }
  if (!row.conversation_id || !channelSupportsPush(row.channel)) {
    return { status: "UNSUPPORTED_CHANNEL" as const, delivered: false, message: "ช่องทางนี้ยังส่งข้อความเชิงรุกไม่ได้" };
  }

  const last = await query<{ status: string; completed_at: Date | string | null }>(
    `SELECT status, completed_at FROM bms_restock_deliveries
      WHERE tenant_id = $1 AND subscription_id = $2 ORDER BY attempt_no DESC LIMIT 1`,
    [tenantId, subscriptionId]
  );
  const lastCompleted = last.rows[0]?.completed_at ? new Date(last.rows[0].completed_at).getTime() : 0;
  if (last.rows[0]?.status === "SENT" && Date.now() - lastCompleted < SUCCESS_RESEND_COOLDOWN_MS) {
    return { status: "COOLDOWN" as const, delivered: false, message: "เพิ่งส่งสำเร็จ กรุณารอ 5 นาทีก่อนส่งซ้ำ" };
  }

  const attempt = await query<{ id: string; attempt_no: number }>(
    `INSERT INTO bms_restock_deliveries
       (tenant_id, subscription_id, attempt_no, channel, body, status, triggered_by)
     SELECT $1, $2, COALESCE(MAX(attempt_no), 0) + 1, $3, $4, 'QUEUED', $5
       FROM bms_restock_deliveries WHERE tenant_id = $1 AND subscription_id = $2
     RETURNING id, attempt_no`,
    [tenantId, subscriptionId, row.channel, text, actor]
  );

  try {
    const sent = await sendStaffMessage(tenantId, row.conversation_id, text, actor);
    const delivered = sent.status === "SENT" && sent.delivered;
    const deliveryStatus = delivered ? "SENT" : "FAILED";
    const error = delivered ? null : "ช่องทางภายนอกไม่ยืนยันการส่ง กรุณาตรวจการเชื่อมต่อแล้วลองใหม่";
    await query(
      `UPDATE bms_restock_deliveries
          SET status = $3, inbox_message_id = $4, error = $5, completed_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, attempt.rows[0].id, deliveryStatus, sent.status === "SENT" ? sent.messageId ?? null : null, error]
    );
    await query(
      `UPDATE bms_restock_subscriptions
          SET status = $3, last_notified_at = CASE WHEN $3 = 'NOTIFIED' THEN now() ELSE last_notified_at END,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, subscriptionId, delivered ? "NOTIFIED" : "READY_TO_NOTIFY"]
    );
    return {
      status: delivered ? "SENT" as const : "FAILED" as const,
      delivered,
      message: delivered ? "ส่งข้อความแจ้งลูกค้าแล้ว" : error,
      attemptId: attempt.rows[0].id,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "ส่งข้อความไม่สำเร็จ";
    await query(
      `UPDATE bms_restock_deliveries SET status = 'FAILED', error = $3, completed_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, attempt.rows[0].id, detail]
    );
    return { status: "FAILED" as const, delivered: false, message: detail, attemptId: attempt.rows[0].id };
  }
}

function buildSuggestedRestockMessage(row: { product_name: string; product_sku: string; size: string; available: number }): string {
  return `${row.product_name} (${row.product_sku}) ไซซ์ ${row.size} เข้ามาแล้วค่ะ ตอนนี้มีพร้อมขาย ${row.available} ชิ้น สนใจให้ทางร้านช่วยสั่งให้ไหมคะ`;
}

// แจ้งลูกค้าที่ READY_TO_NOTIFY ทั้งหมดในครั้งเดียว (ปุ่ม "แจ้งทั้งหมด") ด้วยข้อความ template
// เดียวกับที่ฝั่ง client เสนอไว้ตอนส่งทีละราย — วน sendRestockNotification() ทีละแถวเพื่อใช้
// การเช็ค stock/cooldown/channel เดิมซ้ำ ไม่เขียน logic ส่งคู่ขนาน
export async function sendAllReadyRestockNotifications(
  tenantId: string,
  actor: string,
  assignedTo?: string | null
): Promise<{ attempted: number; sent: number; failed: number }> {
  const ready = await query<{ id: string }>(
    `SELECT s.id FROM bms_restock_subscriptions s
      WHERE s.tenant_id = $1 AND s.status = 'READY_TO_NOTIFY'
        AND ($2::uuid IS NULL OR EXISTS (
          SELECT 1 FROM bms_conversations c
           WHERE c.tenant_id = s.tenant_id AND c.id = s.conversation_id
             AND (c.assigned_to_user_id = $2 OR EXISTS (
               SELECT 1 FROM bms_conversation_helpers h
                WHERE h.tenant_id = c.tenant_id AND h.conversation_id = c.id AND h.user_id = $2
             ))
        ))
      ORDER BY s.ready_at ASC NULLS LAST, s.created_at ASC`,
    [tenantId, assignedTo ?? null]
  );

  let sent = 0;
  let failed = 0;
  for (const row of ready.rows) {
    const ctxRes = await query<{ product_sku: string; size: string; product_name: string; available: number }>(
      `SELECT s.product_sku, s.size, p.name AS product_name,
              COALESCE(i.current_stock - i.reserved_stock, 0)::int AS available
         FROM bms_restock_subscriptions s
         JOIN bms_products p ON p.tenant_id = s.tenant_id AND p.sku = s.product_sku
         LEFT JOIN bms_inventory i ON i.tenant_id = s.tenant_id AND i.product_sku = s.product_sku AND i.size = s.size
        WHERE s.tenant_id = $1 AND s.id = $2`,
      [tenantId, row.id]
    );
    if (!ctxRes.rowCount) { failed += 1; continue; }
    const body = buildSuggestedRestockMessage(ctxRes.rows[0]);
    const result = await sendRestockNotification(tenantId, row.id, body, actor);
    if (result.delivered) sent += 1; else failed += 1;
  }
  return { attempted: ready.rows.length, sent, failed };
}

export async function cancelRestockSubscription(tenantId: string, id: string): Promise<boolean> {
  const result = await query(
    `UPDATE bms_restock_subscriptions
        SET status = 'CANCELLED', resolved_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status NOT IN ('PURCHASED','CANCELLED','EXPIRED')`,
    [tenantId, id]
  );
  return (result.rowCount ?? 0) > 0;
}

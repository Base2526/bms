import { getClient } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { beginTenantTx } from "./tenant";
import { notifyInboxConversationChanged, pickAutoAssignee } from "./inbox";

const CALLBACK_TAG = "sales-callback";
const HOT_LEAD_TAG = "hot-lead";
const NOTIFICATION_DEDUPE_MINUTES = 15;

export type PresalesCallbackResult = {
  conversationId: string;
  reference: string;
  assignedUserId: string | null;
  repeated: boolean;
};

/** Persist the Inbox work item before the customer is told that Sales received it. */
export async function recordPresalesCallbackRequest(input: {
  tenantId: string;
  channel: string;
  customerRef: string | null | undefined;
  incoming: string;
}): Promise<PresalesCallbackResult> {
  // BMS presales is currently served by its verified LINE OA only.
  if (!input.tenantId || !input.customerRef?.trim() || input.channel !== "line" || !input.incoming.trim()) {
    throw new Error("PERSISTED_CUSTOMER_CONTEXT_REQUIRED");
  }
  const client = await getClient();
  let conversationId = "";
  let assignedUserId: string | null = null;
  let repeated = false;
  let recipients: string[] = [];
  let noteId: string | number | null = null;
  try {
    await beginTenantTx(client, input.tenantId);
    const customer = await client.query<{ customer_id: string }>(
      `SELECT customer_id FROM bms_customer_identities
        WHERE tenant_id = $1 AND channel = $2 AND external_ref = $3 LIMIT 1`,
      [input.tenantId, input.channel, input.customerRef],
    );
    const conversation = await client.query<{ id: string; assigned_to_user_id: string | null; tags: string[] }>(
      `INSERT INTO bms_conversations
         (tenant_id, channel, customer_ref, customer_id, status, unread, last_message, last_message_at, last_sender_type)
       VALUES ($1,$2,$3,$4,'OPEN',1,$5,now(),'customer')
       ON CONFLICT (tenant_id, channel, customer_ref) DO UPDATE
         SET customer_id = COALESCE(bms_conversations.customer_id, EXCLUDED.customer_id),
             status = 'OPEN', unread = GREATEST(bms_conversations.unread, 1),
             last_message = EXCLUDED.last_message, last_message_at = now(),
             last_sender_type = 'customer', updated_at = now()
       RETURNING id, assigned_to_user_id, tags`,
      [input.tenantId, input.channel, input.customerRef, customer.rows[0]?.customer_id ?? null, input.incoming.slice(0, 500)],
    );
    conversationId = conversation.rows[0].id;
    const recent = await client.query<{ recent: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM bms_audit_log
          WHERE tenant_id = $1 AND target = $2 AND action = 'presales.callback_request'
            AND meta->>'repeated' = 'false'
            AND created_at >= now() - ($3::int * interval '1 minute')
       ) AS recent`,
      [input.tenantId, conversationId, NOTIFICATION_DEDUPE_MINUTES],
    );
    repeated = recent.rows[0]?.recent === true && conversation.rows[0].tags.includes(CALLBACK_TAG);

    // Keep the existing eligible owner, including while temporarily unavailable. A repeat
    // must not silently move the lead to another person while suppressing their notification.
    const existing = await client.query<{ id: string }>(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.tenant_id = $1 AND u.id = $2
          AND r.name IN ('Sales','Manager','Administrator')
          AND (r.name = 'Administrator' OR NOT EXISTS (
            SELECT 1 FROM unnest(ARRAY['inbox.view','inbox.reply']) AS needed(permission)
             WHERE NOT EXISTS (SELECT 1 FROM bms_role_permissions rp
               WHERE rp.tenant_id = $1 AND rp.role_id = u.role_id AND rp.permission = needed.permission)
          ))`,
      [input.tenantId, conversation.rows[0].assigned_to_user_id],
    );
    assignedUserId = existing.rows[0]?.id ?? await pickAutoAssignee(input.tenantId, [], client, ["inbox.view", "inbox.reply"]);
    if (assignedUserId !== conversation.rows[0].assigned_to_user_id) repeated = false;
    const owners = await client.query<{ id: string }>(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.tenant_id = $1 AND r.name = 'Administrator'
        ORDER BY u.created_at, u.id LIMIT 50`,
      [input.tenantId],
    );
    recipients = [...new Set([...(assignedUserId ? [assignedUserId] : []), ...owners.rows.map(row => row.id)])];
    const updated = await client.query<{ assigned_to_user_id: string | null }>(
      `UPDATE bms_conversations
          SET assigned_to_user_id = $3::uuid,
              tags = ARRAY(SELECT DISTINCT tag FROM unnest(tags || ARRAY[$4,$5]::text[]) AS callback_tags(tag)),
              status = 'OPEN', updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING assigned_to_user_id`,
      [input.tenantId, conversationId, assignedUserId, CALLBACK_TAG, HOT_LEAD_TAG],
    );
    assignedUserId = updated.rows[0]?.assigned_to_user_id ?? null;

    if (!repeated) {
      const note = await client.query<{ id: string | number }>(
        `INSERT INTO bms_conversation_notes (tenant_id, conversation_id, author, body)
         VALUES ($1,$2,'ระบบ','ลูกค้าขอให้ฝ่ายขายติดต่อกลับ — เปิดบทสนทนาเพื่อตรวจข้อมูลและรับช่วงต่อ')
         RETURNING id`,
        [input.tenantId, conversationId],
      );
      noteId = note.rows[0]?.id ?? null;
      if (noteId == null) throw new Error("CALLBACK_NOTE_NOT_SAVED");
      for (const recipient of recipients) {
        await client.query(
          `INSERT INTO bms_conversation_note_mentions
             (tenant_id, note_id, conversation_id, mentioned_user_id)
           VALUES ($1,$2,$3,$4)`,
          [input.tenantId, noteId, conversationId, recipient],
        );
      }
    }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,'system:presales','presales.callback_request',$2,$3::jsonb)`,
      [input.tenantId, conversationId, JSON.stringify({ channel: input.channel, assignedUserId, repeated, priority: "top" })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  try {
    notifyInboxConversationChanged(input.tenantId, conversationId);
  } catch {
    // The durable queue/mentions already committed. A delivery hint cannot undo that fact.
    console.error("[BMS] presales callback realtime hint failed");
  }
  for (const recipient of repeated ? [] : recipients) {
    try {
      await createNotification({
        user_id: recipient,
        type: "bms_sales_callback",
        title: "ลูกค้าขอให้ Sales ติดต่อกลับ",
        message: "มีคำขอเร่งด่วนใหม่ เปิด Inbox เพื่อดูบทสนทนาและรับช่วงต่อ",
        entity_type: "bms_conversation_note_mention",
        entity_id: conversationId,
        data: { tenantId: input.tenantId, conversationId, noteId, priority: "top" },
      });
    } catch {
      // Internal mention badges remain available even if toast delivery fails.
      console.error("[BMS] presales callback notification failed");
    }
  }
  return {
    conversationId,
    reference: conversationId.replace(/-/g, "").slice(0, 8).toUpperCase(),
    assignedUserId,
    repeated,
  };
}

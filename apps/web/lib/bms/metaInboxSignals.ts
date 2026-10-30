// Meta delivery/read/echo events update Inbox state only. They never enter the AI pipeline.

import { getClient } from "@/lib/db";
import { resolveOrCreateCustomer } from "./customers";
import { messagePreview, notifyInboxConversationChanged, type Attachment } from "./inbox";
import type { MetaInboxSignal } from "./meta";
import { beginTenantTx } from "./tenant";

function eventDate(milliseconds: number): Date {
  return new Date(Math.min(milliseconds, Date.now() + 5 * 60_000));
}

function firstAttachment(signal: Extract<MetaInboxSignal, { kind: "ECHO" }>): Attachment | null {
  const item = signal.attachments.find((attachment) => attachment.url);
  return item?.url ? { url: item.url, name: item.title ?? undefined, mimeType: item.mimeType ?? undefined } : null;
}

export async function applyMetaInboxSignals(
  tenantId: string,
  channel: "facebook" | "instagram",
  signals: MetaInboxSignal[],
): Promise<{ echoes: number; deliveries: number; reads: number }> {
  if (!signals.length) return { echoes: 0, deliveries: 0, reads: 0 };
  const client = await getClient();
  const changedConversations = new Set<string>();
  let echoes = 0;
  let deliveries = 0;
  let reads = 0;
  try {
    await beginTenantTx(client, tenantId);
    for (const signal of signals.slice(0, 200)) {
      if (signal.kind === "ECHO") {
        const occurredAt = eventDate(signal.occurredAt);
        const matched = await client.query<{ id: string; conversation_id: string }>(
          `SELECT m.id,m.conversation_id
             FROM bms_messages m
             JOIN bms_conversations c ON c.tenant_id=m.tenant_id AND c.id=m.conversation_id
            WHERE m.tenant_id=$1 AND c.channel=$2
              AND (m.meta->'providerMessageIds') ? $3
            LIMIT 1 FOR UPDATE OF m`,
          [tenantId, channel, signal.providerMessageId],
        );
        if (matched.rows[0]) {
          await client.query(
            `UPDATE bms_messages
                SET meta=meta || jsonb_build_object('echoedAt',$3,'status',
                  CASE WHEN meta->>'status' IN ('DELIVERED','READ') THEN meta->>'status' ELSE 'SENT' END)
              WHERE tenant_id=$1 AND id=$2`,
            [tenantId, matched.rows[0].id, occurredAt.toISOString()],
          );
          changedConversations.add(matched.rows[0].conversation_id);
          echoes += 1;
          continue;
        }

        const customerId = await resolveOrCreateCustomer(client, tenantId, channel, signal.customerRef);
        if (!customerId) continue;
        const attachment = firstAttachment(signal);
        const preview = messagePreview(signal.text, attachment).slice(0, 500);
        const conversation = await client.query<{ id: string }>(
          `INSERT INTO bms_conversations
             (tenant_id,channel,customer_ref,customer_id,status,unread,last_message,last_message_at,last_sender_type)
           VALUES($1,$2,$3,$4,'OPEN',0,$5,$6,'staff')
           ON CONFLICT (tenant_id,channel,customer_ref) DO UPDATE SET
             customer_id=COALESCE(bms_conversations.customer_id,EXCLUDED.customer_id),
             last_message=CASE WHEN bms_conversations.last_message_at IS NULL OR bms_conversations.last_message_at<=EXCLUDED.last_message_at
                               THEN EXCLUDED.last_message ELSE bms_conversations.last_message END,
             last_message_at=GREATEST(bms_conversations.last_message_at,EXCLUDED.last_message_at),
             last_sender_type=CASE WHEN bms_conversations.last_message_at IS NULL OR bms_conversations.last_message_at<=EXCLUDED.last_message_at
                                   THEN 'staff' ELSE bms_conversations.last_sender_type END,
             updated_at=now()
           RETURNING id`,
          [tenantId, channel, signal.customerRef, customerId, preview, occurredAt],
        );
        const conversationId = conversation.rows[0].id;
        const inserted = await client.query(
          `INSERT INTO bms_messages (tenant_id,conversation_id,direction,body,sender,meta,created_at)
           SELECT $1,$2,'OUT',$3,$4,$5::jsonb,$6
            WHERE NOT EXISTS (
              SELECT 1 FROM bms_messages
               WHERE tenant_id=$1 AND (meta->'providerMessageIds') ? $7
            )`,
          [tenantId, conversationId, signal.text, `provider:${channel}`,
            JSON.stringify({ delivered: true, status: "SENT", echoed: true,
              echoedAt: occurredAt.toISOString(), providerMessageIds: [signal.providerMessageId],
              attachment, attachments: signal.attachments }),
            occurredAt, signal.providerMessageId],
        );
        if (inserted.rowCount) {
          changedConversations.add(conversationId);
          echoes += 1;
        }
        continue;
      }

      const occurredAt = eventDate(signal.occurredAt);
      if (signal.kind === "DELIVERY") {
        const updated = await client.query<{ conversation_id: string }>(
          `UPDATE bms_messages m
              SET meta=m.meta || jsonb_build_object(
                'delivered',true,
                'deliveredAt',$4,
                'status',CASE WHEN m.meta->>'status'='READ' THEN 'READ' ELSE 'DELIVERED' END)
             FROM bms_conversations c
            WHERE m.tenant_id=$1 AND c.tenant_id=$1 AND c.id=m.conversation_id
              AND c.channel=$2 AND c.customer_ref=$3 AND m.direction='OUT'
              AND (
                (cardinality($5::text[])>0 AND EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements_text(COALESCE(m.meta->'providerMessageIds','[]'::jsonb)) AS provider_id(value)
                   WHERE provider_id.value=ANY($5::text[])
                ))
                OR (cardinality($5::text[])=0 AND m.created_at<=$6)
              )
            RETURNING m.conversation_id`,
          [tenantId, channel, signal.customerRef, occurredAt.toISOString(), signal.providerMessageIds, occurredAt],
        );
        for (const row of updated.rows) changedConversations.add(row.conversation_id);
        deliveries += updated.rowCount ?? 0;
        continue;
      }

      const updated = await client.query<{ conversation_id: string }>(
        `UPDATE bms_messages m
            SET meta=m.meta || jsonb_build_object('delivered',true,'readAt',$4,'status','READ')
           FROM bms_conversations c
          WHERE m.tenant_id=$1 AND c.tenant_id=$1 AND c.id=m.conversation_id
            AND c.channel=$2 AND c.customer_ref=$3 AND m.direction='OUT' AND m.created_at<=$5
          RETURNING m.conversation_id`,
        [tenantId, channel, signal.customerRef, occurredAt.toISOString(), occurredAt],
      );
      for (const row of updated.rows) changedConversations.add(row.conversation_id);
      reads += updated.rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  for (const conversationId of changedConversations) {
    notifyInboxConversationChanged(tenantId, conversationId, "MESSAGES_CHANGED");
  }
  return { echoes, deliveries, reads };
}

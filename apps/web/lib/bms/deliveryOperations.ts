import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function listDeliveryOperations(tenantId: string, limit = 100) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), 200);
    const [orders, events, commands, controls] = await Promise.all([
      client.query<any>(
        `SELECT d.id,d.provider,d.provider_order_id,d.provider_display_number,d.provider_status,
                d.local_status,d.payment_status,d.acceptance_deadline_at AS acceptance_deadline,d.start_preparation_at,
                d.promised_ready_at,d.rider_eta_at AS rider_eta,d.created_at,d.updated_at,l.name AS location_name,
                (SELECT jsonb_agg(jsonb_build_object('kind',oe.event_kind,'source',oe.source,
                         'detail',oe.safe_detail,'at',oe.occurred_at) ORDER BY oe.occurred_at DESC)
                   FROM (SELECT * FROM bms_delivery_order_events x
                          WHERE x.tenant_id=d.tenant_id AND x.delivery_order_id=d.id
                          ORDER BY x.occurred_at DESC LIMIT 12) oe) AS timeline
           FROM bms_delivery_orders d
           JOIN bms_locations l ON l.tenant_id=d.tenant_id AND l.id=d.location_id
          WHERE d.tenant_id=$1
          ORDER BY CASE WHEN d.local_status IN ('RECEIVED','ACCEPTED','PREPARING','READY') THEN 0 ELSE 1 END,
                   d.updated_at DESC LIMIT $2`,
        [tenantId, bounded],
      ),
      client.query<any>(
        `SELECT e.id,e.event_type,e.sanitized_payload->>'providerOrderId' AS provider_order_id,
                e.sanitized_payload->>'providerStatus' AS provider_status,e.processing_status,
                e.attempts,e.last_error,e.received_at,e.provider_occurred_at,i.provider
           FROM bms_delivery_events e
           JOIN bms_delivery_integrations i ON i.tenant_id=e.tenant_id AND i.id=e.integration_id
          WHERE e.tenant_id=$1 AND e.processing_status IN ('ACTION_REQUIRED','RETRY','DEAD_LETTER')
          ORDER BY e.received_at DESC LIMIT $2`,
        [tenantId, bounded],
      ),
      client.query<any>(
        `SELECT c.id,c.command_type,c.aggregate_type,c.aggregate_id,c.status,c.attempts,c.next_retry_at,
                c.last_error,c.created_at,c.updated_at,i.provider
           FROM bms_delivery_commands c
           JOIN bms_delivery_integrations i ON i.tenant_id=c.tenant_id AND i.id=c.integration_id
          WHERE c.tenant_id=$1 AND c.status <> 'SUCCEEDED'
          ORDER BY CASE c.status WHEN 'FAILED' THEN 0 WHEN 'MANUAL_ACTION_REQUIRED' THEN 1 ELSE 2 END,
                   c.updated_at DESC LIMIT $2`,
        [tenantId, bounded],
      ),
      client.query<any>(
        `SELECT c.*,l.name AS location_name
           FROM bms_delivery_intake_controls c
           LEFT JOIN bms_locations l ON l.tenant_id=c.tenant_id AND l.id=c.location_id
          WHERE c.tenant_id=$1 ORDER BY c.updated_at DESC LIMIT $2`,
        [tenantId, bounded],
      ),
    ]);
    await client.query("COMMIT");
    return { orders: orders.rows, events: events.rows, commands: commands.rows, controls: controls.rows };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function retryDeliveryEvent(tenantId: string, actorUserId: string, eventId: string) {
  if (!UUID_RE.test(eventId)) throw new Error("DELIVERY_EVENT_ID_INVALID");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorUserId });
    const updated = await client.query(
      `UPDATE bms_delivery_events SET processing_status='PENDING',available_at=now(),last_error=NULL,error_code=NULL,
              claimed_at=NULL,claim_token=NULL,processed_at=NULL,updated_at=now()
        WHERE tenant_id=$1 AND id=$2
          AND processing_status IN ('ACTION_REQUIRED','RETRY','DEAD_LETTER')
        RETURNING id`,
      [tenantId, eventId],
    );
    if (!updated.rowCount) throw new Error("DELIVERY_EVENT_NOT_RETRYABLE");
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
       VALUES ($1,$2,'delivery.event_retry_requested',$3,'{}'::jsonb)`,
      [tenantId, actorUserId, eventId],
    );
    await client.query("COMMIT");
    return { id: eventId, status: "PENDING" };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function retryDeliveryCommand(tenantId: string, actorUserId: string, commandId: string) {
  if (!UUID_RE.test(commandId)) throw new Error("DELIVERY_COMMAND_ID_INVALID");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorUserId });
    const updated = await client.query(
      `UPDATE bms_delivery_commands SET status='PENDING',next_retry_at=now(),last_error=NULL,
              claimed_at=NULL,claim_token=NULL,updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status IN ('FAILED','MANUAL_ACTION_REQUIRED')
        RETURNING id`,
      [tenantId, commandId],
    );
    if (!updated.rowCount) throw new Error("DELIVERY_COMMAND_NOT_RETRYABLE");
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
       VALUES ($1,$2,'delivery.command_retry_requested',$3,'{}'::jsonb)`,
      [tenantId, actorUserId, commandId],
    );
    await client.query("COMMIT");
    return { id: commandId, status: "PENDING" };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

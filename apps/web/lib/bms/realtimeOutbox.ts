import type { PoolClient } from "pg";

import type { RealtimeEvent } from "../../../../packages/realtime/src/events";
import { validateRealtimeEvent } from "../../../../packages/realtime/src/events";

export type EnqueuedRealtimeEvent = {
  id: number;
  eventId: string;
};

/**
 * Insert an invalidation with the same PoolClient and open tenant transaction
 * that owns the business write. RLS independently rejects a mismatched tenant.
 */
export async function enqueueRealtimeEventInTx(
  client: PoolClient,
  candidate: unknown,
): Promise<EnqueuedRealtimeEvent> {
  const event = validateRealtimeEvent(candidate);
  const { rows } = await client.query<{ id: string | number; event_id: string }>(
    `INSERT INTO bms_realtime_outbox (
       event_id, tenant_id, location_id, user_id, actor_type, actor_id, device_id,
       event_type, schema_version, entity_type, entity_id, aggregate_version,
       entity_updated_at, safe_payload, occurred_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12,
       $13, $14::jsonb, $15
     )
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id, event_id`,
    [
      event.eventId,
      event.tenantId,
      event.locationId ?? null,
      event.userId ?? null,
      event.actorType,
      event.actorId ?? null,
      event.deviceId ?? null,
      event.eventType,
      event.schemaVersion,
      event.entityType,
      event.entityId,
      event.aggregateVersion ?? null,
      event.updatedAt ?? null,
      JSON.stringify(event.payload ?? {}),
      event.occurredAt,
    ],
  );

  if (!rows[0]) {
    const replay = await client.query<{
      id: string | number;
      event_id: string;
      event_type: string;
      entity_type: string;
      entity_id: string;
    }>(
      `SELECT id, event_id, event_type, entity_type, entity_id
         FROM bms_realtime_outbox
        WHERE tenant_id = $1 AND event_id = $2`,
      [event.tenantId, event.eventId],
    );
    if (!replay.rows[0]) throw new Error("REALTIME_OUTBOX_EVENT_ID_CONFLICT");
    if (replay.rows[0].event_type !== event.eventType ||
        replay.rows[0].entity_type !== event.entityType ||
        replay.rows[0].entity_id !== event.entityId) {
      throw new Error("REALTIME_OUTBOX_EVENT_ID_CONFLICT");
    }
    return { id: Number(replay.rows[0].id), eventId: replay.rows[0].event_id };
  }

  return { id: Number(rows[0].id), eventId: rows[0].event_id };
}

export type RealtimeEventInput = Omit<RealtimeEvent, "schemaVersion"> & { schemaVersion?: 1 };

export function realtimeEvent(input: RealtimeEventInput): RealtimeEvent {
  return validateRealtimeEvent({ ...input, schemaVersion: input.schemaVersion ?? 1 });
}

import type { QueryResultRow } from "pg";

import { query } from "@/lib/db";
import { pubsub } from "@/lib/pubsub";
import {
  publishRealtimeEvent,
  safePubSubLogValue,
  validateRealtimeEvent,
  type RealtimeEvent,
  type RealtimePublisher,
} from "../../../../packages/realtime/src/index";

type OutboxRow = QueryResultRow & {
  id: string | number;
  event_id: string;
  tenant_id: string;
  location_id: string | null;
  user_id: string | null;
  actor_type: RealtimeEvent["actorType"];
  actor_id: string | null;
  device_id: string | null;
  event_type: RealtimeEvent["eventType"];
  schema_version: number;
  entity_type: string;
  entity_id: string;
  aggregate_version: string | number | null;
  entity_updated_at: Date | string | null;
  safe_payload: Record<string, unknown>;
  occurred_at: Date | string;
  claim_token: string;
  attempts: number;
};

export type ClaimedRealtimeEvent = {
  claimToken: string;
  attempts: number;
  event: RealtimeEvent;
};

export interface RealtimeOutboxRepository {
  claim(limit: number, leaseMs: number): Promise<ClaimedRealtimeEvent[]>;
  ack(eventId: string, claimToken: string): Promise<boolean>;
  nack(
    eventId: string,
    claimToken: string,
    errorCode: string,
    maxAttempts: number,
    baseRetryMs: number,
  ): Promise<"PENDING" | "FAILED" | null>;
  cleanup(publishedRetentionSeconds: number, failedRetentionSeconds: number): Promise<number>;
}

function positiveInt(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToEvent(row: OutboxRow): RealtimeEvent {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    tenantId: row.tenant_id,
    locationId: row.location_id ?? undefined,
    userId: row.user_id ?? undefined,
    actorType: row.actor_type,
    actorId: row.actor_id ?? undefined,
    deviceId: row.device_id ?? undefined,
    entityType: row.entity_type,
    entityId: row.entity_id,
    aggregateVersion: row.aggregate_version == null ? undefined : Number(row.aggregate_version),
    updatedAt: row.entity_updated_at ? iso(row.entity_updated_at) : undefined,
    occurredAt: iso(row.occurred_at),
    payload: row.safe_payload,
  } as RealtimeEvent;
}

export const postgresRealtimeOutboxRepository: RealtimeOutboxRepository = {
  async claim(limit, leaseMs) {
    const { rows } = await query<OutboxRow>(
      "SELECT * FROM public.bms_claim_realtime_outbox($1, $2)",
      [limit, leaseMs],
    );
    return rows.map((row) => ({
      claimToken: row.claim_token,
      attempts: Number(row.attempts),
      event: rowToEvent(row),
    }));
  },

  async ack(eventId, claimToken) {
    const { rows } = await query<{ acknowledged: boolean }>(
      "SELECT public.bms_ack_realtime_outbox($1, $2) AS acknowledged",
      [eventId, claimToken],
    );
    return rows[0]?.acknowledged === true;
  },

  async nack(eventId, claimToken, errorCode, maxAttempts, baseRetryMs) {
    const { rows } = await query<{ status: "PENDING" | "FAILED" | null }>(
      "SELECT public.bms_nack_realtime_outbox($1, $2, $3, $4, $5) AS status",
      [eventId, claimToken, errorCode, maxAttempts, baseRetryMs],
    );
    return rows[0]?.status ?? null;
  },

  async cleanup(publishedRetentionSeconds, failedRetentionSeconds) {
    const { rows } = await query<{ deleted: string | number }>(
      "SELECT public.bms_cleanup_realtime_outbox($1, $2) AS deleted",
      [publishedRetentionSeconds, failedRetentionSeconds],
    );
    return Number(rows[0]?.deleted ?? 0);
  },
};

export type RealtimeDispatchResult = {
  claimed: number;
  published: number;
  retried: number;
  failed: number;
  leaseLost: number;
};

export async function runRealtimeOutboxDispatcher(input: {
  repository: RealtimeOutboxRepository;
  publisher: RealtimePublisher;
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  baseRetryMs: number;
}): Promise<RealtimeDispatchResult> {
  const claimed = await input.repository.claim(input.batchSize, input.leaseMs);
  const result: RealtimeDispatchResult = {
    claimed: claimed.length,
    published: 0,
    retried: 0,
    failed: 0,
    leaseLost: 0,
  };

  for (const item of claimed) {
    try {
      const event = validateRealtimeEvent(item.event);
      await publishRealtimeEvent(input.publisher, event);
      if (await input.repository.ack(event.eventId, item.claimToken)) result.published += 1;
      else result.leaseLost += 1;
    } catch (error) {
      const errorCode = error instanceof Error && error.name === "RealtimeEventValidationError"
        ? "INVALID_REALTIME_EVENT"
        : "REDIS_PUBLISH_FAILED";
      const status = await input.repository.nack(
        item.event.eventId,
        item.claimToken,
        errorCode,
        input.maxAttempts,
        input.baseRetryMs,
      );
      if (status === "FAILED") result.failed += 1;
      else if (status === "PENDING") result.retried += 1;
      else result.leaseLost += 1;
      console.error("[realtime-outbox] delivery failed", {
        ...safePubSubLogValue(item.event),
        errorCode,
        attempt: item.attempts,
        outcome: status ?? "LEASE_LOST",
      });
    }
  }

  return result;
}

export async function dispatchRealtimeOutboxBatch(): Promise<RealtimeDispatchResult> {
  return runRealtimeOutboxDispatcher({
    repository: postgresRealtimeOutboxRepository,
    publisher: pubsub,
    batchSize: positiveInt("REALTIME_OUTBOX_BATCH_SIZE", 100, 500),
    leaseMs: positiveInt("REALTIME_OUTBOX_LEASE_MS", 30_000, 900_000),
    maxAttempts: positiveInt("REALTIME_OUTBOX_MAX_ATTEMPTS", 12, 100),
    baseRetryMs: positiveInt("REALTIME_OUTBOX_BASE_RETRY_MS", 500, 60_000),
  });
}

export async function cleanupRealtimeOutbox(): Promise<{ deleted: number }> {
  const deleted = await postgresRealtimeOutboxRepository.cleanup(
    positiveInt("REALTIME_RETENTION_SECONDS", 7 * 86400, 365 * 86400),
    positiveInt("REALTIME_FAILED_RETENTION_SECONDS", 30 * 86400, 365 * 86400),
  );
  return { deleted };
}

const maintenanceState = globalThis as typeof globalThis & { __bmsRealtimeCleanupAt?: number };

/**
 * One dispatch pass plus retention, for every caller that drains the outbox.
 *
 * `cleanupRealtimeOutbox` and `bms_cleanup_realtime_outbox` existed with no caller at all,
 * so `REALTIME_RETENTION_SECONDS` described a policy nothing ever applied: published rows
 * accumulated for the life of the database on the hottest write path in the system (one row
 * per inventory row an import touches). Retention that nobody runs is not retention, so the
 * sweep rides along with the thing that is actually deployed — the dispatcher — rather than
 * waiting for a cron entry that does not exist yet.
 *
 * The clock is stamped before the delete, not after: a slow sweep must not let the next
 * dispatch iteration start a second one, and a failed sweep must wait its turn like any
 * other rather than being retried on every pass.
 */
export async function runRealtimeOutboxMaintenance(): Promise<
  RealtimeDispatchResult & { cleaned: number }
> {
  const dispatch = await dispatchRealtimeOutboxBatch();
  const interval = positiveInt("REALTIME_CLEANUP_INTERVAL_MS", 3_600_000, 86_400_000);
  if (Date.now() - (maintenanceState.__bmsRealtimeCleanupAt ?? 0) < interval) {
    return { ...dispatch, cleaned: 0 };
  }
  maintenanceState.__bmsRealtimeCleanupAt = Date.now();
  try {
    return { ...dispatch, cleaned: (await cleanupRealtimeOutbox()).deleted };
  } catch {
    console.error("[realtime-outbox] retention sweep failed", {
      errorCode: "REALTIME_CLEANUP_FAILED",
      nextAttemptInMs: interval,
    });
    return { ...dispatch, cleaned: 0 };
  }
}

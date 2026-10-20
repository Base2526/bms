import type { Pool } from "pg";
import {
  type OperationsDeliveryFeedV1,
  type OperationsDeliveryListQueryV1,
  type OperationsDeliveryState,
  type OperationsOverviewV1,
  type OperationsScopeQueryV1,
} from "@bms/fleet-delivery-contracts";
import { FleetDeliveryBusinessError } from "./phase2.js";
import { withTenantReadSnapshot } from "./transaction.js";

function asSafeCount(value: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new FleetDeliveryBusinessError("OPERATIONS_COUNT_OUT_OF_RANGE", 500);
  }
  return count;
}

function encodeDeliveryCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify([updatedAt, id]), "utf8").toString("base64url");
}

function decodeDeliveryCursor(cursor: string | undefined): { updatedAt: string | null; id: string | null } {
  if (!cursor) return { updatedAt: null, id: null };
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2
      || typeof value[0] !== "string" || typeof value[1] !== "string"
      || !/^\d{4}-\d{2}-\d{2}T/.test(value[0])
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value[1])
      || !Number.isFinite(new Date(value[0]).getTime())) {
      throw new Error("invalid cursor");
    }
    return { updatedAt: value[0], id: value[1] };
  } catch {
    throw new FleetDeliveryBusinessError("INVALID_OPERATIONS_DELIVERY_CURSOR", 422);
  }
}

export async function getOperationsOverview(
  pool: Pool,
  input: OperationsScopeQueryV1,
): Promise<OperationsOverviewV1> {
  return withTenantReadSnapshot(pool, input.tenantRef, async (client) => {
    const counts = await client.query<{ state: OperationsDeliveryState; count: string }>(
      `SELECT state, count(*)::text AS count
         FROM fleet_delivery.deliveries
        WHERE tenant_ref=$1 AND branch_ref=$2
        GROUP BY state
        ORDER BY state`,
      [input.tenantRef, input.branchRef],
    );
    const manual = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM fleet_delivery.dispatch_manual_queue
        WHERE tenant_ref=$1 AND branch_ref=$2 AND status='OPEN'`,
      [input.tenantRef, input.branchRef],
    );
    const reconciliation = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM fleet_delivery.inbox_events
        WHERE tenant_ref=$1 AND branch_ref=$2 AND status='ACTION_REQUIRED'`,
      [input.tenantRef, input.branchRef],
    );
    const latest = await client.query<{ updated_at: Date | null }>(
      `SELECT max(updated_at) AS updated_at
         FROM fleet_delivery.deliveries
        WHERE tenant_ref=$1 AND branch_ref=$2`,
      [input.tenantRef, input.branchRef],
    );
    return {
      serverNow: new Date().toISOString(),
      deliveryCounts: counts.rows.map((row) => ({ state: row.state, count: asSafeCount(row.count) })),
      openManualDispatchCount: asSafeCount(manual.rows[0]?.count ?? "0"),
      actionRequiredIntegrationCount: asSafeCount(reconciliation.rows[0]?.count ?? "0"),
      lastDeliveryUpdatedAt: latest.rows[0]?.updated_at?.toISOString() ?? null,
    };
  });
}

export async function listOperationsDeliveries(
  pool: Pool,
  input: OperationsDeliveryListQueryV1,
): Promise<OperationsDeliveryFeedV1> {
  return withTenantReadSnapshot(pool, input.tenantRef, async (client) => {
    const cursor = decodeDeliveryCursor(input.cursor);
    const result = await client.query<{
      id: string;
      bms_order_ref: string;
      state: OperationsDeliveryState;
      version: string;
      created_at: Date;
      updated_at: Date;
      cursor_updated_at: string;
    }>(
      `SELECT id, bms_order_ref, state, version, created_at, updated_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_updated_at
         FROM fleet_delivery.deliveries
        WHERE tenant_ref=$1 AND branch_ref=$2
          AND ($3::text IS NULL OR state=$3)
          AND ($4::timestamptz IS NULL OR (updated_at, id) < ($4::timestamptz, $5::uuid))
        ORDER BY updated_at DESC, id DESC
        LIMIT $6`,
      [input.tenantRef, input.branchRef, input.state ?? null, cursor.updatedAt, cursor.id, input.limit + 1],
    );
    const hasMore = result.rows.length > input.limit;
    const rows = result.rows.slice(0, input.limit);
    const last = rows.at(-1);
    return {
      serverNow: new Date().toISOString(),
      deliveries: rows.map((row) => ({
        deliveryId: row.id,
        bmsOrderRef: row.bms_order_ref,
        state: row.state,
        version: asSafeCount(row.version),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
      nextCursor: hasMore && last ? encodeDeliveryCursor(last.cursor_updated_at, last.id) : null,
    };
  });
}

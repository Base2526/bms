import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import {
  IDEMPOTENCY_CONFLICT_MESSAGE,
  IdempotencyConflictError,
} from "./idempotencyErrors";

export type BoardGameIdempotency = {
  action: string;
  key: string;
  requestHash: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

export function boardGameIdempotency(
  action: string,
  keyInput: string,
  request: unknown
): BoardGameIdempotency {
  const key = keyInput.trim();
  if (key.length < 8 || key.length > 200) {
    throw new Error("idempotencyKey ไม่ถูกต้อง");
  }
  return {
    action,
    key,
    requestHash: createHash("sha256")
      .update(JSON.stringify(canonicalize(request)))
      .digest("hex"),
  };
}

export async function replayBoardGameResult<T>(
  client: PoolClient,
  tenantId: string,
  request: BoardGameIdempotency
): Promise<T | null> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `board-game:${tenantId}:${request.action}:${request.key}`,
  ]);
  const found = await client.query<{ request_hash: string; result: T }>(
    `SELECT request_hash, result
       FROM bms_board_game_idempotency_results
      WHERE tenant_id = $1 AND action = $2 AND idempotency_key = $3`,
    [tenantId, request.action, request.key]
  );
  if (!found.rowCount) return null;
  if (found.rows[0].request_hash !== request.requestHash) {
    throw new IdempotencyConflictError(
      IDEMPOTENCY_CONFLICT_MESSAGE,
      request.action,
    );
  }
  return found.rows[0].result;
}

export async function storeBoardGameResult(
  client: PoolClient,
  tenantId: string,
  request: BoardGameIdempotency,
  result: unknown
): Promise<void> {
  await client.query(
    `INSERT INTO bms_board_game_idempotency_results
       (tenant_id, action, idempotency_key, request_hash, result)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [
      tenantId,
      request.action,
      request.key,
      request.requestHash,
      JSON.stringify(result),
    ]
  );
}

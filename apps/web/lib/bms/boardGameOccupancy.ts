import type { QueryResult, QueryResultRow } from "pg";

type QueryClient = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

export type BoardGameOccupancyEndReason = "CLOSED" | "MOVED" | "MERGED_INTO" | "CANCELLED";
export type BoardGameSessionOccupancyEndReason = "CLOSED" | "MOVED" | "MERGED" | "DETACHED" | "CANCELLED";

/** Caller owns the tenant transaction and has already locked the table/seating. */
export async function openTableOccupancyInTx(
  client: QueryClient,
  tenantId: string,
  input: { locationId: string; tableId: string; seatingId: string; startedAt: Date },
) {
  await client.query(
    `INSERT INTO bms_board_game_table_occupancy
       (tenant_id, location_id, table_id, seating_id, started_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [tenantId, input.locationId, input.tableId, input.seatingId, input.startedAt],
  );
}

/** Close the one live interval for this seating. Replays are harmless. */
export async function closeTableOccupancyInTx(
  client: QueryClient,
  tenantId: string,
  seatingId: string,
  endedAt: Date,
  reason: BoardGameOccupancyEndReason,
) {
  await client.query(
    `UPDATE bms_board_game_table_occupancy
        SET ended_at = GREATEST($3::timestamptz, started_at), end_reason = $4, updated_at = now()
      WHERE tenant_id = $1 AND seating_id = $2 AND ended_at IS NULL`,
    [tenantId, seatingId, endedAt, reason],
  );
}

/** Preserve the table split when one physical seating moves to another table. */
export async function moveTableOccupancyInTx(
  client: QueryClient,
  tenantId: string,
  input: { locationId: string; tableId: string; seatingId: string; movedAt: Date },
) {
  await closeTableOccupancyInTx(client, tenantId, input.seatingId, input.movedAt, "MOVED");
  await openTableOccupancyInTx(client, tenantId, {
    locationId: input.locationId,
    tableId: input.tableId,
    seatingId: input.seatingId,
    startedAt: input.movedAt,
  });
}

export async function openSessionTableOccupancyInTx(
  client: QueryClient,
  tenantId: string,
  input: { locationId: string; tableId: string; sessionId: string; startedAt: Date },
) {
  await client.query(
    `INSERT INTO bms_board_game_session_table_occupancy
       (tenant_id,location_id,session_id,table_id,started_at)
     SELECT $1,$2,$3,$4,$5
      WHERE EXISTS (SELECT 1 FROM bms_board_game_sessions
        WHERE tenant_id=$1 AND location_id=$2 AND id=$3 AND status IN ('OPEN','CLOSING'))`,
    [tenantId, input.locationId, input.sessionId, input.tableId, input.startedAt],
  );
}

export async function closeSessionTableOccupancyInTx(
  client: QueryClient,
  tenantId: string,
  sessionId: string,
  endedAt: Date,
  reason: BoardGameSessionOccupancyEndReason,
) {
  await client.query(
    `UPDATE bms_board_game_session_table_occupancy
        SET ended_at=GREATEST($3::timestamptz,started_at),end_reason=$4,updated_at=now()
      WHERE tenant_id=$1 AND session_id=$2 AND ended_at IS NULL`,
    [tenantId, sessionId, endedAt, reason],
  );
}

export async function moveSessionsTableOccupancyInTx(
  client: QueryClient,
  tenantId: string,
  input: { locationId: string; tableId: string; sessionIds: string[]; movedAt: Date; reason: "MOVED" | "MERGED" },
) {
  for (const sessionId of input.sessionIds) {
    await closeSessionTableOccupancyInTx(client, tenantId, sessionId, input.movedAt, input.reason);
    await openSessionTableOccupancyInTx(client, tenantId, {
      locationId: input.locationId, tableId: input.tableId, sessionId, startedAt: input.movedAt,
    });
  }
}

/** A detached billing group becomes a new session but inherits its source table path up to detachment. */
export async function cloneSessionTableHistoryForDetachInTx(
  client: QueryClient,
  tenantId: string,
  input: { sourceSessionId: string; sessionId: string; locationId: string; targetTableId: string; detachedAt: Date },
) {
  await client.query(
    `INSERT INTO bms_board_game_session_table_occupancy
       (tenant_id,location_id,session_id,table_id,started_at,ended_at,end_reason,backfilled)
     SELECT tenant_id,location_id,$3,table_id,started_at,
            LEAST(COALESCE(ended_at,$4::timestamptz),$4::timestamptz),
            CASE WHEN ended_at IS NULL OR ended_at > $4::timestamptz THEN 'DETACHED' ELSE end_reason END,
            backfilled
       FROM bms_board_game_session_table_occupancy
      WHERE tenant_id=$1 AND session_id=$2 AND started_at < $4::timestamptz
      ORDER BY started_at`,
    [tenantId, input.sourceSessionId, input.sessionId, input.detachedAt],
  );
  await openSessionTableOccupancyInTx(client, tenantId, {
    locationId: input.locationId,
    tableId: input.targetTableId,
    sessionId: input.sessionId,
    startedAt: input.detachedAt,
  });
}

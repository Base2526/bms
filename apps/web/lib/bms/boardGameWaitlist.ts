import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import {
  openBoardGameSessionInTx,
  requireBoardGameCafeTenant,
  type BoardGameBillingMode,
  type BoardGameParticipantInput,
} from "./boardGameCafe";
import {
  boardGameIdempotency,
  replayBoardGameResult,
  storeBoardGameResult,
} from "./boardGameIdempotency";
import { beginTenantTx } from "./tenant";

export type BoardGameWaitlistStatus =
  | "WAITING" | "CALLED" | "SEATED" | "CANCELLED" | "NO_SHOW";

type WaitlistRow = {
  id: string;
  service_date: Date | string;
  queue_no: number;
  status: BoardGameWaitlistStatus;
  party_size: number;
  guest_name: string | null;
  guest_phone: string | null;
  note: string | null;
  preferred_area_id: string | null;
  preferred_area_name: string | null;
  seated_table_id: string | null;
  seated_table_code: string | null;
  seated_session_id: string | null;
  called_at: Date | string | null;
  seated_at: Date | string | null;
  closed_at: Date | string | null;
  created_at: Date | string;
};

const SERVICE_DATE_SQL = `(
  (now() AT TIME ZONE COALESCE(NULLIF(profile.timezone, ''), 'Asia/Bangkok'))
  - INTERVAL '4 hours'
)::date`;

const SELECT_COLUMNS = `w.id, w.service_date, w.queue_no, w.status, w.party_size,
  w.guest_name, w.guest_phone, w.note, w.preferred_area_id, area.name AS preferred_area_name,
  w.seated_table_id, table_row.code AS seated_table_code, w.seated_session_id,
  w.called_at, w.seated_at, w.closed_at, w.created_at`;

const SELECT_JOINS = `LEFT JOIN bms_board_game_areas area
    ON area.tenant_id = w.tenant_id AND area.location_id = w.location_id
   AND area.id = w.preferred_area_id
  LEFT JOIN bms_board_game_tables table_row
    ON table_row.tenant_id = w.tenant_id AND table_row.location_id = w.location_id
   AND table_row.id = w.seated_table_id`;

const iso = (value: Date | string | null) =>
  value == null ? null : value instanceof Date ? value.toISOString() : String(value);

function mapEntry(row: WaitlistRow) {
  return {
    id: row.id,
    serviceDate: String(row.service_date).slice(0, 10),
    queueNo: Number(row.queue_no),
    status: row.status,
    partySize: Number(row.party_size),
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    note: row.note,
    preferredAreaId: row.preferred_area_id,
    preferredAreaName: row.preferred_area_name,
    seatedTableId: row.seated_table_id,
    seatedTableCode: row.seated_table_code,
    seatedSessionId: row.seated_session_id,
    calledAt: iso(row.called_at),
    seatedAt: iso(row.seated_at),
    closedAt: iso(row.closed_at),
    createdAt: iso(row.created_at),
  };
}

function boundedText(value: unknown, max: number): string | null {
  const normalized = typeof value === "string" ? value.trim().slice(0, max) : "";
  return normalized || null;
}

function positiveInteger(value: unknown, label: string, max = 500): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${label}ไม่ถูกต้อง`);
  }
  return parsed;
}

async function auditInTx(
  client: PoolClient,
  tenantId: string,
  actorUserId: string,
  action: string,
  target: string,
  meta: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [tenantId, `user:${actorUserId}`, action, target, JSON.stringify(meta)],
  );
}

export async function getBoardGameWaitlistEntry(tenantId: string, entryId: string) {
  const result = await query<WaitlistRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM bms_board_game_waitlist w
       ${SELECT_JOINS}
      WHERE w.tenant_id = $1 AND w.id = $2`,
    [tenantId, entryId],
  );
  return result.rowCount ? mapEntry(result.rows[0]) : null;
}

/** Open rows never age off the board; only terminal rows are limited to today's service day. */
export async function listBoardGameWaitlist(tenantId: string, locationId: string) {
  await requireBoardGameCafeTenant({ query }, tenantId);
  const [entriesResult, availabilityResult] = await Promise.all([
    query<WaitlistRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM bms_board_game_waitlist w
         ${SELECT_JOINS}
         LEFT JOIN bms_store_profile profile ON profile.tenant_id = w.tenant_id
        WHERE w.tenant_id = $1 AND w.location_id = $2
          AND (w.status IN ('WAITING','CALLED') OR w.service_date = ${SERVICE_DATE_SQL})
        ORDER BY (w.status IN ('WAITING','CALLED')) DESC, w.created_at, w.queue_no`,
      [tenantId, locationId],
    ),
    query<{
      id: string; area_id: string; code: string; name: string; seats: number;
      availability: "AVAILABLE" | "OCCUPIED" | "BLOCKED";
      expected_available_at: Date | string | null;
    }>(
      `SELECT t.id, t.area_id, t.code, t.name, t.seats,
              CASE WHEN t.blocked THEN 'BLOCKED'
                   WHEN st.id IS NULL THEN 'AVAILABLE' ELSE 'OCCUPIED' END AS availability,
              active.expected_available_at
         FROM bms_board_game_tables t
         LEFT JOIN bms_board_game_seatings st
           ON st.tenant_id = t.tenant_id AND st.location_id = t.location_id
          AND st.table_id = t.id AND st.status = 'ACTIVE'
         LEFT JOIN LATERAL (
           SELECT CASE WHEN bool_or(s.status = 'CLOSING' OR s.expected_end_at IS NULL) THEN NULL
                       ELSE max(s.expected_end_at) END AS expected_available_at
             FROM bms_board_game_sessions s
            WHERE s.tenant_id = st.tenant_id AND s.seating_id = st.id
              AND s.status IN ('OPEN','CLOSING')
         ) active ON st.id IS NOT NULL
        WHERE t.tenant_id = $1 AND t.location_id = $2 AND t.active
        ORDER BY t.sort_order, t.code`,
      [tenantId, locationId],
    ),
  ]);
  const entries = entriesResult.rows.map(mapEntry);
  const open = entries.filter((entry) => entry.status === "WAITING" || entry.status === "CALLED");
  return {
    entries,
    waitingCount: open.filter((entry) => entry.status === "WAITING").length,
    calledCount: open.filter((entry) => entry.status === "CALLED").length,
    waitingGuests: open.reduce((sum, entry) => sum + entry.partySize, 0),
    longestWaitMinutes: open.length
      ? Math.max(...open.map((entry) => Math.max(0, Math.floor((Date.now() - Date.parse(entry.createdAt!)) / 60_000))))
      : 0,
    tables: availabilityResult.rows.map((row) => ({
      id: row.id,
      areaId: row.area_id,
      code: row.code,
      name: row.name,
      seats: Number(row.seats),
      availability: row.availability,
      expectedAvailableAt: iso(row.expected_available_at),
    })),
  };
}

export async function addBoardGameWaitlistEntry(input: {
  tenantId: string;
  locationId: string;
  actorUserId: string;
  idempotencyKey: string;
  partySize: number;
  guestName?: string | null;
  guestPhone?: string | null;
  note?: string | null;
  preferredAreaId?: string | null;
}) {
  const partySize = positiveInteger(input.partySize, "จำนวนผู้เล่น");
  const normalized = {
    locationId: input.locationId,
    partySize,
    guestName: boundedText(input.guestName, 120),
    guestPhone: boundedText(input.guestPhone, 40),
    note: boundedText(input.note, 300),
    preferredAreaId: boundedText(input.preferredAreaId, 64),
  };
  const idempotency = boardGameIdempotency("waitlist.add", input.idempotencyKey, normalized);
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    await requireBoardGameCafeTenant(client, input.tenantId);
    const replay = await replayBoardGameResult<{ entryId: string }>(client, input.tenantId, idempotency);
    if (replay) {
      await client.query("COMMIT");
      return getBoardGameWaitlistEntry(input.tenantId, replay.entryId);
    }
    // Serialise the number allocator per branch/service day without relying on retry timing.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `board-game-waitlist-number:${input.tenantId}:${input.locationId}`,
    ]);
    const inserted = await client.query<{ id: string; queue_no: number }>(
      `WITH day AS (
         SELECT ${SERVICE_DATE_SQL} AS service_date
           FROM bms_locations location
           LEFT JOIN bms_store_profile profile ON profile.tenant_id = location.tenant_id
          WHERE location.tenant_id = $1 AND location.id = $2
       )
       INSERT INTO bms_board_game_waitlist
         (tenant_id, location_id, service_date, queue_no, party_size, guest_name, guest_phone,
          note, preferred_area_id, created_by)
       SELECT $1, $2, day.service_date,
              COALESCE((SELECT max(w.queue_no) FROM bms_board_game_waitlist w
                         WHERE w.tenant_id = $1 AND w.location_id = $2
                           AND w.service_date = day.service_date), 0) + 1,
              $3,$4,$5,$6,$7,$8
         FROM day
       RETURNING id, queue_no`,
      [input.tenantId, input.locationId, partySize, normalized.guestName, normalized.guestPhone,
        normalized.note, normalized.preferredAreaId, input.actorUserId],
    );
    if (!inserted.rowCount) throw new Error("ไม่พบสาขานี้");
    const row = inserted.rows[0];
    await storeBoardGameResult(client, input.tenantId, idempotency, { entryId: row.id });
    await auditInTx(client, input.tenantId, input.actorUserId, "board_game.waitlist_add", row.id, {
      locationId: input.locationId, partySize, queueNo: Number(row.queue_no),
    });
    await client.query("COMMIT");
    return getBoardGameWaitlistEntry(input.tenantId, row.id);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function updateEntry(input: {
  tenantId: string; locationId: string; actorUserId: string; entryId: string;
  idempotencyKey: string; action: "call" | "cancel" | "no_show"; reason?: string | null;
}) {
  const reason = boundedText(input.reason, 200);
  const action = `waitlist.${input.action}`;
  const idempotency = boardGameIdempotency(action, input.idempotencyKey, {
    locationId: input.locationId, entryId: input.entryId, reason,
  });
  const targetStatus = input.action === "call" ? "CALLED"
    : input.action === "no_show" ? "NO_SHOW" : "CANCELLED";
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    await requireBoardGameCafeTenant(client, input.tenantId);
    const replay = await replayBoardGameResult<{ entryId: string }>(client, input.tenantId, idempotency);
    if (replay) {
      await client.query("COMMIT");
      return getBoardGameWaitlistEntry(input.tenantId, replay.entryId);
    }
    const updated = await client.query<{ id: string }>(
      `UPDATE bms_board_game_waitlist
          SET status = $5,
              called_at = CASE WHEN $5 = 'CALLED' THEN COALESCE(called_at, now()) ELSE called_at END,
              closed_at = CASE WHEN $5 IN ('CANCELLED','NO_SHOW') THEN now() ELSE closed_at END,
              note = CASE WHEN $6::text IS NULL THEN note ELSE concat_ws(E'\\n', note, $6::text) END,
              updated_by = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND location_id = $3
          AND (($5 = 'CALLED' AND status = 'WAITING')
            OR ($5 IN ('CANCELLED','NO_SHOW') AND status IN ('WAITING','CALLED')))
       RETURNING id`,
      [input.tenantId, input.entryId, input.locationId, input.actorUserId, targetStatus, reason],
    );
    if (!updated.rowCount) throw new Error("คิวนี้ปิดไปแล้วหรือสถานะไม่อนุญาตให้ทำรายการนี้");
    await storeBoardGameResult(client, input.tenantId, idempotency, { entryId: input.entryId });
    await auditInTx(client, input.tenantId, input.actorUserId, `board_game.waitlist_${input.action}`,
      input.entryId, { status: targetStatus });
    await client.query("COMMIT");
    return getBoardGameWaitlistEntry(input.tenantId, input.entryId);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export const callBoardGameWaitlistEntry = (input: Omit<Parameters<typeof updateEntry>[0], "action">) =>
  updateEntry({ ...input, action: "call" });

export const closeBoardGameWaitlistEntry = (
  input: Omit<Parameters<typeof updateEntry>[0], "action"> & { status: "CANCELLED" | "NO_SHOW" },
) => updateEntry({ ...input, action: input.status === "NO_SHOW" ? "no_show" : "cancel" });

export async function seatBoardGameWaitlistEntry(input: {
  tenantId: string;
  locationId: string;
  deviceId: string;
  shiftId: string;
  actorUserId: string;
  entryId: string;
  tableId: string;
  idempotencyKey: string;
  billingMode?: BoardGameBillingMode;
  expectedDurationMinutes?: number | null;
  alertBeforeMinutes?: number | null;
  participants: BoardGameParticipantInput[];
  note?: string | null;
}) {
  const idempotency = boardGameIdempotency("waitlist.seat", input.idempotencyKey, {
    locationId: input.locationId, entryId: input.entryId, tableId: input.tableId,
    billingMode: input.billingMode ?? "OPEN_ENDED",
    expectedDurationMinutes: input.expectedDurationMinutes ?? null,
    alertBeforeMinutes: input.alertBeforeMinutes ?? 15,
    participants: input.participants,
    note: boundedText(input.note, 300),
  });
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    await requireBoardGameCafeTenant(client, input.tenantId);
    const replay = await replayBoardGameResult<{ entryId: string; session: Record<string, unknown> }>(
      client, input.tenantId, idempotency,
    );
    if (replay) {
      await client.query("COMMIT");
      return { entry: await getBoardGameWaitlistEntry(input.tenantId, replay.entryId), session: replay.session };
    }
    const entry = await client.query<{ party_size: number }>(
      `SELECT party_size FROM bms_board_game_waitlist
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3
          AND status IN ('WAITING','CALLED')
        FOR UPDATE`,
      [input.tenantId, input.locationId, input.entryId],
    );
    if (!entry.rowCount) throw new Error("คิวนี้ปิดไปแล้วหรือได้โต๊ะไปแล้ว");
    if (!Array.isArray(input.participants) || input.participants.length < 1) {
      throw new Error("ต้องระบุผู้เล่นอย่างน้อย 1 คนก่อนพาไปนั่ง");
    }
    const table = await client.query<{ seats: number }>(
      `SELECT seats FROM bms_board_game_tables
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND active AND NOT blocked
        FOR UPDATE`,
      [input.tenantId, input.locationId, input.tableId],
    );
    if (!table.rowCount) throw new Error("ไม่พบโต๊ะบอร์ดเกมที่เปิดใช้งานอยู่ในสาขานี้");
    if (Number(table.rows[0].seats) < input.participants.length) {
      throw new Error("โต๊ะนี้รองรับจำนวนผู้เล่นจริงไม่พอ");
    }
    const session = await openBoardGameSessionInTx(client, input.tenantId, {
      idempotencyKey: `waitlist-seat:${idempotency.requestHash}`,
      locationId: input.locationId,
      tableId: input.tableId,
      billingMode: input.billingMode,
      expectedDurationMinutes: input.expectedDurationMinutes,
      alertBeforeMinutes: input.alertBeforeMinutes,
      participants: input.participants,
      posDeviceId: input.deviceId,
      posShiftId: input.shiftId,
      note: boundedText(input.note, 300),
    }, input.actorUserId);
    const sessionId = String((session as { id?: unknown }).id ?? "");
    if (!sessionId) throw new Error("เปิด session จากคิวไม่สำเร็จ");
    await client.query(
      `UPDATE bms_board_game_waitlist
          SET status = 'SEATED', seated_table_id = $4, seated_session_id = $5,
              seated_at = now(), closed_at = now(), updated_by = $6, updated_at = now()
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3`,
      [input.tenantId, input.locationId, input.entryId, input.tableId, sessionId, input.actorUserId],
    );
    const response = { entryId: input.entryId, session: session as unknown as Record<string, unknown> };
    await storeBoardGameResult(client, input.tenantId, idempotency, response);
    await auditInTx(client, input.tenantId, input.actorUserId, "board_game.waitlist_seat", input.entryId, {
      tableId: input.tableId, sessionId, queuedPartySize: Number(entry.rows[0].party_size),
      actualPartySize: input.participants.length,
    });
    await client.query("COMMIT");
    return { entry: await getBoardGameWaitlistEntry(input.tenantId, input.entryId), session };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { getClient, query } from "@/lib/db";
import { sendEmail } from "@/lib/mailer";
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
  | "REQUESTED" | "CONFIRMED" | "WAITING" | "CALLED" | "SEATED" | "CANCELLED"
  | "NO_SHOW" | "REJECTED";

type WaitlistRow = {
  id: string;
  kind: "WALK_IN" | "RESERVATION";
  service_date: Date | string;
  queue_no: number | null;
  status: BoardGameWaitlistStatus;
  party_size: number;
  guest_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  note: string | null;
  preferred_area_id: string | null;
  preferred_area_name: string | null;
  reserved_for: Date | string | null;
  reserved_duration_minutes: number | null;
  reserved_table_id: string | null;
  reserved_table_code: string | null;
  confirmed_at: Date | string | null;
  checked_in_at: Date | string | null;
  source: "STAFF" | "PUBLIC";
  reviewed_at: Date | string | null;
  rejection_reason: string | null;
  reminder_status: "NONE" | "PENDING" | "SENDING" | "SENT" | "FAILED";
  reminder_sent_at: Date | string | null;
  public_request_hash?: string | null;
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

const SELECT_COLUMNS = `w.id, w.kind, w.service_date, w.queue_no, w.status, w.party_size,
  w.guest_name, w.guest_phone, w.guest_email, w.note, w.preferred_area_id, area.name AS preferred_area_name,
  w.reserved_for, w.reserved_duration_minutes, w.reserved_table_id,
  reserved_table.code AS reserved_table_code, w.confirmed_at, w.checked_in_at, w.source,
  w.reviewed_at, w.rejection_reason, w.reminder_status, w.reminder_sent_at,
  w.seated_table_id, table_row.code AS seated_table_code, w.seated_session_id,
  w.called_at, w.seated_at, w.closed_at, w.created_at`;

const SELECT_JOINS = `LEFT JOIN bms_board_game_areas area
    ON area.tenant_id = w.tenant_id AND area.location_id = w.location_id
   AND area.id = w.preferred_area_id
  LEFT JOIN bms_board_game_tables table_row
    ON table_row.tenant_id = w.tenant_id AND table_row.location_id = w.location_id
   AND table_row.id = w.seated_table_id
  LEFT JOIN bms_board_game_tables reserved_table
    ON reserved_table.tenant_id = w.tenant_id AND reserved_table.location_id = w.location_id
   AND reserved_table.id = w.reserved_table_id`;

const iso = (value: Date | string | null) =>
  value == null ? null : value instanceof Date ? value.toISOString() : String(value);

function mapEntry(row: WaitlistRow) {
  return {
    id: row.id,
    kind: row.kind,
    serviceDate: String(row.service_date).slice(0, 10),
    queueNo: row.queue_no == null ? null : Number(row.queue_no),
    status: row.status,
    partySize: Number(row.party_size),
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    guestEmail: row.guest_email,
    note: row.note,
    preferredAreaId: row.preferred_area_id,
    preferredAreaName: row.preferred_area_name,
    reservedFor: iso(row.reserved_for),
    reservedDurationMinutes: row.reserved_duration_minutes == null
      ? null : Number(row.reserved_duration_minutes),
    reservedTableId: row.reserved_table_id,
    reservedTableCode: row.reserved_table_code,
    confirmedAt: iso(row.confirmed_at),
    checkedInAt: iso(row.checked_in_at),
    source: row.source,
    reviewedAt: iso(row.reviewed_at),
    rejectionReason: row.rejection_reason,
    reminderStatus: row.reminder_status,
    reminderSentAt: iso(row.reminder_sent_at),
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
          AND (w.status IN ('WAITING','CALLED','REQUESTED')
            OR w.status = 'CONFIRMED'
            OR w.service_date = ${SERVICE_DATE_SQL})
        ORDER BY (w.status = 'REQUESTED') DESC, (w.status IN ('WAITING','CALLED')) DESC,
                 (w.status = 'CONFIRMED') DESC, COALESCE(w.reserved_for, w.created_at), w.queue_no`,
      [tenantId, locationId],
    ),
    query<{
      id: string; area_id: string; code: string; name: string; seats: number;
      availability: "AVAILABLE" | "OCCUPIED" | "BLOCKED";
      expected_available_at: Date | string | null;
      next_reserved_at: Date | string | null;
      next_reserved_until: Date | string | null;
    }>(
      `SELECT t.id, t.area_id, t.code, t.name, t.seats,
              CASE WHEN t.blocked THEN 'BLOCKED'
                   WHEN st.id IS NULL THEN 'AVAILABLE' ELSE 'OCCUPIED' END AS availability,
              active.expected_available_at,
              next_booking.reserved_for AS next_reserved_at,
              next_booking.reserved_for
                + make_interval(mins => next_booking.reserved_duration_minutes)
                AS next_reserved_until
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
         LEFT JOIN LATERAL (
           SELECT w.reserved_for, w.reserved_duration_minutes
             FROM bms_board_game_waitlist w
            WHERE w.tenant_id = t.tenant_id AND w.location_id = t.location_id
              AND w.reserved_table_id = t.id AND w.kind = 'RESERVATION'
              AND w.status = 'CONFIRMED'
              AND w.reserved_for + make_interval(mins => w.reserved_duration_minutes) > now()
            ORDER BY w.reserved_for
            LIMIT 1
         ) next_booking ON TRUE
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
    confirmedReservationCount: entries.filter((entry) => entry.status === "CONFIRMED").length,
    requestedReservationCount: entries.filter((entry) => entry.status === "REQUESTED").length,
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
      nextReservedAt: iso(row.next_reserved_at),
      nextReservedUntil: iso(row.next_reserved_until),
    })),
  };
}

function reservationInstant(value: unknown): Date {
  const parsed = new Date(String(value ?? ""));
  const now = Date.now();
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= now) {
    throw new Error("เวลาจองต้องเป็นเวลาในอนาคต");
  }
  if (parsed.getTime() > now + 366 * 24 * 60 * 60_000) {
    throw new Error("รับจองล่วงหน้าได้ไม่เกิน 366 วัน");
  }
  return parsed;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function publicToken(value: unknown): string {
  const token = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error("รหัสคำขอจองไม่ถูกต้อง");
  return token;
}

function emailAddress(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("อีเมลไม่ถูกต้อง");
  }
  return email;
}

function publicReservationView(row: WaitlistRow & { location_name?: string | null }) {
  return {
    status: row.status,
    partySize: Number(row.party_size),
    reservedFor: iso(row.reserved_for),
    reservedDurationMinutes: Number(row.reserved_duration_minutes),
    locationName: row.location_name ?? null,
    reservedTableCode: row.status === "CONFIRMED" ? row.reserved_table_code : null,
    rejectionReason: row.status === "REJECTED" ? row.rejection_reason : null,
  };
}

/** Public self-service creates a review request only; it never chooses or promises a table. */
export async function requestPublicBoardGameReservation(input: {
  tenantSlug: string; locationId: string; requestToken: string; reservedFor: string;
  durationMinutes: number; partySize: number; guestName: string; guestPhone?: string | null;
  guestEmail: string; note?: string | null;
}) {
  const token = publicToken(input.requestToken);
  const tokenHash = sha256(token);
  const reservedFor = reservationInstant(input.reservedFor);
  const durationMinutes = positiveInteger(input.durationMinutes, "ระยะเวลาจอง", 720);
  if (durationMinutes < 30) throw new Error("ระยะเวลาจองต้องอย่างน้อย 30 นาที");
  const partySize = positiveInteger(input.partySize, "จำนวนผู้เล่น");
  const guestName = boundedText(input.guestName, 120);
  if (!guestName) throw new Error("กรุณาระบุชื่อผู้จอง");
  const guestEmail = emailAddress(input.guestEmail);
  const normalized = {
    reservedFor: reservedFor.toISOString(), durationMinutes, partySize, guestName,
    guestPhone: boundedText(input.guestPhone, 40), guestEmail, note: boundedText(input.note, 300),
  };
  const requestHash = sha256(JSON.stringify(normalized));
  const tenant = await query<{ tenant_id: string }>(
    `SELECT profile.tenant_id
       FROM bms_board_game_public_locations profile
       JOIN bms_tenants tenant ON tenant.id = profile.tenant_id AND tenant.active
       JOIN bms_locations location
         ON location.tenant_id = profile.tenant_id AND location.id = profile.location_id
        AND location.active
       JOIN bms_store_profile store
         ON store.tenant_id = profile.tenant_id AND store.business_archetype = 'board_game_cafe'
      WHERE tenant.slug = $1 AND profile.location_id = $2
        AND profile.public_visible AND profile.booking_enabled`,
    [boundedText(input.tenantSlug, 120), input.locationId],
  );
  if (!tenant.rowCount) throw new Error("สาขานี้ยังไม่เปิดรับคำขอจองออนไลน์");
  const tenantId = tenant.rows[0].tenant_id;
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const existing = await client.query<WaitlistRow & { location_name: string }>(
      `SELECT ${SELECT_COLUMNS}, w.public_request_hash, location.name AS location_name
         FROM bms_board_game_waitlist w
         ${SELECT_JOINS}
         JOIN bms_locations location
           ON location.tenant_id = w.tenant_id AND location.id = w.location_id
        WHERE w.tenant_id = $1 AND w.location_id = $2 AND w.public_request_key_hash = $3`,
      [tenantId, input.locationId, tokenHash],
    );
    if (existing.rowCount) {
      if (existing.rows[0].public_request_hash !== requestHash) {
        throw new Error("รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว");
      }
      await client.query("COMMIT");
      return publicReservationView(existing.rows[0]);
    }
    const inserted = await client.query<{ id: string }>(
      `WITH config AS (
         SELECT profile.tenant_id, profile.location_id,
                profile.reservation_reminder_minutes,
                COALESCE(NULLIF(store.timezone, ''), 'Asia/Bangkok') AS timezone
           FROM bms_board_game_public_locations profile
           JOIN bms_store_profile store
             ON store.tenant_id = profile.tenant_id AND store.business_archetype = 'board_game_cafe'
           JOIN bms_tenants tenant ON tenant.id = profile.tenant_id AND tenant.active
           JOIN bms_locations location
             ON location.tenant_id = profile.tenant_id AND location.id = profile.location_id
            AND location.active
          WHERE profile.tenant_id = $1 AND profile.location_id = $2
            AND profile.public_visible AND profile.booking_enabled
       )
       INSERT INTO bms_board_game_waitlist
         (tenant_id, location_id, kind, source, service_date, status, party_size,
          guest_name, guest_phone, guest_email, note, reserved_for, reserved_duration_minutes,
          public_manage_token_hash, public_request_key_hash, public_request_hash, reminder_minutes_before,
          reminder_status, created_by)
       SELECT config.tenant_id, config.location_id, 'RESERVATION', 'PUBLIC',
              (($3::timestamptz AT TIME ZONE config.timezone) - INTERVAL '4 hours')::date,
              'REQUESTED', $5, $6, $7, $8, $9, $3, $4, $10, $10, $11,
              config.reservation_reminder_minutes, 'NONE', NULL
         FROM config
       RETURNING id`,
      [tenantId, input.locationId, reservedFor.toISOString(), durationMinutes, partySize,
        guestName, normalized.guestPhone, guestEmail, normalized.note, tokenHash, requestHash],
    );
    if (!inserted.rowCount) throw new Error("สาขานี้ยังไม่เปิดรับคำขอจองออนไลน์");
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,'public:reservation','board_game.reservation_request',$2,$3::jsonb)`,
      [tenantId, inserted.rows[0].id, JSON.stringify({ locationId: input.locationId,
        reservedFor: reservedFor.toISOString(), durationMinutes, partySize })],
    );
    await client.query("COMMIT");
    return getPublicBoardGameReservation(token);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function getPublicBoardGameReservation(tokenInput: string) {
  const tokenHash = sha256(publicToken(tokenInput));
  const result = await query<WaitlistRow & { location_name: string }>(
    `SELECT ${SELECT_COLUMNS}, location.name AS location_name
       FROM bms_board_game_waitlist w
       ${SELECT_JOINS}
       JOIN bms_locations location
         ON location.tenant_id = w.tenant_id AND location.id = w.location_id
      WHERE w.source = 'PUBLIC' AND w.public_manage_token_hash = $1`,
    [tokenHash],
  );
  if (!result.rowCount) throw new Error("ไม่พบคำขอจองนี้");
  return publicReservationView(result.rows[0]);
}

export async function cancelPublicBoardGameReservation(tokenInput: string) {
  const tokenHash = sha256(publicToken(tokenInput));
  const found = await query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id, id FROM bms_board_game_waitlist
      WHERE source = 'PUBLIC' AND public_manage_token_hash = $1`,
    [tokenHash],
  );
  if (!found.rowCount) throw new Error("ไม่พบคำขอจองนี้");
  const client = await getClient();
  try {
    await beginTenantTx(client, found.rows[0].tenant_id);
    const updated = await client.query<{ id: string }>(
      `UPDATE bms_board_game_waitlist
          SET status = 'CANCELLED', closed_at = now(), reminder_status = 'NONE', updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND source = 'PUBLIC'
          AND status IN ('REQUESTED','CONFIRMED')
       RETURNING id`,
      [found.rows[0].tenant_id, found.rows[0].id],
    );
    if (!updated.rowCount) throw new Error("คำขอจองนี้ปิดไปแล้วและยกเลิกซ้ำไม่ได้");
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,'public:reservation','board_game.reservation_public_cancel',$2,'{}'::jsonb)`,
      [found.rows[0].tenant_id, found.rows[0].id],
    );
    await client.query("COMMIT");
    return getPublicBoardGameReservation(tokenInput);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function addBoardGameReservation(input: {
  tenantId: string; locationId: string; actorUserId: string; idempotencyKey: string;
  tableId: string; reservedFor: string; durationMinutes: number; partySize: number;
  guestName?: string | null; guestPhone?: string | null; note?: string | null;
}) {
  const partySize = positiveInteger(input.partySize, "จำนวนผู้เล่น");
  const durationMinutes = positiveInteger(input.durationMinutes, "ระยะเวลาจอง", 720);
  if (durationMinutes < 30) throw new Error("ระยะเวลาจองต้องอย่างน้อย 30 นาที");
  const reservedFor = reservationInstant(input.reservedFor);
  const normalized = {
    locationId: input.locationId, tableId: input.tableId,
    reservedFor: reservedFor.toISOString(), durationMinutes, partySize,
    guestName: boundedText(input.guestName, 120),
    guestPhone: boundedText(input.guestPhone, 40), note: boundedText(input.note, 300),
  };
  const idempotency = boardGameIdempotency("reservation.add", input.idempotencyKey, normalized);
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    await requireBoardGameCafeTenant(client, input.tenantId);
    const replay = await replayBoardGameResult<{ entryId: string }>(client, input.tenantId, idempotency);
    if (replay) {
      await client.query("COMMIT");
      return getBoardGameWaitlistEntry(input.tenantId, replay.entryId);
    }
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `board-game-reservation:${input.tenantId}:${input.locationId}:${input.tableId}`,
    ]);
    const table = await client.query<{ seats: number }>(
      `SELECT seats FROM bms_board_game_tables
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND active AND NOT blocked
        FOR UPDATE`,
      [input.tenantId, input.locationId, input.tableId],
    );
    if (!table.rowCount) throw new Error("ไม่พบโต๊ะที่เปิดรับจองในสาขานี้");
    if (Number(table.rows[0].seats) < partySize) throw new Error("โต๊ะนี้รองรับจำนวนผู้เล่นไม่พอ");
    const liveConflict = await client.query(
      `SELECT 1
         FROM bms_board_game_seatings st
         JOIN bms_board_game_sessions s
           ON s.tenant_id = st.tenant_id AND s.seating_id = st.id
        WHERE st.tenant_id = $1 AND st.location_id = $2 AND st.table_id = $3
          AND st.status = 'ACTIVE' AND s.status IN ('OPEN','CLOSING')
          AND (s.status = 'CLOSING' OR s.expected_end_at IS NULL OR s.expected_end_at > $4::timestamptz)
        LIMIT 1`,
      [input.tenantId, input.locationId, input.tableId, reservedFor.toISOString()],
    );
    if (liveConflict.rowCount) {
      throw new Error("โต๊ะนี้ยังมี session ที่ยืนยันไม่ได้ว่าจะจบก่อนเวลาจอง");
    }
    const conflict = await client.query(
      `SELECT 1 FROM bms_board_game_waitlist
        WHERE tenant_id = $1 AND location_id = $2 AND reserved_table_id = $3
          AND kind = 'RESERVATION' AND status IN ('CONFIRMED','WAITING','CALLED')
          AND reserved_for < $4::timestamptz + make_interval(mins => $5)
          AND reserved_for + make_interval(mins => reserved_duration_minutes) > $4::timestamptz
        LIMIT 1`,
      [input.tenantId, input.locationId, input.tableId, reservedFor.toISOString(), durationMinutes],
    );
    if (conflict.rowCount) throw new Error("โต๊ะนี้มีการจองที่เวลาทับกัน");
    const inserted = await client.query<{ id: string }>(
      `WITH profile AS (
         SELECT COALESCE(NULLIF(timezone, ''), 'Asia/Bangkok') AS timezone
           FROM bms_store_profile WHERE tenant_id = $1
       )
       INSERT INTO bms_board_game_waitlist
         (tenant_id, location_id, kind, service_date, queue_no, status, party_size,
          guest_name, guest_phone, note, reserved_for, reserved_duration_minutes,
          reserved_table_id, confirmed_at, created_by)
       SELECT $1,$2,'RESERVATION',
              (($4::timestamptz AT TIME ZONE profile.timezone) - INTERVAL '4 hours')::date,
              NULL,'CONFIRMED',$6,$7,$8,$9,$4::timestamptz,$5,$3,now(),$10
         FROM profile
       RETURNING id`,
      [input.tenantId, input.locationId, input.tableId, reservedFor.toISOString(), durationMinutes,
        partySize, normalized.guestName, normalized.guestPhone, normalized.note, input.actorUserId],
    );
    if (!inserted.rowCount) throw new Error("ตั้งค่าร้านไม่ครบ จึงยังรับจองไม่ได้");
    await storeBoardGameResult(client, input.tenantId, idempotency, { entryId: inserted.rows[0].id });
    await auditInTx(client, input.tenantId, input.actorUserId,
      "board_game.reservation_add", inserted.rows[0].id, {
        locationId: input.locationId, tableId: input.tableId,
        reservedFor: reservedFor.toISOString(), durationMinutes, partySize,
      });
    await client.query("COMMIT");
    return getBoardGameWaitlistEntry(input.tenantId, inserted.rows[0].id);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function updateBoardGameReservation(input: {
  tenantId: string; locationId: string; actorUserId: string; idempotencyKey: string;
  entryId: string; tableId: string; reservedFor: string; durationMinutes: number; partySize: number;
  guestName?: string | null; guestPhone?: string | null; note?: string | null;
}) {
  const partySize = positiveInteger(input.partySize, "จำนวนผู้เล่น");
  const durationMinutes = positiveInteger(input.durationMinutes, "ระยะเวลาจอง", 720);
  if (durationMinutes < 30) throw new Error("ระยะเวลาจองต้องอย่างน้อย 30 นาที");
  const reservedFor = reservationInstant(input.reservedFor);
  const normalized = {
    locationId: input.locationId, entryId: input.entryId, tableId: input.tableId,
    reservedFor: reservedFor.toISOString(), durationMinutes, partySize,
    guestName: boundedText(input.guestName, 120),
    guestPhone: boundedText(input.guestPhone, 40), note: boundedText(input.note, 300),
  };
  const idempotency = boardGameIdempotency("reservation.update", input.idempotencyKey, normalized);
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    await requireBoardGameCafeTenant(client, input.tenantId);
    const replay = await replayBoardGameResult<{ entryId: string }>(client, input.tenantId, idempotency);
    if (replay) {
      await client.query("COMMIT");
      return getBoardGameWaitlistEntry(input.tenantId, replay.entryId);
    }
    const current = await client.query<{ reserved_table_id: string }>(
      `SELECT reserved_table_id
         FROM bms_board_game_waitlist
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3
          AND kind = 'RESERVATION' AND status = 'CONFIRMED'
        FOR UPDATE`,
      [input.tenantId, input.locationId, input.entryId],
    );
    if (!current.rowCount) throw new Error("แก้ไขได้เฉพาะการจองที่ยืนยันและยังไม่เช็กอิน");
    const tableIds = [...new Set([current.rows[0].reserved_table_id, input.tableId])].sort();
    for (const tableId of tableIds) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `board-game-reservation:${input.tenantId}:${input.locationId}:${tableId}`,
      ]);
    }
    const table = await client.query<{ seats: number }>(
      `SELECT seats FROM bms_board_game_tables
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND active AND NOT blocked
        FOR UPDATE`,
      [input.tenantId, input.locationId, input.tableId],
    );
    if (!table.rowCount) throw new Error("ไม่พบโต๊ะที่เปิดรับจองในสาขานี้");
    if (Number(table.rows[0].seats) < partySize) throw new Error("โต๊ะนี้รองรับจำนวนผู้เล่นไม่พอ");
    const liveConflict = await client.query(
      `SELECT 1
         FROM bms_board_game_seatings st
         JOIN bms_board_game_sessions s
           ON s.tenant_id = st.tenant_id AND s.seating_id = st.id
        WHERE st.tenant_id = $1 AND st.location_id = $2 AND st.table_id = $3
          AND st.status = 'ACTIVE' AND s.status IN ('OPEN','CLOSING')
          AND (s.status = 'CLOSING' OR s.expected_end_at IS NULL OR s.expected_end_at > $4::timestamptz)
        LIMIT 1`,
      [input.tenantId, input.locationId, input.tableId, reservedFor.toISOString()],
    );
    if (liveConflict.rowCount) {
      throw new Error("โต๊ะนี้ยังมี session ที่ยืนยันไม่ได้ว่าจะจบก่อนเวลาจอง");
    }
    const conflict = await client.query(
      `SELECT 1 FROM bms_board_game_waitlist
        WHERE tenant_id = $1 AND location_id = $2 AND reserved_table_id = $3 AND id <> $4
          AND kind = 'RESERVATION' AND status IN ('CONFIRMED','WAITING','CALLED')
          AND reserved_for < $5::timestamptz + make_interval(mins => $6)
          AND reserved_for + make_interval(mins => reserved_duration_minutes) > $5::timestamptz
        LIMIT 1`,
      [input.tenantId, input.locationId, input.tableId, input.entryId,
        reservedFor.toISOString(), durationMinutes],
    );
    if (conflict.rowCount) throw new Error("โต๊ะนี้มีการจองที่เวลาทับกัน");
    const updated = await client.query<{ id: string }>(
      `UPDATE bms_board_game_waitlist w
          SET service_date = (
                SELECT (($5::timestamptz AT TIME ZONE COALESCE(NULLIF(profile.timezone, ''), 'Asia/Bangkok'))
                        - INTERVAL '4 hours')::date
                  FROM bms_store_profile profile WHERE profile.tenant_id = w.tenant_id
              ),
              party_size = $7, guest_name = $8, guest_phone = $9, note = $10,
              reserved_for = $5::timestamptz, reserved_duration_minutes = $6,
              reserved_table_id = $4,
              reminder_status = CASE WHEN source = 'PUBLIC' AND guest_email IS NOT NULL
                                     THEN 'PENDING' ELSE reminder_status END,
              reminder_attempts = CASE WHEN source = 'PUBLIC' THEN 0 ELSE reminder_attempts END,
              reminder_claimed_at = CASE WHEN source = 'PUBLIC' THEN NULL ELSE reminder_claimed_at END,
              reminder_sent_at = CASE WHEN source = 'PUBLIC' THEN NULL ELSE reminder_sent_at END,
              reminder_error = CASE WHEN source = 'PUBLIC' THEN NULL ELSE reminder_error END,
              updated_by = $11, updated_at = now()
        WHERE w.tenant_id = $1 AND w.location_id = $2 AND w.id = $3
          AND w.kind = 'RESERVATION' AND w.status = 'CONFIRMED'
       RETURNING w.id`,
      [input.tenantId, input.locationId, input.entryId, input.tableId,
        reservedFor.toISOString(), durationMinutes, partySize, normalized.guestName,
        normalized.guestPhone, normalized.note, input.actorUserId],
    );
    if (!updated.rowCount) throw new Error("รายการจองเปลี่ยนสถานะระหว่างแก้ไข กรุณาโหลดใหม่");
    await storeBoardGameResult(client, input.tenantId, idempotency, { entryId: input.entryId });
    await auditInTx(client, input.tenantId, input.actorUserId,
      "board_game.reservation_update", input.entryId, {
        locationId: input.locationId, previousTableId: current.rows[0].reserved_table_id,
        tableId: input.tableId, reservedFor: reservedFor.toISOString(), durationMinutes, partySize,
      });
    await client.query("COMMIT");
    return getBoardGameWaitlistEntry(input.tenantId, input.entryId);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function reviewPublicBoardGameReservation(input: {
  tenantId: string; locationId: string; actorUserId: string; idempotencyKey: string;
  entryId: string; decision: "CONFIRM" | "REJECT"; tableId?: string | null;
  reason?: string | null;
}) {
  const decision = String(input.decision).toUpperCase();
  if (decision !== "CONFIRM" && decision !== "REJECT") throw new Error("ผลการพิจารณาไม่ถูกต้อง");
  const tableId = decision === "CONFIRM" ? boundedText(input.tableId, 64) : null;
  if (decision === "CONFIRM" && !tableId) throw new Error("กรุณาเลือกโต๊ะก่อนยืนยัน");
  const reason = boundedText(input.reason, 300);
  const idempotency = boardGameIdempotency("reservation.review", input.idempotencyKey, {
    locationId: input.locationId, entryId: input.entryId, decision, tableId, reason,
  });
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    await requireBoardGameCafeTenant(client, input.tenantId);
    const replay = await replayBoardGameResult<{ entryId: string }>(client, input.tenantId, idempotency);
    if (replay) {
      await client.query("COMMIT");
      return getBoardGameWaitlistEntry(input.tenantId, replay.entryId);
    }
    const current = await client.query<{
      party_size: number; reserved_for: Date | string; reserved_duration_minutes: number;
    }>(
      `SELECT party_size, reserved_for, reserved_duration_minutes
         FROM bms_board_game_waitlist
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3
          AND kind = 'RESERVATION' AND source = 'PUBLIC' AND status = 'REQUESTED'
        FOR UPDATE`,
      [input.tenantId, input.locationId, input.entryId],
    );
    if (!current.rowCount) throw new Error("คำขอนี้ถูกพิจารณาหรือปิดไปแล้ว");
    if (decision === "REJECT") {
      await client.query(
        `UPDATE bms_board_game_waitlist
            SET status = 'REJECTED', reviewed_at = now(), reviewed_by = $4,
                rejection_reason = $5, closed_at = now(), updated_by = $4, updated_at = now()
          WHERE tenant_id = $1 AND location_id = $2 AND id = $3`,
        [input.tenantId, input.locationId, input.entryId, input.actorUserId, reason],
      );
    } else {
      const reservedFor = reservationInstant(current.rows[0].reserved_for);
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `board-game-reservation:${input.tenantId}:${input.locationId}:${tableId}`,
      ]);
      const table = await client.query<{ seats: number }>(
        `SELECT seats FROM bms_board_game_tables
          WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND active AND NOT blocked
          FOR UPDATE`,
        [input.tenantId, input.locationId, tableId],
      );
      if (!table.rowCount) throw new Error("ไม่พบโต๊ะที่เปิดรับจองในสาขานี้");
      if (Number(table.rows[0].seats) < Number(current.rows[0].party_size)) {
        throw new Error("โต๊ะนี้รองรับจำนวนผู้เล่นไม่พอ");
      }
      const liveConflict = await client.query(
        `SELECT 1
           FROM bms_board_game_seatings st
           JOIN bms_board_game_sessions s
             ON s.tenant_id = st.tenant_id AND s.seating_id = st.id
          WHERE st.tenant_id = $1 AND st.location_id = $2 AND st.table_id = $3
            AND st.status = 'ACTIVE' AND s.status IN ('OPEN','CLOSING')
            AND (s.status = 'CLOSING' OR s.expected_end_at IS NULL OR s.expected_end_at > $4::timestamptz)
          LIMIT 1`,
        [input.tenantId, input.locationId, tableId, reservedFor.toISOString()],
      );
      if (liveConflict.rowCount) throw new Error("โต๊ะนี้ยังมี session ที่ยืนยันไม่ได้ว่าจะจบก่อนเวลาจอง");
      const conflict = await client.query(
        `SELECT 1 FROM bms_board_game_waitlist
          WHERE tenant_id = $1 AND location_id = $2 AND reserved_table_id = $3 AND id <> $4
            AND kind = 'RESERVATION' AND status IN ('CONFIRMED','WAITING','CALLED')
            AND reserved_for < $5::timestamptz + make_interval(mins => $6)
            AND reserved_for + make_interval(mins => reserved_duration_minutes) > $5::timestamptz
          LIMIT 1`,
        [input.tenantId, input.locationId, tableId, input.entryId, reservedFor.toISOString(),
          Number(current.rows[0].reserved_duration_minutes)],
      );
      if (conflict.rowCount) throw new Error("โต๊ะนี้มีการจองที่เวลาทับกัน");
      await client.query(
        `UPDATE bms_board_game_waitlist
            SET status = 'CONFIRMED', reserved_table_id = $4, confirmed_at = now(),
                reviewed_at = now(), reviewed_by = $5, rejection_reason = NULL,
                reminder_status = CASE WHEN guest_email IS NULL THEN 'NONE' ELSE 'PENDING' END,
                updated_by = $5, updated_at = now()
          WHERE tenant_id = $1 AND location_id = $2 AND id = $3`,
        [input.tenantId, input.locationId, input.entryId, tableId, input.actorUserId],
      );
    }
    await storeBoardGameResult(client, input.tenantId, idempotency, { entryId: input.entryId });
    await auditInTx(client, input.tenantId, input.actorUserId,
      `board_game.reservation_${decision === "CONFIRM" ? "confirm" : "reject"}`, input.entryId,
      { locationId: input.locationId, tableId, reason });
    await client.query("COMMIT");
    return getBoardGameWaitlistEntry(input.tenantId, input.entryId);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

/** Claim first, send outside the transaction, then persist success/failure for bounded retries. */
export async function sendDueBoardGameReservationReminders(now = new Date()) {
  const tenants = await query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id FROM bms_board_game_waitlist
      WHERE kind = 'RESERVATION' AND status = 'CONFIRMED' AND guest_email IS NOT NULL
        AND reserved_for > $1::timestamptz
        AND reserved_for - make_interval(mins => reminder_minutes_before) <= $1::timestamptz
        AND (reminder_status IN ('PENDING','FAILED')
          OR (reminder_status = 'SENDING' AND reminder_claimed_at < $1::timestamptz - INTERVAL '30 minutes'))
        AND reminder_attempts < 3`,
    [now],
  );
  let sentCount = 0;
  let failedCount = 0;
  for (const tenant of tenants.rows) {
    const client = await getClient();
    let claimed: Array<{
      id: string; guest_email: string; guest_name: string | null; reserved_for: Date | string;
      reserved_duration_minutes: number; table_code: string; location_name: string; shop_name: string;
      timezone: string;
    }> = [];
    try {
      await beginTenantTx(client, tenant.tenant_id);
      const result = await client.query<typeof claimed[number]>(
        `WITH due AS (
           SELECT w.id
             FROM bms_board_game_waitlist w
            WHERE w.tenant_id = $1 AND w.kind = 'RESERVATION' AND w.status = 'CONFIRMED'
              AND w.guest_email IS NOT NULL AND w.reserved_for > $2::timestamptz
              AND w.reserved_for - make_interval(mins => w.reminder_minutes_before) <= $2::timestamptz
              AND (w.reminder_status IN ('PENDING','FAILED') OR
                (w.reminder_status = 'SENDING'
                 AND w.reminder_claimed_at < $2::timestamptz - INTERVAL '30 minutes'))
              AND w.reminder_attempts < 3
            ORDER BY w.reserved_for
            FOR UPDATE SKIP LOCKED LIMIT 100
         ), claimed AS (
           UPDATE bms_board_game_waitlist w
              SET reminder_status = 'SENDING', reminder_claimed_at = $2,
                  reminder_attempts = reminder_attempts + 1, reminder_error = NULL, updated_at = $2
             FROM due WHERE w.tenant_id = $1 AND w.id = due.id
           RETURNING w.*
         )
         SELECT claimed.id, claimed.guest_email, claimed.guest_name, claimed.reserved_for,
                claimed.reserved_duration_minutes, table_row.code AS table_code,
                location.name AS location_name, tenant.name AS shop_name,
                COALESCE(NULLIF(store.timezone, ''), 'Asia/Bangkok') AS timezone
           FROM claimed
           JOIN bms_board_game_tables table_row
             ON table_row.tenant_id = claimed.tenant_id AND table_row.id = claimed.reserved_table_id
           JOIN bms_locations location
             ON location.tenant_id = claimed.tenant_id AND location.id = claimed.location_id
           JOIN bms_tenants tenant ON tenant.id = claimed.tenant_id
           JOIN bms_store_profile store ON store.tenant_id = claimed.tenant_id`,
        [tenant.tenant_id, now],
      );
      claimed = result.rows;
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[board-game-reservation] reminder claim failed", tenant.tenant_id, error);
      failedCount += 1;
    } finally {
      client.release();
    }
    for (const row of claimed) {
      let errorText: string | null = null;
      try {
        const when = new Date(row.reserved_for).toLocaleString("th-TH", { timeZone: row.timezone });
        const salutation = row.guest_name ? `คุณ${escapeHtml(row.guest_name)}` : "ลูกค้า";
        await sendEmail({
          to: row.guest_email,
          subject: `แจ้งเตือนการจองโต๊ะ ${row.shop_name}`,
          text: `${row.shop_name}: จองโต๊ะวันที่ ${when}, ${row.reserved_duration_minutes} นาที, โต๊ะ ${row.table_code}`,
          html: `<p>${salutation}</p><p>ขอแจ้งเตือนการจองโต๊ะที่ <strong>${escapeHtml(row.shop_name)}</strong> (${escapeHtml(row.location_name)})</p><p>เวลา ${escapeHtml(when)} · ${row.reserved_duration_minutes} นาที · โต๊ะ ${escapeHtml(row.table_code)}</p>`,
        }, { tenantId: tenant.tenant_id, category: "other", triggeredBy: "system:cron" });
      } catch (error) {
        errorText = String((error as any)?.message ?? error).slice(0, 500);
      }
      const updateClient = await getClient();
      try {
        await beginTenantTx(updateClient, tenant.tenant_id);
        await updateClient.query(
          `UPDATE bms_board_game_waitlist
              SET reminder_status = $3, reminder_sent_at = CASE WHEN $3 = 'SENT' THEN now() ELSE reminder_sent_at END,
                  reminder_error = $4, updated_at = now()
            WHERE tenant_id = $1 AND id = $2 AND reminder_status = 'SENDING'`,
          [tenant.tenant_id, row.id, errorText ? "FAILED" : "SENT", errorText],
        );
        await updateClient.query("COMMIT");
        if (errorText) failedCount += 1; else sentCount += 1;
      } catch (error) {
        try { await updateClient.query("ROLLBACK"); } catch {}
        console.error("[board-game-reservation] reminder result failed", row.id, error);
        failedCount += 1;
      } finally {
        updateClient.release();
      }
    }
  }
  return { sentCount, failedCount };
}

/**
 * Close abandoned confirmed reservations after their six-hour arrival window. Each tenant commits
 * independently and SKIP LOCKED makes overlapping cron runs harmless. This never touches a party
 * that has checked in: staff still own the normal WAITING/CALLED lifecycle from that point onward.
 */
export async function expireOverdueBoardGameReservations(now = new Date()) {
  const tenants = await query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id
       FROM bms_board_game_waitlist
      WHERE kind = 'RESERVATION' AND status = 'CONFIRMED'
        AND reserved_for < $1::timestamptz - INTERVAL '6 hours'`,
    [now],
  );
  let expiredCount = 0;
  const failed: Array<{ tenantId: string; error: string }> = [];
  for (const row of tenants.rows) {
    const client = await getClient();
    try {
      await beginTenantTx(client, row.tenant_id);
      const expired = await client.query<{ id: string }>(
        `WITH due AS (
           SELECT id FROM bms_board_game_waitlist
            WHERE tenant_id = $1 AND kind = 'RESERVATION' AND status = 'CONFIRMED'
              AND reserved_for < $2::timestamptz - INTERVAL '6 hours'
            ORDER BY reserved_for
            FOR UPDATE SKIP LOCKED
            LIMIT 200
         )
         UPDATE bms_board_game_waitlist w
            SET status = 'NO_SHOW', closed_at = $2, reminder_status = 'NONE', updated_at = $2
           FROM due
          WHERE w.tenant_id = $1 AND w.id = due.id
         RETURNING w.id`,
        [row.tenant_id, now],
      );
      if (expired.rowCount) {
        await client.query(
          `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
           VALUES ($1,'system:cron','board_game.reservation_expire','due',$2::jsonb)`,
          [row.tenant_id, JSON.stringify({ count: expired.rowCount })],
        );
      }
      await client.query("COMMIT");
      expiredCount += expired.rowCount ?? 0;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[board-game-reservation] expiry failed", row.tenant_id, error);
      failed.push({ tenantId: row.tenant_id, error: String((error as any)?.message ?? error) });
    } finally {
      client.release();
    }
  }
  return { expiredCount, failedCount: failed.length, failed };
}

export async function checkInBoardGameReservation(input: {
  tenantId: string; locationId: string; actorUserId: string;
  entryId: string; idempotencyKey: string;
}) {
  const idempotency = boardGameIdempotency("reservation.check_in", input.idempotencyKey, {
    locationId: input.locationId, entryId: input.entryId,
  });
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    await requireBoardGameCafeTenant(client, input.tenantId);
    const replay = await replayBoardGameResult<{ entryId: string }>(client, input.tenantId, idempotency);
    if (replay) {
      await client.query("COMMIT");
      return getBoardGameWaitlistEntry(input.tenantId, replay.entryId);
    }
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `board-game-waitlist-number:${input.tenantId}:${input.locationId}`,
    ]);
    const updated = await client.query<{ id: string }>(
      `WITH target AS (
         SELECT w.id, w.service_date
           FROM bms_board_game_waitlist w
          WHERE w.tenant_id = $1 AND w.location_id = $2 AND w.id = $3
            AND w.kind = 'RESERVATION' AND w.status = 'CONFIRMED'
            AND w.reserved_for BETWEEN now() - INTERVAL '6 hours' AND now() + INTERVAL '2 hours'
          FOR UPDATE
       )
       UPDATE bms_board_game_waitlist w
          SET status = 'WAITING', checked_in_at = now(), reminder_status = 'NONE',
              updated_by = $4, updated_at = now(),
              queue_no = COALESCE((SELECT max(existing.queue_no)
                                     FROM bms_board_game_waitlist existing
                                    WHERE existing.tenant_id = $1 AND existing.location_id = $2
                                      AND existing.service_date = target.service_date), 0) + 1
         FROM target
        WHERE w.tenant_id = $1 AND w.id = target.id
       RETURNING w.id`,
      [input.tenantId, input.locationId, input.entryId, input.actorUserId],
    );
    if (!updated.rowCount) throw new Error("เช็กอินได้เฉพาะการจองที่ยืนยันและยังไม่ปิด");
    await storeBoardGameResult(client, input.tenantId, idempotency, { entryId: input.entryId });
    await auditInTx(client, input.tenantId, input.actorUserId,
      "board_game.reservation_check_in", input.entryId, { locationId: input.locationId });
    await client.query("COMMIT");
    return getBoardGameWaitlistEntry(input.tenantId, input.entryId);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
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
              reminder_status = CASE WHEN $5 IN ('CANCELLED','NO_SHOW') THEN 'NONE' ELSE reminder_status END,
              note = CASE WHEN $6::text IS NULL THEN note ELSE concat_ws(E'\\n', note, $6::text) END,
              updated_by = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND location_id = $3
          AND (($5 = 'CALLED' AND status = 'WAITING')
            OR ($5 = 'CANCELLED' AND status IN ('CONFIRMED','WAITING','CALLED'))
            OR ($5 = 'NO_SHOW' AND status IN ('CONFIRMED','WAITING','CALLED')
                AND (kind = 'WALK_IN' OR reserved_for <= now())))
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
    const entry = await client.query<{ party_size: number; reserved_table_id: string | null }>(
      `SELECT party_size, reserved_table_id FROM bms_board_game_waitlist
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3
          AND (status IN ('WAITING','CALLED') OR (
            status = 'CONFIRMED'
            AND reserved_for BETWEEN now() - INTERVAL '6 hours' AND now() + INTERVAL '2 hours'
          ))
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
    const bookingConflict = await client.query(
      `SELECT 1 FROM bms_board_game_waitlist
        WHERE tenant_id = $1 AND location_id = $2 AND reserved_table_id = $3
          AND id <> $4 AND kind = 'RESERVATION' AND status IN ('CONFIRMED','WAITING','CALLED')
          AND reserved_for + make_interval(mins => reserved_duration_minutes) > now()
          AND ($5::boolean OR reserved_for < now() + make_interval(mins => $6))
        LIMIT 1`,
      [input.tenantId, input.locationId, input.tableId, input.entryId,
        (input.billingMode ?? "OPEN_ENDED") === "OPEN_ENDED",
        input.expectedDurationMinutes ?? 0],
    );
    if (bookingConflict.rowCount) {
      throw new Error("โต๊ะนี้มีการจองถัดไปและระยะเวลาเล่นอาจทับกัน");
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
              reminder_status = 'NONE',
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

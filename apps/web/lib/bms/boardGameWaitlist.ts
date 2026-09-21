import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { getClient, query } from "@/lib/db";
import { sendEmail } from "@/lib/mailer";
import {
  boardGameBillableMinutes,
  openBoardGameSessionInTx,
  requireBoardGameCafeTenant,
  type BoardGameBillingMode,
  type BoardGameParticipantInput,
} from "./boardGameCafe";
import { configuredPaymentAccounts, supportsCustomerPaymentMethod } from "./paymentConfiguration";
import { getStoreProfile } from "./storeProfile";
import type { PaymentMethod } from "./payments";
import {
  boardGameIdempotency,
  replayBoardGameResult,
  storeBoardGameResult,
} from "./boardGameIdempotency";
import { beginTenantTx } from "./tenant";

export type BoardGameWaitlistStatus =
  | "REQUESTED" | "CONFIRMED" | "WAITING" | "CALLED" | "SEATED" | "CANCELLED"
  | "NO_SHOW" | "REJECTED" | "EXPIRED";

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
  customer_locale: "th" | "en";
  request_expires_at: Date | string | null;
  decision_notification_status: "NONE" | "PENDING" | "SENDING" | "SENT" | "FAILED";
  deposit_policy_snapshot: "NONE" | "FIXED" | "PERCENT";
  deposit_amount: string | number;
  deposit_status: string;
  deposit_due_at: Date | string | null;
  deposit_refund_eligible_until: Date | string | null;
  deposit_payment_id: string | null;
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

// PostgreSQL DATE has no timezone. Cast it to text before node-postgres can turn it into a
// JavaScript Date: String(new Date(...)).slice(0, 10) produces "Sun Sep 20", which cannot match
// the calendar's YYYY-MM-DD keys and makes a saved reservation disappear from its day.
const SELECT_COLUMNS = `w.id, w.kind, w.service_date::text AS service_date, w.queue_no, w.status, w.party_size,
  w.guest_name, w.guest_phone, w.guest_email, w.note, w.preferred_area_id, area.name AS preferred_area_name,
  w.reserved_for, w.reserved_duration_minutes, w.reserved_table_id,
  reserved_table.code AS reserved_table_code, w.confirmed_at, w.checked_in_at, w.source,
  w.reviewed_at, w.rejection_reason, w.reminder_status, w.reminder_sent_at,
  w.customer_locale, w.request_expires_at, w.decision_notification_status,
  w.deposit_policy_snapshot, w.deposit_amount, w.deposit_status, w.deposit_due_at,
  w.deposit_refund_eligible_until, w.deposit_payment_id,
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
    decisionNotificationStatus: row.decision_notification_status,
    depositPolicy: row.deposit_policy_snapshot,
    depositAmount: Number(row.deposit_amount ?? 0),
    depositStatus: row.deposit_status,
    depositDueAt: iso(row.deposit_due_at),
    depositRefundEligibleUntil: iso(row.deposit_refund_eligible_until),
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

function publicReservationView(row: WaitlistRow & {
  location_name?: string | null; timezone?: string | null;
}) {
  return {
    status: row.status,
    partySize: Number(row.party_size),
    reservedFor: iso(row.reserved_for),
    reservedDurationMinutes: Number(row.reserved_duration_minutes),
    locationName: row.location_name ?? null,
    reservedTableCode: row.status === "CONFIRMED" ? row.reserved_table_code : null,
    rejectionReason: row.status === "REJECTED" ? row.rejection_reason : null,
    timezone: row.timezone || "Asia/Bangkok",
    deposit: {
      policy: row.deposit_policy_snapshot,
      amount: Number(row.deposit_amount ?? 0),
      status: row.deposit_status,
      dueAt: iso(row.deposit_due_at),
      refundEligibleUntil: iso(row.deposit_refund_eligible_until),
    },
  };
}

type PublicReservationPaymentAccount = {
  key: string;
  method: "BANK_TRANSFER" | "QR";
  type: string;
  bankName: string | null;
  accountName: string | null;
  accountNo: string | null;
  promptpayId: string | null;
  note: string | null;
};

function publicPaymentAccounts(accounts: Awaited<ReturnType<typeof getStoreProfile>>["paymentAccounts"]) {
  return configuredPaymentAccounts(accounts).flatMap<PublicReservationPaymentAccount>((account, index) => {
    const type = String(account.type || "").toUpperCase();
    if (type === "BANK" && account.accountNo) return [{
      key: `bank-${index}`, method: "BANK_TRANSFER" as const, type,
      bankName: account.bankName ?? null, accountName: account.accountName ?? null,
      accountNo: account.accountNo, promptpayId: null, note: account.note ?? null,
    }];
    if ((type === "PROMPTPAY" || type === "QR") && account.promptpayId) return [{
      key: `qr-${index}`, method: "QR" as const, type,
      bankName: null, accountName: account.accountName ?? null,
      accountNo: null, promptpayId: account.promptpayId, note: account.note ?? null,
    }];
    return [];
  });
}

function publicManageUrl(token: string) {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "https://bms.jachoei.com").replace(/\/$/, "");
  return `${base}/board-game/booking/${encodeURIComponent(token)}`;
}

async function sendPublicRequestAcknowledgement(input: {
  tenantId: string; email: string; locale: "th" | "en"; token: string;
  shopName: string; locationName: string;
}) {
  const url = publicManageUrl(input.token);
  const english = input.locale === "en";
  await sendEmail({
    to: input.email,
    subject: english ? `Booking request received — ${input.shopName}` : `รับคำขอจองโต๊ะแล้ว — ${input.shopName}`,
    text: english
      ? `We received your booking request for ${input.locationName}. Check or cancel it here: ${url}`
      : `เราได้รับคำขอจองที่ ${input.locationName} แล้ว ตรวจสอบหรือยกเลิกได้ที่ ${url}`,
    html: english
      ? `<p>We received your booking request for <strong>${escapeHtml(input.locationName)}</strong>.</p><p><a href="${escapeHtml(url)}">Check or cancel this request</a></p>`
      : `<p>เราได้รับคำขอจองที่ <strong>${escapeHtml(input.locationName)}</strong> แล้ว</p><p><a href="${escapeHtml(url)}">ตรวจสอบหรือยกเลิกคำขอ</a></p>`,
  }, { tenantId: input.tenantId, category: "other", triggeredBy: "public:reservation" });
}

/** Public self-service creates a review request only; it never chooses or promises a table. */
export async function requestPublicBoardGameReservation(input: {
  tenantSlug: string; locationId: string; requestToken: string; reservedLocal?: string;
  /** Legacy clients may still send an instant; the public web now always sends branch-local time. */
  reservedFor?: string;
  durationMinutes: number; partySize: number; guestName: string; guestPhone?: string | null;
  guestEmail: string; note?: string | null; locale?: string | null;
}) {
  const token = publicToken(input.requestToken);
  const tokenHash = sha256(token);
  const durationMinutes = positiveInteger(input.durationMinutes, "ระยะเวลาจอง", 720);
  if (durationMinutes < 30) throw new Error("ระยะเวลาจองต้องอย่างน้อย 30 นาที");
  const partySize = positiveInteger(input.partySize, "จำนวนผู้เล่น");
  const guestName = boundedText(input.guestName, 120);
  if (!guestName) throw new Error("กรุณาระบุชื่อผู้จอง");
  const guestEmail = emailAddress(input.guestEmail);
  const locale: "th" | "en" = input.locale === "en" ? "en" : "th";
  const tenant = await query<{
    tenant_id: string; timezone: string; min_advance_minutes: number; request_ttl_minutes: number;
    shop_name: string; location_name: string;
  }>(
    `SELECT profile.tenant_id, COALESCE(NULLIF(store.timezone, ''), 'Asia/Bangkok') AS timezone,
            profile.reservation_min_advance_minutes AS min_advance_minutes,
            profile.reservation_request_ttl_minutes AS request_ttl_minutes,
            tenant.name AS shop_name, location.name AS location_name
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
  const config = tenant.rows[0];
  const tenantId = config.tenant_id;
  let reservedFor: Date;
  if (input.reservedLocal != null) {
    const local = String(input.reservedLocal).trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error("เวลาจองไม่ถูกต้อง");
    const converted = await query<{ instant: Date | string; round_trip: string }>(
      `SELECT ($1::timestamp AT TIME ZONE $2) AS instant,
              to_char((($1::timestamp AT TIME ZONE $2) AT TIME ZONE $2), 'YYYY-MM-DD"T"HH24:MI') AS round_trip`,
      [local, config.timezone],
    );
    if (converted.rows[0]?.round_trip !== local) throw new Error("เวลาจองนี้ไม่มีอยู่ในเขตเวลาของสาขา");
    reservedFor = reservationInstant(converted.rows[0]?.instant);
  } else {
    reservedFor = reservationInstant(input.reservedFor);
  }
  if (reservedFor.getTime() < Date.now() + Number(config.min_advance_minutes) * 60_000) {
    throw new Error(`กรุณาจองล่วงหน้าอย่างน้อย ${config.min_advance_minutes} นาที`);
  }
  const normalized = {
    reservedFor: reservedFor.toISOString(), durationMinutes, partySize, guestName,
    guestPhone: boundedText(input.guestPhone, 40), guestEmail, note: boundedText(input.note, 300),
    locale,
  };
  const requestHash = sha256(JSON.stringify(normalized));
  const client = await getClient();
  let created = false;
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
      return getPublicBoardGameReservation(token);
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
          reminder_status, customer_locale, request_expires_at, created_by)
       SELECT config.tenant_id, config.location_id, 'RESERVATION', 'PUBLIC',
              (($3::timestamptz AT TIME ZONE config.timezone) - INTERVAL '4 hours')::date,
              'REQUESTED', $5, $6, $7, $8, $9, $3, $4, $10, $10, $11,
              config.reservation_reminder_minutes, 'NONE', $12,
              LEAST($3::timestamptz, now() + make_interval(mins => $13)), NULL
         FROM config
       ON CONFLICT (tenant_id, location_id, public_request_key_hash)
         WHERE public_request_key_hash IS NOT NULL DO NOTHING
       RETURNING id`,
      [tenantId, input.locationId, reservedFor.toISOString(), durationMinutes, partySize,
        guestName, normalized.guestPhone, guestEmail, normalized.note, tokenHash, requestHash,
        locale, Number(config.request_ttl_minutes)],
    );
    if (!inserted.rowCount) {
      const raced = await client.query<{ id: string; public_request_hash: string }>(
        `SELECT id, public_request_hash FROM bms_board_game_waitlist
          WHERE tenant_id = $1 AND location_id = $2 AND public_request_key_hash = $3`,
        [tenantId, input.locationId, tokenHash],
      );
      if (!raced.rowCount) throw new Error("สาขานี้ยังไม่เปิดรับคำขอจองออนไลน์");
      if (raced.rows[0].public_request_hash !== requestHash) {
        throw new Error("รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว");
      }
      await client.query("COMMIT");
      return getPublicBoardGameReservation(token);
    }
    created = true;
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,'public:reservation','board_game.reservation_request',$2,$3::jsonb)`,
      [tenantId, inserted.rows[0].id, JSON.stringify({ locationId: input.locationId,
        reservedFor: reservedFor.toISOString(), durationMinutes, partySize })],
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
  if (created) {
    await sendPublicRequestAcknowledgement({
      tenantId, email: guestEmail, locale, token,
      shopName: config.shop_name, locationName: config.location_name,
    }).catch((error) => console.error("[board-game-reservation] acknowledgement failed", error));
  }
  return getPublicBoardGameReservation(token);
}

export async function getPublicBoardGameReservation(tokenInput: string) {
  const tokenHash = sha256(publicToken(tokenInput));
  const result = await query<WaitlistRow & {
    tenant_id: string; location_name: string; timezone: string;
  }>(
    `SELECT ${SELECT_COLUMNS}, w.tenant_id, location.name AS location_name,
            COALESCE(NULLIF(store.timezone, ''), 'Asia/Bangkok') AS timezone
       FROM bms_board_game_waitlist w
       ${SELECT_JOINS}
       JOIN bms_locations location
         ON location.tenant_id = w.tenant_id AND location.id = w.location_id
       JOIN bms_store_profile store ON store.tenant_id = w.tenant_id
      WHERE w.source = 'PUBLIC' AND w.public_manage_token_hash = $1`,
    [tokenHash],
  );
  if (!result.rowCount) throw new Error("ไม่พบคำขอจองนี้");
  const row = result.rows[0];
  const profile = await getStoreProfile(row.tenant_id);
  return {
    ...publicReservationView(row),
    paymentAccounts: publicPaymentAccounts(profile.paymentAccounts),
  };
}

/** Resolve private-file ownership from the unguessable management token, never from request data. */
export async function getPublicBoardGameReservationUploadContext(tokenInput: string) {
  const tokenHash = sha256(publicToken(tokenInput));
  const result = await query<{
    tenant_id: string; id: string; status: string; deposit_status: string;
  }>(
    `SELECT tenant_id, id, status, deposit_status
       FROM bms_board_game_waitlist
      WHERE source = 'PUBLIC' AND public_manage_token_hash = $1`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) throw new Error("ไม่พบคำขอจองนี้");
  if (row.status !== "CONFIRMED" || !["PENDING", "SUBMITTED"].includes(row.deposit_status)) {
    throw new Error("รายการนี้ยังไม่พร้อมรับหลักฐานมัดจำ");
  }
  return { tenantId: row.tenant_id, reservationId: row.id, depositStatus: row.deposit_status };
}

/** Public customer submits proof for the deposit target; confirmation remains a human payment act. */
export async function submitPublicBoardGameReservationDeposit(input: {
  token: string; method: PaymentMethod; slipUrl: string; slipRef?: string | null;
}) {
  const tokenHash = sha256(publicToken(input.token));
  if (input.method !== "BANK_TRANSFER" && input.method !== "QR") {
    throw new Error("ช่องทางชำระเงินไม่ถูกต้อง");
  }
  const target = await query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id, id FROM bms_board_game_waitlist
      WHERE source = 'PUBLIC' AND public_manage_token_hash = $1`,
    [tokenHash],
  );
  if (!target.rowCount) throw new Error("ไม่พบคำขอจองนี้");
  const tenantId = target.rows[0].tenant_id;
  const profile = await getStoreProfile(tenantId);
  if (!supportsCustomerPaymentMethod(profile.paymentAccounts, input.method)) {
    throw new Error("ช่องทางชำระเงินนี้ไม่ได้ถูกตั้งค่าไว้สำหรับร้าน");
  }
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const reservation = await client.query<{
      id: string; status: string; deposit_status: string; deposit_amount: string;
      deposit_due_at: Date | string | null;
    }>(
      `SELECT id, status, deposit_status, deposit_amount, deposit_due_at
         FROM bms_board_game_waitlist
        WHERE tenant_id = $1 AND id = $2 AND source = 'PUBLIC'
        FOR UPDATE`,
      [tenantId, target.rows[0].id],
    );
    const row = reservation.rows[0];
    if (!row || row.status !== "CONFIRMED") throw new Error("รายการนี้ยังไม่พร้อมรับมัดจำ");
    if (row.deposit_status === "PAID") {
      await client.query("COMMIT");
      return { status: "CONFIRMED", reservation: await getPublicBoardGameReservation(input.token) };
    }
    if (!["PENDING", "SUBMITTED"].includes(row.deposit_status)) {
      throw new Error("สถานะมัดจำของรายการนี้ไม่อนุญาตให้แจ้งชำระ");
    }
    if (row.deposit_due_at && new Date(row.deposit_due_at).getTime() <= Date.now()
      && row.deposit_status !== "SUBMITTED") {
      throw new Error("พ้นกำหนดชำระมัดจำแล้ว");
    }
    const active = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM bms_payments
        WHERE tenant_id = $1 AND payable_type = 'BOARD_GAME_RESERVATION'
          AND board_game_reservation_id = $2 AND status IN ('PENDING','CONFIRMED')
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [tenantId, row.id],
    );
    if (active.rowCount) {
      await client.query("COMMIT");
      return { status: active.rows[0].status === "CONFIRMED" ? "CONFIRMED" : "ALREADY_SUBMITTED",
        reservation: await getPublicBoardGameReservation(input.token) };
    }
    const payment = await client.query<{ id: string }>(
      `INSERT INTO bms_payments
         (tenant_id, order_id, payable_type, board_game_reservation_id, method, amount,
          status, slip_url, slip_ref, note)
       VALUES ($1,NULL,'BOARD_GAME_RESERVATION',$2,$3,$4,'PENDING',$5,$6,
               'แจ้งชำระมัดจำการจองโต๊ะออนไลน์')
       RETURNING id`,
      [tenantId, row.id, input.method, Number(row.deposit_amount), input.slipUrl,
        boundedText(input.slipRef, 120)],
    );
    await client.query(
      `UPDATE bms_board_game_waitlist
          SET deposit_status = 'SUBMITTED', deposit_payment_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, row.id, payment.rows[0].id],
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,'public:reservation','payment.submit',$2,$3::jsonb)`,
      [tenantId, payment.rows[0].id, JSON.stringify({ reservationId: row.id, method: input.method })],
    );
    await client.query("COMMIT");
    return { status: "SUBMITTED", reservation: await getPublicBoardGameReservation(input.token) };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
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
    const locked = await client.query<{
      id: string; status: string; deposit_status: string; deposit_payment_id: string | null;
      deposit_refund_eligible_until: Date | string | null;
    }>(
      `SELECT id, status, deposit_status, deposit_payment_id, deposit_refund_eligible_until
         FROM bms_board_game_waitlist
        WHERE tenant_id = $1 AND id = $2 AND source = 'PUBLIC' FOR UPDATE`,
      [found.rows[0].tenant_id, found.rows[0].id],
    );
    const current = locked.rows[0];
    if (!current) throw new Error("ไม่พบคำขอจองนี้");
    if (current.status === "CANCELLED") {
      await client.query("COMMIT");
      return getPublicBoardGameReservation(tokenInput);
    }
    if (!["REQUESTED", "CONFIRMED"].includes(current.status)) {
      throw new Error("คำขอจองนี้ปิดไปแล้วและยกเลิกไม่ได้");
    }
    if (current.deposit_payment_id && current.deposit_status === "SUBMITTED") {
      await client.query(
        `UPDATE bms_payments SET status = 'REJECTED', rejected_at = COALESCE(rejected_at, now()),
                note = 'ยกเลิกคำขอก่อนยืนยันมัดจำ', updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
        [found.rows[0].tenant_id, current.deposit_payment_id],
      );
    }
    const refundable = current.deposit_status === "PAID"
      && current.deposit_refund_eligible_until != null
      && new Date(current.deposit_refund_eligible_until).getTime() >= Date.now();
    const nextDepositStatus = current.deposit_status === "PAID"
      ? (refundable ? "REFUND_PENDING" : "FORFEITED")
      : ["PENDING", "SUBMITTED"].includes(current.deposit_status) ? "CANCELLED" : current.deposit_status;
    await client.query(
      `UPDATE bms_board_game_waitlist
          SET status = 'CANCELLED', closed_at = now(), reminder_status = 'NONE',
              decision_notification_status = 'NONE', deposit_status = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [found.rows[0].tenant_id, found.rows[0].id, nextDepositStatus],
    );
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
    const current = await client.query<{
      reserved_table_id: string; reserved_for: Date | string; deposit_status: string;
      deposit_due_at: Date | string | null;
    }>(
      `SELECT reserved_table_id, reserved_for, deposit_status, deposit_due_at
         FROM bms_board_game_waitlist
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3
          AND kind = 'RESERVATION' AND status = 'CONFIRMED'
        FOR UPDATE`,
      [input.tenantId, input.locationId, input.entryId],
    );
    if (!current.rowCount) throw new Error("แก้ไขได้เฉพาะการจองที่ยืนยันและยังไม่เช็กอิน");
    if (current.rows[0].deposit_status === "PENDING") {
      const currentDueAt = current.rows[0].deposit_due_at
        ? new Date(current.rows[0].deposit_due_at).getTime() : Number.POSITIVE_INFINITY;
      const rescheduledDueAt = Math.min(currentDueAt, reservedFor.getTime() - 15 * 60_000);
      if (rescheduledDueAt <= Date.now()) {
        throw new Error("เวลาใหม่ใกล้เกินกำหนดชำระมัดจำ กรุณายกเลิกและสร้างการจองใหม่");
      }
    }
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
              deposit_due_at = CASE
                WHEN deposit_status = 'PENDING' AND deposit_due_at IS NOT NULL
                  THEN LEAST(deposit_due_at, $5::timestamptz - INTERVAL '15 minutes')
                ELSE deposit_due_at
              END,
              deposit_refund_eligible_until = CASE
                WHEN deposit_refund_eligible_until IS NOT NULL
                  THEN deposit_refund_eligible_until + ($5::timestamptz - reserved_for)
                ELSE NULL
              END,
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
      guest_email: string; guest_name: string | null; customer_locale: "th" | "en";
      deposit_policy: "NONE" | "FIXED" | "PERCENT"; deposit_amount: string;
      deposit_percent: string; deposit_window_minutes: number; refund_cutoff_hours: number;
    }>(
      `SELECT w.party_size, w.reserved_for, w.reserved_duration_minutes,
              w.guest_email, w.guest_name, w.customer_locale,
              profile.reservation_deposit_policy AS deposit_policy,
              profile.reservation_deposit_amount AS deposit_amount,
              profile.reservation_deposit_percent AS deposit_percent,
              profile.reservation_deposit_payment_window_minutes AS deposit_window_minutes,
              profile.reservation_deposit_refund_cutoff_hours AS refund_cutoff_hours
         FROM bms_board_game_waitlist w
         JOIN bms_board_game_public_locations profile
           ON profile.tenant_id = w.tenant_id AND profile.location_id = w.location_id
        WHERE w.tenant_id = $1 AND w.location_id = $2 AND w.id = $3
          AND w.kind = 'RESERVATION' AND w.source = 'PUBLIC' AND w.status = 'REQUESTED'
        FOR UPDATE`,
      [input.tenantId, input.locationId, input.entryId],
    );
    if (!current.rowCount) throw new Error("คำขอนี้ถูกพิจารณาหรือปิดไปแล้ว");
    if (decision === "REJECT") {
      await client.query(
        `UPDATE bms_board_game_waitlist
            SET status = 'REJECTED', reviewed_at = now(), reviewed_by = $4,
                rejection_reason = $5, closed_at = now(), updated_by = $4,
                decision_notification_status = 'PENDING', updated_at = now()
          WHERE tenant_id = $1 AND location_id = $2 AND id = $3`,
        [input.tenantId, input.locationId, input.entryId, input.actorUserId, reason],
      );
    } else {
      const reservedFor = reservationInstant(current.rows[0].reserved_for);
      const policy = current.rows[0].deposit_policy;
      let depositAmount = 0;
      if (policy === "FIXED") {
        depositAmount = Number(current.rows[0].deposit_amount);
      } else if (policy === "PERCENT") {
        const rate = await client.query<{
          price_per_hour: string; minimum_minutes: number; rounding_minutes: number; grace_minutes: number;
        }>(
          `SELECT price_per_hour, minimum_minutes, rounding_minutes, grace_minutes
             FROM bms_board_game_time_rates
            WHERE tenant_id = $1 AND customer_type = 'GENERAL' AND active
            ORDER BY sort_order, created_at, id LIMIT 1`,
          [input.tenantId],
        );
        if (!rate.rowCount) throw new Error("ต้องตั้งเรทราคาทั่วไปก่อนใช้มัดจำแบบเปอร์เซ็นต์");
        const billableMinutes = boardGameBillableMinutes({
          startedAt: new Date(0),
          endedAt: new Date(Number(current.rows[0].reserved_duration_minutes) * 60_000),
          minimumMinutes: Number(rate.rows[0].minimum_minutes),
          roundingMinutes: Number(rate.rows[0].rounding_minutes),
          graceMinutes: Number(rate.rows[0].grace_minutes),
        });
        const estimate = Number(rate.rows[0].price_per_hour) * billableMinutes / 60
          * Number(current.rows[0].party_size);
        depositAmount = Math.round(estimate * Number(current.rows[0].deposit_percent)) / 100;
        depositAmount = Math.round(depositAmount * 100) / 100;
      }
      if (policy !== "NONE" && (!Number.isFinite(depositAmount) || depositAmount <= 0)) {
        throw new Error("คำนวณยอดมัดจำไม่ได้ กรุณาตรวจนโยบายมัดจำและเรทราคา");
      }
      const depositDueAt = policy === "NONE" ? null : new Date(Math.min(
        Date.now() + Number(current.rows[0].deposit_window_minutes) * 60_000,
        reservedFor.getTime() - 15 * 60_000,
      ));
      if (depositDueAt && depositDueAt.getTime() <= Date.now()) {
        throw new Error("เวลาจองใกล้เกินไปสำหรับรับมัดจำ กรุณาให้ลูกค้าส่งคำขอใหม่");
      }
      const refundEligibleUntil = policy === "NONE" ? null : new Date(
        reservedFor.getTime() - Number(current.rows[0].refund_cutoff_hours) * 60 * 60_000,
      );
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
                decision_notification_status = 'PENDING',
                deposit_policy_snapshot = $6, deposit_amount = $7,
                deposit_status = CASE WHEN $6 = 'NONE' THEN 'NOT_REQUIRED' ELSE 'PENDING' END,
                deposit_due_at = $8, deposit_refund_eligible_until = $9,
                updated_by = $5, updated_at = now()
          WHERE tenant_id = $1 AND location_id = $2 AND id = $3`,
        [input.tenantId, input.locationId, input.entryId, tableId, input.actorUserId,
          policy, depositAmount, depositDueAt?.toISOString() ?? null,
          refundEligibleUntil?.toISOString() ?? null],
      );
    }
    await storeBoardGameResult(client, input.tenantId, idempotency, { entryId: input.entryId });
    await auditInTx(client, input.tenantId, input.actorUserId,
      `board_game.reservation_${decision === "CONFIRM" ? "confirm" : "reject"}`, input.entryId,
      { locationId: input.locationId, tableId, reason });
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
  await sendBoardGameReservationDecisionNotification(input.tenantId, input.entryId).catch(
    (error) => console.error("[board-game-reservation] decision notification failed", error),
  );
  return getBoardGameWaitlistEntry(input.tenantId, input.entryId);
}

async function sendBoardGameReservationDecisionNotification(tenantId: string, entryId: string) {
  const client = await getClient();
  type DecisionNotificationClaim = {
    guest_email: string; guest_name: string | null; customer_locale: "th" | "en";
    status: string; rejection_reason: string | null; deposit_amount: string;
    deposit_status: string; deposit_due_at: Date | string | null; reserved_for: Date | string;
    location_name: string; shop_name: string; timezone: string;
  };
  let claimed: DecisionNotificationClaim | null = null;
  try {
    await beginTenantTx(client, tenantId);
    const result = await client.query<DecisionNotificationClaim>(
      `WITH claimed AS (
         UPDATE bms_board_game_waitlist w
            SET decision_notification_status = 'SENDING',
                decision_notification_claimed_at = now(),
                decision_notification_attempts = decision_notification_attempts + 1,
                decision_notification_error = NULL, updated_at = now()
          WHERE w.tenant_id = $1 AND w.id = $2 AND w.source = 'PUBLIC'
            AND w.status IN ('CONFIRMED','REJECTED')
            AND (w.decision_notification_status IN ('PENDING','FAILED') OR
              (w.decision_notification_status = 'SENDING'
               AND w.decision_notification_claimed_at < now() - INTERVAL '30 minutes'))
            AND w.decision_notification_attempts < 3
        RETURNING w.*
       )
       SELECT claimed.guest_email, claimed.guest_name, claimed.customer_locale, claimed.status,
              claimed.rejection_reason, claimed.deposit_amount, claimed.deposit_status,
              claimed.deposit_due_at, claimed.reserved_for, location.name AS location_name,
              tenant.name AS shop_name,
              COALESCE(NULLIF(store.timezone, ''), 'Asia/Bangkok') AS timezone
         FROM claimed
         JOIN bms_locations location
           ON location.tenant_id = claimed.tenant_id AND location.id = claimed.location_id
         JOIN bms_tenants tenant ON tenant.id = claimed.tenant_id
         JOIN bms_store_profile store ON store.tenant_id = claimed.tenant_id`,
      [tenantId, entryId],
    );
    claimed = result.rows[0] ?? null;
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
  if (!claimed) return false;

  let errorText: string | null = null;
  try {
    const english = claimed.customer_locale === "en";
    const confirmed = claimed.status === "CONFIRMED";
    const when = new Date(claimed.reserved_for).toLocaleString(english ? "en" : "th-TH", {
      timeZone: claimed.timezone,
    });
    const depositLine = confirmed && Number(claimed.deposit_amount) > 0
      ? (english
        ? ` Deposit: THB ${Number(claimed.deposit_amount).toFixed(2)}; submit it from the management link in your first email before ${new Date(claimed.deposit_due_at!).toLocaleString("en", { timeZone: claimed.timezone })}.`
        : ` มัดจำ ${Number(claimed.deposit_amount).toFixed(2)} บาท กรุณาแจ้งชำระจากลิงก์จัดการในอีเมลฉบับแรกภายใน ${new Date(claimed.deposit_due_at!).toLocaleString("th-TH", { timeZone: claimed.timezone })}`)
      : "";
    const decision = confirmed
      ? (english ? `Your booking at ${claimed.location_name} for ${when} is confirmed.${depositLine}`
        : `ร้านยืนยันการจองที่ ${claimed.location_name} เวลา ${when} แล้ว${depositLine}`)
      : (english ? `Your booking request at ${claimed.location_name} was not accepted. ${claimed.rejection_reason || "Please contact the cafe for another time."}`
        : `ร้านไม่สามารถรับคำขอจองที่ ${claimed.location_name} ได้ ${claimed.rejection_reason || "กรุณาติดต่อร้านเพื่อเลือกเวลาใหม่"}`);
    await sendEmail({
      to: claimed.guest_email,
      subject: confirmed
        ? (english ? `Booking confirmed — ${claimed.shop_name}` : `ยืนยันการจองแล้ว — ${claimed.shop_name}`)
        : (english ? `Booking request update — ${claimed.shop_name}` : `ผลคำขอจอง — ${claimed.shop_name}`),
      text: decision,
      html: `<p>${escapeHtml(decision)}</p>`,
    }, { tenantId, category: "other", triggeredBy: "staff:reservation-review" });
  } catch (error) {
    errorText = String((error as any)?.message ?? error).slice(0, 500);
  }
  await query(
    `UPDATE bms_board_game_waitlist
        SET decision_notification_status = $3,
            decision_notification_sent_at = CASE WHEN $3 = 'SENT' THEN now() ELSE decision_notification_sent_at END,
            decision_notification_error = $4, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND decision_notification_status = 'SENDING'`,
    [tenantId, entryId, errorText ? "FAILED" : "SENT", errorText],
  );
  return !errorText;
}

async function retryBoardGameReservationDecisionNotifications() {
  const due = await query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id, id FROM bms_board_game_waitlist
      WHERE source = 'PUBLIC' AND status IN ('CONFIRMED','REJECTED')
        AND (decision_notification_status IN ('PENDING','FAILED') OR
          (decision_notification_status = 'SENDING'
           AND decision_notification_claimed_at < now() - INTERVAL '30 minutes'))
        AND decision_notification_attempts < 3
      ORDER BY updated_at LIMIT 100`,
  );
  let sentCount = 0;
  let failedCount = 0;
  for (const row of due.rows) {
    try {
      if (await sendBoardGameReservationDecisionNotification(row.tenant_id, row.id)) sentCount += 1;
    } catch {
      failedCount += 1;
    }
  }
  return { sentCount, failedCount };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

/** Claim first, send outside the transaction, then persist success/failure for bounded retries. */
export async function sendDueBoardGameReservationReminders(now = new Date()) {
  const decisions = await retryBoardGameReservationDecisionNotifications();
  const tenants = await query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id FROM bms_board_game_waitlist
      WHERE kind = 'RESERVATION' AND status = 'CONFIRMED' AND guest_email IS NOT NULL
        AND deposit_status IN ('NOT_REQUIRED','PAID')
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
      timezone: string; customer_locale: "th" | "en";
    }> = [];
    try {
      await beginTenantTx(client, tenant.tenant_id);
      const result = await client.query<typeof claimed[number]>(
        `WITH due AS (
           SELECT w.id
             FROM bms_board_game_waitlist w
            WHERE w.tenant_id = $1 AND w.kind = 'RESERVATION' AND w.status = 'CONFIRMED'
              AND w.deposit_status IN ('NOT_REQUIRED','PAID')
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
         SELECT claimed.id, claimed.guest_email, claimed.guest_name, claimed.customer_locale,
                claimed.reserved_for,
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
        const english = row.customer_locale === "en";
        const when = new Date(row.reserved_for).toLocaleString(english ? "en" : "th-TH", { timeZone: row.timezone });
        const salutation = row.guest_name
          ? (english ? escapeHtml(row.guest_name) : `คุณ${escapeHtml(row.guest_name)}`)
          : (english ? "Guest" : "ลูกค้า");
        const text = english
          ? `${row.shop_name}: table booking on ${when}, ${row.reserved_duration_minutes} minutes, table ${row.table_code}`
          : `${row.shop_name}: จองโต๊ะวันที่ ${when}, ${row.reserved_duration_minutes} นาที, โต๊ะ ${row.table_code}`;
        const html = english
          ? `<p>${salutation}</p><p>Reminder for your table booking at <strong>${escapeHtml(row.shop_name)}</strong> (${escapeHtml(row.location_name)})</p><p>${escapeHtml(when)} · ${row.reserved_duration_minutes} minutes · table ${escapeHtml(row.table_code)}</p>`
          : `<p>${salutation}</p><p>ขอแจ้งเตือนการจองโต๊ะที่ <strong>${escapeHtml(row.shop_name)}</strong> (${escapeHtml(row.location_name)})</p><p>เวลา ${escapeHtml(when)} · ${row.reserved_duration_minutes} นาที · โต๊ะ ${escapeHtml(row.table_code)}</p>`;
        await sendEmail({
          to: row.guest_email,
          subject: english ? `Table booking reminder — ${row.shop_name}` : `แจ้งเตือนการจองโต๊ะ ${row.shop_name}`,
          text,
          html,
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
  return {
    sentCount,
    failedCount,
    decisionSentCount: decisions.sentCount,
    decisionFailedCount: decisions.failedCount,
  };
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
      WHERE kind = 'RESERVATION' AND (
        (status = 'REQUESTED' AND (request_expires_at <= $1 OR reserved_for <= $1))
        OR (status = 'CONFIRMED' AND deposit_status = 'PENDING' AND deposit_due_at <= $1)
        OR (status = 'CONFIRMED' AND reserved_for < $1::timestamptz - INTERVAL '6 hours')
      )`,
    [now],
  );
  let expiredCount = 0;
  const failed: Array<{ tenantId: string; error: string }> = [];
  for (const row of tenants.rows) {
    const client = await getClient();
    try {
      await beginTenantTx(client, row.tenant_id);
      const requestedExpired = await client.query<{ id: string }>(
        `WITH due AS (
           SELECT id FROM bms_board_game_waitlist
            WHERE tenant_id = $1 AND kind = 'RESERVATION' AND status = 'REQUESTED'
              AND (request_expires_at <= $2 OR reserved_for <= $2)
            ORDER BY request_expires_at
            FOR UPDATE SKIP LOCKED
            LIMIT 200
         )
         UPDATE bms_board_game_waitlist w
            SET status = 'EXPIRED', rejection_reason = 'คำขอหมดเวลาก่อนร้านยืนยัน',
                closed_at = $2, reminder_status = 'NONE', updated_at = $2
           FROM due
          WHERE w.tenant_id = $1 AND w.id = due.id
         RETURNING w.id`,
        [row.tenant_id, now],
      );
      const depositExpired = await client.query<{ id: string }>(
        `WITH due AS (
           SELECT id FROM bms_board_game_waitlist
            WHERE tenant_id = $1 AND kind = 'RESERVATION' AND status = 'CONFIRMED'
              AND deposit_status = 'PENDING' AND deposit_due_at <= $2
            ORDER BY deposit_due_at FOR UPDATE SKIP LOCKED LIMIT 200
         )
         UPDATE bms_board_game_waitlist w
            SET status = 'EXPIRED', rejection_reason = 'พ้นกำหนดชำระมัดจำ',
                deposit_status = 'CANCELLED', closed_at = $2,
                reminder_status = 'NONE', updated_at = $2
           FROM due WHERE w.tenant_id = $1 AND w.id = due.id
         RETURNING w.id`,
        [row.tenant_id, now],
      );
      const noShows = await client.query<{ id: string }>(
        `WITH due AS (
           SELECT id FROM bms_board_game_waitlist
            WHERE tenant_id = $1 AND kind = 'RESERVATION' AND status = 'CONFIRMED'
              AND reserved_for < $2::timestamptz - INTERVAL '6 hours'
            ORDER BY reserved_for FOR UPDATE SKIP LOCKED LIMIT 200
         )
         UPDATE bms_board_game_waitlist w
            SET status = 'NO_SHOW', closed_at = $2, reminder_status = 'NONE',
                deposit_status = CASE WHEN deposit_status = 'PAID' THEN 'FORFEITED'
                                      ELSE deposit_status END,
                updated_at = $2
           FROM due WHERE w.tenant_id = $1 AND w.id = due.id
         RETURNING w.id`,
        [row.tenant_id, now],
      );
      const tenantExpired = (requestedExpired.rowCount ?? 0) + (depositExpired.rowCount ?? 0)
        + (noShows.rowCount ?? 0);
      if (tenantExpired) {
        await client.query(
          `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
           VALUES ($1,'system:cron','board_game.reservation_expire','due',$2::jsonb)`,
          [row.tenant_id, JSON.stringify({ count: tenantExpired,
            requested: requestedExpired.rowCount ?? 0, deposit: depositExpired.rowCount ?? 0,
            noShow: noShows.rowCount ?? 0 })],
        );
      }
      await client.query("COMMIT");
      expiredCount += tenantExpired;
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
            AND w.deposit_status IN ('NOT_REQUIRED','PAID')
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
    if (!updated.rowCount) throw new Error("เช็กอินได้เฉพาะการจองที่ยืนยัน ชำระมัดจำครบ และยังไม่ปิด");
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
    const updated = await client.query<{ id: string; deposit_payment_id: string | null }>(
      `UPDATE bms_board_game_waitlist
          SET status = $5,
              called_at = CASE WHEN $5 = 'CALLED' THEN COALESCE(called_at, now()) ELSE called_at END,
              closed_at = CASE WHEN $5 IN ('CANCELLED','NO_SHOW') THEN now() ELSE closed_at END,
              reminder_status = CASE WHEN $5 IN ('CANCELLED','NO_SHOW') THEN 'NONE' ELSE reminder_status END,
              deposit_status = CASE
                WHEN $5 = 'NO_SHOW' AND deposit_status = 'PAID' THEN 'FORFEITED'
                WHEN $5 = 'CANCELLED' AND deposit_status = 'PAID' THEN
                  CASE WHEN deposit_refund_eligible_until IS NOT NULL
                              AND deposit_refund_eligible_until >= now()
                       THEN 'REFUND_PENDING' ELSE 'FORFEITED' END
                WHEN $5 IN ('CANCELLED','NO_SHOW')
                     AND deposit_status IN ('PENDING','SUBMITTED') THEN 'CANCELLED'
                ELSE deposit_status
              END,
              note = CASE WHEN $6::text IS NULL THEN note ELSE concat_ws(E'\\n', note, $6::text) END,
              updated_by = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND location_id = $3
          AND (($5 = 'CALLED' AND status = 'WAITING')
            OR ($5 = 'CANCELLED' AND status IN ('CONFIRMED','WAITING','CALLED'))
            OR ($5 = 'NO_SHOW' AND status IN ('CONFIRMED','WAITING','CALLED')
                AND (kind = 'WALK_IN' OR reserved_for <= now())))
       RETURNING id, deposit_payment_id`,
      [input.tenantId, input.entryId, input.locationId, input.actorUserId, targetStatus, reason],
    );
    if (!updated.rowCount) throw new Error("คิวนี้ปิดไปแล้วหรือสถานะไม่อนุญาตให้ทำรายการนี้");
    if (targetStatus !== "CALLED" && updated.rows[0].deposit_payment_id) {
      await client.query(
        `UPDATE bms_payments
            SET status = 'REJECTED', rejected_at = COALESCE(rejected_at, now()),
                note = COALESCE(note, 'ปิดการจองก่อนยืนยันมัดจำ'), updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
        [input.tenantId, updated.rows[0].deposit_payment_id],
      );
    }
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
  allowOverCapacity?: boolean | null;
}) {
  const idempotency = boardGameIdempotency("waitlist.seat", input.idempotencyKey, {
    locationId: input.locationId, entryId: input.entryId, tableId: input.tableId,
    billingMode: input.billingMode ?? "OPEN_ENDED",
    expectedDurationMinutes: input.expectedDurationMinutes ?? null,
    alertBeforeMinutes: input.alertBeforeMinutes ?? 15,
    participants: input.participants,
    note: boundedText(input.note, 300),
    allowOverCapacity: input.allowOverCapacity === true,
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
          AND deposit_status IN ('NOT_REQUIRED','PAID')
          AND (status IN ('WAITING','CALLED') OR (
            status = 'CONFIRMED'
            AND reserved_for BETWEEN now() - INTERVAL '6 hours' AND now() + INTERVAL '2 hours'
          ))
        FOR UPDATE`,
      [input.tenantId, input.locationId, input.entryId],
    );
    if (!entry.rowCount) throw new Error("คิวนี้ปิดไปแล้ว ได้โต๊ะไปแล้ว หรือยังชำระมัดจำไม่ครบ");
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
    if (
      Number(table.rows[0].seats) < input.participants.length &&
      input.allowOverCapacity !== true
    ) {
      throw new Error(
        `โต๊ะนี้มี ${table.rows[0].seats} ที่นั่ง แต่กำลังพาไปนั่ง ${input.participants.length} คน — กรุณายืนยันการใช้โต๊ะเกินความจุ`,
      );
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
      allowOverCapacity: input.allowOverCapacity,
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
      capacity: Number(table.rows[0].seats),
      overCapacity: input.participants.length > Number(table.rows[0].seats),
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

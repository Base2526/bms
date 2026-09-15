import { createHash } from "crypto";
import type { QueryResult, QueryResultRow } from "pg";
import { getClient, query } from "@/lib/db";
import {
  IDEMPOTENCY_CONFLICT_MESSAGE,
  IdempotencyConflictError,
} from "./idempotencyErrors";
import { listLocationsForUser } from "./locations";
import { beginTenantTx } from "./tenant";

export type BoardGameBillingMode = "OPEN_ENDED" | "FIXED_DURATION";
export type BoardGameSessionStatus = "OPEN" | "CLOSING" | "PAID" | "CANCELLED";
export type BoardGameAlertStatus = "NORMAL" | "ENDING_SOON" | "OVERDUE";
export type BoardGameParticipantType =
  | "GENERAL" | "STUDENT" | "MEMBER" | "CHILD" | "GUARDIAN" | "OBSERVER" | "FOOD_ONLY" | "CUSTOM";
export type BoardGameCopyStatus =
  | "AVAILABLE" | "IN_USE" | "NEEDS_CHECK" | "DAMAGED" | "MISSING_PARTS" | "REPAIRING" | "RETIRED" | "LOST";

export type BoardGameParticipantInput = {
  rateId?: string | null;
  displayName?: string | null;
  participantType?: BoardGameParticipantType | null;
  customerId?: string | null;
  billingGroupNo?: number | null;
  joinedAt?: string | Date | null;
};

export type BoardGameTimeRate = {
  id: string;
  code: string;
  name: string;
  customerType: string;
  pricePerHour: number;
  minimumMinutes: number;
  roundingMinutes: number;
  graceMinutes: number;
  active: boolean;
  sortOrder: number;
};

export type BoardGameChargeLine = {
  participantId: string;
  displayName: string | null;
  participantType: BoardGameParticipantType;
  billingGroupNo: number;
  billableMinutes: number;
  hourlyRate: number;
  amount: number;
};

export type BoardGamePublicLocationProfile = {
  locationId: string;
  publicVisible: boolean;
  displayName: string;
  summary: string | null;
  publicAddress: string | null;
  publicPhone: string | null;
  openingHours: string | null;
  latitude: number | null;
  longitude: number | null;
  publishRates: boolean;
  publishAvailability: boolean;
};

export type PublicBoardGameCafe = BoardGamePublicLocationProfile & {
  tenantSlug: string;
  shopName: string;
  logoUrl: string | null;
  distanceKm: number | null;
  totalTables: number | null;
  availableTables: number | null;
  rates: Array<{ name: string; customerType: string; pricePerHour: number }>;
  games: Array<{ title: string; minPlayers: number | null; maxPlayers: number | null; typicalMinutes: number | null }>;
};

type QueryClient = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: any[]): Promise<QueryResult<T>>;
};

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function iso(value: Date | string | null | undefined) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

const BILLABLE_PARTICIPANT_TYPES = new Set<BoardGameParticipantType>([
  "GENERAL", "STUDENT", "MEMBER", "CHILD", "CUSTOM",
]);
const PARTICIPANT_TYPES = new Set<BoardGameParticipantType>([
  "GENERAL", "STUDENT", "MEMBER", "CHILD", "GUARDIAN", "OBSERVER", "FOOD_ONLY", "CUSTOM",
]);
const COPY_RETURN_STATUSES = new Set<BoardGameCopyStatus>([
  "AVAILABLE", "NEEDS_CHECK", "DAMAGED", "MISSING_PARTS", "REPAIRING", "RETIRED", "LOST",
]);
const RATE_CUSTOMER_TYPES = new Set(["GENERAL", "STUDENT", "MEMBER", "CHILD", "CUSTOM"]);

function requiredText(value: unknown, label: string, maxLength: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) throw new Error(`${label}ไม่ถูกต้อง`);
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value == null || value === "") return null;
  return requiredText(value, label, maxLength);
}

function integerInRange(value: unknown, label: string, min: number, max: number): number {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  ) {
    throw new Error(`${label}ไม่ถูกต้อง`);
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label}ไม่ถูกต้อง`);
  return number;
}

function nonNegativeMoney(value: unknown, label: string): number {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  ) {
    throw new Error(`${label}ไม่ถูกต้อง`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label}ไม่ถูกต้อง`);
  return money(number);
}

function booleanOrDefault(value: unknown, fallback: boolean, label: string): boolean {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label}ไม่ถูกต้อง`);
  return value;
}

function optionalDate(value: string | Date | null | undefined, label: string): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label}ไม่ถูกต้อง`);
  return date;
}

function requestKey(value: unknown): string {
  const key = requiredText(value, "idempotencyKey", 200);
  if (key.length < 8) throw new Error("idempotencyKey ไม่ถูกต้อง");
  return key;
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function uuid(value: unknown, label: string): string {
  const normalized = requiredText(value, label, 36).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error(`${label}ไม่ถูกต้อง`);
  }
  return normalized;
}

function participantType(value: unknown, fallback: BoardGameParticipantType): BoardGameParticipantType {
  const normalized = (value ?? fallback) as BoardGameParticipantType;
  if (!PARTICIPANT_TYPES.has(normalized)) throw new Error("ประเภทลูกค้าไม่ถูกต้อง");
  return normalized;
}

function computedAlertStatus(row: any): BoardGameAlertStatus {
  if (row.status !== "OPEN" || !row.expected_end_at) return "NORMAL";
  const expected = new Date(row.expected_end_at).getTime();
  const now = Date.now();
  if (now >= expected) return "OVERDUE";
  return now >= expected - Number(row.alert_before_minutes ?? 15) * 60000 ? "ENDING_SOON" : "NORMAL";
}

function mapSessionRow(row: any, replayed = false) {
  return {
    id: row.id,
    status: row.status as BoardGameSessionStatus,
    billingMode: row.billing_mode as BoardGameBillingMode,
    guestCount: Number(row.guest_count),
    startedAt: iso(row.started_at),
    expectedEndAt: iso(row.expected_end_at),
    endedAt: iso(row.ended_at),
    alertStatus: computedAlertStatus(row),
    amountDue: Number(row.amount_due),
    replayed,
  };
}

type PreparedParticipant = {
  rateId: string | null;
  customerId: string | null;
  displayName: string | null;
  participantType: BoardGameParticipantType;
  billable: boolean;
  hourlyRate: number;
  minimumMinutes: number;
  roundingMinutes: number;
  graceMinutes: number;
  billingGroupNo: number;
  joinedAt: Date;
};

type BoardGameRateRow = {
  id: string;
  price_per_hour: string;
  customer_type: BoardGameParticipantType;
  minimum_minutes: number;
  rounding_minutes: number;
  grace_minutes: number;
};

export function boardGameBillableMinutes(input: {
  startedAt: Date | string;
  endedAt: Date | string;
  minimumMinutes: number;
  roundingMinutes: number;
  graceMinutes: number;
}): number {
  const start = new Date(input.startedAt).getTime();
  const end = new Date(input.endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const actual = Math.ceil((end - start) / 60000);
  const afterGrace = Math.max(0, actual - Math.max(0, input.graceMinutes));
  const rounded = Math.ceil(afterGrace / Math.max(1, input.roundingMinutes)) * Math.max(1, input.roundingMinutes);
  return Math.max(Math.max(0, input.minimumMinutes), rounded);
}

async function requireBoardGameCafeTenant(client: QueryClient, tenantId: string) {
  const result = await client.query<{ business_archetype: string | null }>(
    `SELECT business_archetype FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  if (result.rows[0]?.business_archetype !== "board_game_cafe") {
    throw new Error("ฟังก์ชันนี้ใช้ได้เฉพาะร้านที่ตั้ง Shop archetype เป็น board_game_cafe");
  }
}

async function prepareParticipantInTx(
  client: QueryClient,
  tenantId: string,
  input: BoardGameParticipantInput,
  defaultJoinedAt: Date
): Promise<PreparedParticipant> {
  let rate: BoardGameRateRow | null = null;
  if (input.rateId) {
    const rateId = uuid(input.rateId, "rateId");
    const rateResult = await client.query<BoardGameRateRow>(
      `SELECT id, price_per_hour, customer_type, minimum_minutes, rounding_minutes, grace_minutes
         FROM bms_board_game_time_rates
        WHERE tenant_id = $1 AND id = $2 AND active
        FOR SHARE`,
      [tenantId, rateId]
    );
    rate = rateResult.rows[0] ?? null;
    if (!rate) throw new Error("ไม่พบเรทราคาที่เปิดใช้งานอยู่");
  }

  const type = participantType(input.participantType, rate?.customer_type ?? "GENERAL");
  const billable = BILLABLE_PARTICIPANT_TYPES.has(type);
  if (billable && !rate) throw new Error("ลูกค้าที่คิดค่าเล่นต้องเลือกเรทราคา");
  if (rate && rate.customer_type !== "CUSTOM" && type !== rate.customer_type) {
    throw new Error("ประเภทลูกค้าไม่ตรงกับเรทราคาที่เลือก");
  }

  const customerId = input.customerId ? uuid(input.customerId, "customerId") : null;
  if (type === "MEMBER" && !customerId) throw new Error("เรทสมาชิกต้องผูกกับข้อมูลสมาชิก");
  if (customerId) {
    const customer = await client.query<{ member_no: string | null }>(
      `SELECT member_no FROM bms_customers
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR SHARE`,
      [tenantId, customerId]
    );
    if (!customer.rowCount) throw new Error("ไม่พบลูกค้าในร้านนี้");
    if (type === "MEMBER" && !customer.rows[0].member_no) throw new Error("ลูกค้าคนนี้ยังไม่ได้สมัครสมาชิก");
  }

  const joinedAt = optionalDate(input.joinedAt, "เวลาเข้าร่วม") ?? defaultJoinedAt;
  return {
    rateId: rate?.id ?? null,
    customerId,
    displayName: input.displayName ? requiredText(input.displayName, "ชื่อผู้เล่น", 100) : null,
    participantType: type,
    billable,
    hourlyRate: billable ? Number(rate?.price_per_hour ?? 0) : 0,
    minimumMinutes: billable ? Number(rate?.minimum_minutes ?? 0) : 0,
    roundingMinutes: billable ? Number(rate?.rounding_minutes ?? 30) : 30,
    graceMinutes: billable ? Number(rate?.grace_minutes ?? 0) : 0,
    billingGroupNo: integerInRange(input.billingGroupNo ?? 1, "กลุ่มบิล", 1, 20),
    joinedAt,
  };
}

async function insertParticipantInTx(
  client: QueryClient,
  tenantId: string,
  sessionId: string,
  participant: PreparedParticipant
) {
  return client.query(
    `INSERT INTO bms_board_game_session_participants
        (tenant_id, session_id, rate_id, customer_id, display_name, participant_type, billable,
         hourly_rate_snapshot, minimum_minutes_snapshot, rounding_minutes_snapshot,
         grace_minutes_snapshot, billing_group_no, joined_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id, display_name, participant_type, billable, hourly_rate_snapshot,
               minimum_minutes_snapshot, rounding_minutes_snapshot, grace_minutes_snapshot,
               billing_group_no, joined_at, left_at`,
    [
      tenantId, sessionId, participant.rateId, participant.customerId, participant.displayName,
      participant.participantType, participant.billable, participant.hourlyRate,
      participant.minimumMinutes, participant.roundingMinutes, participant.graceMinutes,
      participant.billingGroupNo, participant.joinedAt,
    ]
  );
}

async function auditInTx(
  client: QueryClient,
  tenantId: string,
  actorUserId: string | null | undefined,
  action: string,
  target: string | null,
  meta: Record<string, unknown> = {}
) {
  await client.query(
    `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [tenantId, actorUserId ? `user:${actorUserId}` : "system", action, target, JSON.stringify(meta)]
  );
}

async function lockIdempotencyKeyInTx(
  client: QueryClient,
  tenantId: string,
  action: string,
  key: string
) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`board-game:${tenantId}:${action}:${key}`]
  );
}

async function replayActionInTx<T>(
  client: QueryClient,
  tenantId: string,
  action: string,
  key: string,
  hash: string
): Promise<T | null> {
  await lockIdempotencyKeyInTx(client, tenantId, action, key);
  const existing = await client.query<{ request_hash: string; result: T }>(
    `SELECT request_hash, result
       FROM bms_board_game_idempotency_results
      WHERE tenant_id = $1 AND action = $2 AND idempotency_key = $3`,
    [tenantId, action, key]
  );
  if (!existing.rowCount) return null;
  if (existing.rows[0].request_hash !== hash) {
    throw new IdempotencyConflictError(IDEMPOTENCY_CONFLICT_MESSAGE, action);
  }
  return existing.rows[0].result;
}

async function storeActionResultInTx(
  client: QueryClient,
  tenantId: string,
  action: string,
  key: string,
  hash: string,
  result: Record<string, unknown>
) {
  await client.query(
    `INSERT INTO bms_board_game_idempotency_results
        (tenant_id, action, idempotency_key, request_hash, result)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [tenantId, action, key, hash, JSON.stringify(result)]
  );
}

function mapRate(row: any): BoardGameTimeRate {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    customerType: row.customer_type,
    pricePerHour: Number(row.price_per_hour),
    minimumMinutes: Number(row.minimum_minutes),
    roundingMinutes: Number(row.rounding_minutes),
    graceMinutes: Number(row.grace_minutes),
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
  };
}

export async function listBoardGameTimeRates(tenantId: string): Promise<BoardGameTimeRate[]> {
  await requireBoardGameCafeTenant({ query }, tenantId);
  const result = await query(
    `SELECT id, code, name, customer_type, price_per_hour, minimum_minutes,
            rounding_minutes, grace_minutes, active, sort_order
       FROM bms_board_game_time_rates
      WHERE tenant_id = $1
      ORDER BY active DESC, sort_order, name`,
    [tenantId]
  );
  return result.rows.map(mapRate);
}

export async function listBoardGameLocations(tenantId: string, actorUserId: string) {
  await requireBoardGameCafeTenant({ query }, tenantId);
  const locations = await listLocationsForUser(tenantId, actorUserId);
  return locations.map((location) => ({
    id: location.id,
    code: location.code,
    name: location.name,
    active: location.active,
  }));
}

async function boardGameEntityLocation(
  tenantId: string,
  entityIdInput: string,
  kind: "area" | "table" | "session" | "copy" | "loan"
): Promise<string | null> {
  const entityId = uuid(entityIdInput, `${kind}Id`);
  const statements = {
    area: `SELECT location_id FROM bms_board_game_areas WHERE tenant_id = $1 AND id = $2`,
    table: `SELECT location_id FROM bms_board_game_tables WHERE tenant_id = $1 AND id = $2`,
    session: `SELECT location_id FROM bms_board_game_sessions WHERE tenant_id = $1 AND id = $2`,
    copy: `SELECT location_id FROM bms_board_game_copies WHERE tenant_id = $1 AND id = $2`,
    loan: `SELECT s.location_id
             FROM bms_board_game_session_games g
             JOIN bms_board_game_sessions s
               ON s.tenant_id = g.tenant_id AND s.id = g.session_id
            WHERE g.tenant_id = $1 AND g.id = $2`,
  } as const;
  const result = await query<{ location_id: string }>(statements[kind], [tenantId, entityId]);
  return result.rows[0]?.location_id ?? null;
}

export const locationOfBoardGameArea = (tenantId: string, areaId: string) =>
  boardGameEntityLocation(tenantId, areaId, "area");
export const locationOfBoardGameTable = (tenantId: string, tableId: string) =>
  boardGameEntityLocation(tenantId, tableId, "table");
export const locationOfBoardGameSession = (tenantId: string, sessionId: string) =>
  boardGameEntityLocation(tenantId, sessionId, "session");
export const locationOfBoardGameCopy = (tenantId: string, copyId: string) =>
  boardGameEntityLocation(tenantId, copyId, "copy");
export const locationOfBoardGameLoan = (tenantId: string, loanId: string) =>
  boardGameEntityLocation(tenantId, loanId, "loan");

export async function upsertBoardGameTimeRate(
  tenantId: string,
  input: {
    id?: string | null;
    code?: string | null;
    name: string;
    customerType?: string | null;
    pricePerHour: number;
    minimumMinutes?: number | null;
    roundingMinutes?: number | null;
    graceMinutes?: number | null;
    active?: boolean | null;
    sortOrder?: number | null;
  },
  actorUserId?: string | null
): Promise<BoardGameTimeRate> {
  const id = input.id ? uuid(input.id, "id") : null;
  const name = requiredText(input.name, "ชื่อเรทราคา", 100);
  const code = normalizeCode(input.code || name);
  if (!code) throw new Error("ต้องระบุรหัสเรทราคา");
  const customerType = input.customerType ?? "GENERAL";
  if (!RATE_CUSTOMER_TYPES.has(customerType)) throw new Error("ประเภทเรทราคาไม่ถูกต้อง");
  const pricePerHour = nonNegativeMoney(input.pricePerHour, "ราคาต่อชั่วโมง");
  const minimumMinutes = integerInRange(input.minimumMinutes ?? 60, "เวลาขั้นต่ำ", 0, 1440);
  const roundingMinutes = integerInRange(input.roundingMinutes ?? 30, "ช่วงปัดเวลา", 1, 1440);
  const graceMinutes = integerInRange(input.graceMinutes ?? 0, "เวลาผ่อนผัน", 0, 240);
  const sortOrder = integerInRange(input.sortOrder ?? 0, "ลำดับ", -100000, 100000);
  const active = booleanOrDefault(input.active, true, "สถานะเรทราคา");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const result = await client.query(
      id
        ? `UPDATE bms_board_game_time_rates
              SET code = $3, name = $4, customer_type = $5, price_per_hour = $6,
                  minimum_minutes = $7, rounding_minutes = $8, grace_minutes = $9,
                  active = $10, sort_order = $11, updated_at = now()
            WHERE tenant_id = $1 AND id = $2
            RETURNING id, code, name, customer_type, price_per_hour, minimum_minutes,
                      rounding_minutes, grace_minutes, active, sort_order`
        : `INSERT INTO bms_board_game_time_rates
              (tenant_id, code, name, customer_type, price_per_hour, minimum_minutes,
               rounding_minutes, grace_minutes, active, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id, code, name, customer_type, price_per_hour, minimum_minutes,
                     rounding_minutes, grace_minutes, active, sort_order`,
      id
        ? [
            tenantId, id, code, name, customerType, pricePerHour, minimumMinutes,
            roundingMinutes, graceMinutes, active, sortOrder,
          ]
        : [
            tenantId, code, name, customerType, pricePerHour, minimumMinutes,
            roundingMinutes, graceMinutes, active, sortOrder,
          ]
    );
    if (!result.rowCount) throw new Error("ไม่พบเรทราคาที่ต้องการแก้ไข");
    await auditInTx(client, tenantId, actorUserId, "board_game.rate_upsert", result.rows[0].id, { code });
    await client.query("COMMIT");
    return mapRate(result.rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertBoardGameArea(
  tenantId: string,
  input: {
    id?: string | null;
    locationId: string;
    name: string;
    sortOrder?: number | null;
    active?: boolean | null;
  },
  actorUserId?: string | null
) {
  const id = input.id ? uuid(input.id, "id") : null;
  const locationId = uuid(input.locationId, "locationId");
  const name = requiredText(input.name, "ชื่อโซน", 80);
  const sortOrder = integerInRange(input.sortOrder ?? 0, "ลำดับ", -100000, 100000);
  const active = booleanOrDefault(input.active, true, "สถานะโซน");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const result = await client.query(
      id
        ? `UPDATE bms_board_game_areas
              SET location_id = $3, name = $4, sort_order = $5, active = $6, updated_at = now()
            WHERE tenant_id = $1 AND id = $2
            RETURNING id, location_id, name, sort_order, active`
        : `INSERT INTO bms_board_game_areas (tenant_id, location_id, name, sort_order, active)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id, location_id, name, sort_order, active`,
      id
        ? [tenantId, id, locationId, name, sortOrder, active]
        : [tenantId, locationId, name, sortOrder, active]
    );
    if (!result.rowCount) throw new Error("ไม่พบโซนโต๊ะที่ต้องการแก้ไข");
    await auditInTx(client, tenantId, actorUserId, "board_game.area_upsert", result.rows[0].id, {
      locationId: result.rows[0].location_id,
      name: result.rows[0].name,
    });
    await client.query("COMMIT");
    const row = result.rows[0];
    return {
      id: row.id,
      locationId: row.location_id,
      name: row.name,
      sortOrder: Number(row.sort_order),
      active: Boolean(row.active),
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertBoardGameTable(
  tenantId: string,
  input: {
    id?: string | null;
    locationId: string;
    areaId: string;
    code: string;
    name?: string | null;
    seats?: number | null;
    sortOrder?: number | null;
    active?: boolean | null;
    blocked?: boolean | null;
  },
  actorUserId?: string | null
) {
  const id = input.id ? uuid(input.id, "id") : null;
  const code = normalizeCode(input.code);
  if (!code) throw new Error("ต้องระบุรหัสโต๊ะ");
  const locationId = uuid(input.locationId, "locationId");
  const areaId = uuid(input.areaId, "areaId");
  const name = input.name ? requiredText(input.name, "ชื่อโต๊ะ", 80) : code;
  const seats = integerInRange(input.seats ?? 4, "จำนวนที่นั่ง", 1, 100);
  const sortOrder = integerInRange(input.sortOrder ?? 0, "ลำดับ", -100000, 100000);
  const active = booleanOrDefault(input.active, true, "สถานะโต๊ะ");
  const blocked = booleanOrDefault(input.blocked, false, "สถานะปิดใช้โต๊ะ");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const area = await client.query(
      `SELECT 1 FROM bms_board_game_areas
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND active`,
      [tenantId, locationId, areaId]
    );
    if (!area.rowCount) throw new Error("โซนโต๊ะไม่อยู่ในสาขานี้หรือถูกปิดใช้งาน");
    const result = await client.query(
      id
        ? `UPDATE bms_board_game_tables
              SET location_id = $3, area_id = $4, code = $5, name = $6, seats = $7,
                  sort_order = $8, active = $9, blocked = $10, updated_at = now()
            WHERE tenant_id = $1 AND id = $2
            RETURNING id, location_id, area_id, code, name, seats, sort_order, active, blocked`
        : `INSERT INTO bms_board_game_tables
              (tenant_id, location_id, area_id, code, name, seats, sort_order, active, blocked)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id, location_id, area_id, code, name, seats, sort_order, active, blocked`,
      id
        ? [
            tenantId, id, locationId, areaId, code, name, seats, sortOrder,
            active, blocked,
          ]
        : [
            tenantId, locationId, areaId, code, name, seats, sortOrder,
            active, blocked,
          ]
    );
    if (!result.rowCount) throw new Error("ไม่พบโต๊ะที่ต้องการแก้ไข");
    await auditInTx(client, tenantId, actorUserId, "board_game.table_upsert", result.rows[0].id, {
      locationId: result.rows[0].location_id,
      code: result.rows[0].code,
    });
    await client.query("COMMIT");
    const row = result.rows[0];
    return {
      id: row.id,
      locationId: row.location_id,
      areaId: row.area_id,
      code: row.code,
      name: row.name,
      seats: Number(row.seats),
      sortOrder: Number(row.sort_order),
      active: Boolean(row.active),
      blocked: Boolean(row.blocked),
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function listBoardGameFloor(tenantId: string, locationId: string) {
  await requireBoardGameCafeTenant({ query }, tenantId);
  const scopedLocationId = uuid(locationId, "locationId");
  const [areas, tables, sessions] = await Promise.all([
    query(
      `SELECT id, name, sort_order
         FROM bms_board_game_areas
        WHERE tenant_id = $1 AND location_id = $2 AND active
        ORDER BY sort_order, name`,
      [tenantId, scopedLocationId]
    ),
    query(
      `SELECT t.id, t.area_id, t.code, t.name, t.seats, t.sort_order, t.blocked,
              s.id AS session_id, s.status, s.billing_mode, s.guest_count,
              s.started_at, s.expected_end_at, s.alert_before_minutes, s.amount_due
         FROM bms_board_game_tables t
         LEFT JOIN bms_board_game_sessions s
           ON s.tenant_id = t.tenant_id AND s.table_id = t.id
          AND s.status IN ('OPEN','CLOSING')
        WHERE t.tenant_id = $1 AND t.location_id = $2 AND t.active
        ORDER BY t.sort_order, t.code`,
      [tenantId, scopedLocationId]
    ),
    query(
      `SELECT status, count(*)::integer AS count
         FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND location_id = $2 AND status IN ('OPEN','CLOSING')
        GROUP BY status`,
      [tenantId, scopedLocationId]
    ),
  ]);
  return {
    areas: areas.rows.map((row: any) => ({ id: row.id, name: row.name, sortOrder: Number(row.sort_order) })),
    tables: tables.rows.map((row: any) => ({
      id: row.id,
      areaId: row.area_id,
      code: row.code,
      name: row.name,
      seats: Number(row.seats),
      sortOrder: Number(row.sort_order),
      blocked: Boolean(row.blocked),
      openSession: row.session_id ? {
        id: row.session_id,
        status: row.status,
        billingMode: row.billing_mode,
        guestCount: Number(row.guest_count),
        startedAt: iso(row.started_at),
        expectedEndAt: iso(row.expected_end_at),
        alertStatus: computedAlertStatus(row),
        amountDue: Number(row.amount_due),
      } : null,
    })),
    openCounts: Object.fromEntries(sessions.rows.map((row: any) => [row.status, Number(row.count)])),
  };
}

export async function openBoardGameSession(
  tenantId: string,
  input: {
    idempotencyKey: string;
    locationId: string;
    tableId: string;
    billingMode?: BoardGameBillingMode;
    expectedDurationMinutes?: number | null;
    alertBeforeMinutes?: number | null;
    participants: BoardGameParticipantInput[];
    startedAt?: string | Date | null;
    posDeviceId?: string | null;
    posShiftId?: string | null;
    note?: string | null;
  },
  actorUserId?: string | null
) {
  const key = requestKey(input.idempotencyKey);
  const locationId = uuid(input.locationId, "locationId");
  const tableId = uuid(input.tableId, "tableId");
  const mode = input.billingMode ?? "OPEN_ENDED";
  if (mode !== "OPEN_ENDED" && mode !== "FIXED_DURATION") throw new Error("รูปแบบการคิดเวลาไม่ถูกต้อง");
  const expected = mode === "FIXED_DURATION"
    ? integerInRange(input.expectedDurationMinutes, "เวลาที่ลูกค้าซื้อไว้", 1, 1440)
    : null;
  if (!Array.isArray(input.participants) || input.participants.length < 1 || input.participants.length > 500) {
    throw new Error("ต้องระบุผู้เล่นอย่างน้อย 1 คน และไม่เกิน 500 คน");
  }
  const alertBeforeMinutes = integerInRange(input.alertBeforeMinutes ?? 15, "เวลาแจ้งเตือนล่วงหน้า", 0, 120);
  const requestedStartedAt = optionalDate(input.startedAt, "เวลาเริ่ม");
  const startedAt = requestedStartedAt ?? new Date();
  const expectedEndAt = expected ? new Date(startedAt.getTime() + expected * 60000) : null;
  const posDeviceId = input.posDeviceId ? uuid(input.posDeviceId, "posDeviceId") : null;
  const posShiftId = input.posShiftId ? uuid(input.posShiftId, "posShiftId") : null;
  if ((posDeviceId == null) !== (posShiftId == null)) throw new Error("ต้องระบุเครื่อง POS และกะคู่กัน");
  const normalizedNote = input.note?.trim() || null;
  const hash = requestHash({
    locationId, tableId, mode, expected, alertBeforeMinutes, startedAt: requestedStartedAt?.toISOString() ?? null,
    posDeviceId, posShiftId, note: normalizedNote,
    participants: input.participants.map((row) => ({
      rateId: row.rateId ?? null,
      displayName: row.displayName?.trim() || null,
      participantType: row.participantType ?? null,
      customerId: row.customerId ?? null,
      billingGroupNo: row.billingGroupNo ?? 1,
      joinedAt: row.joinedAt ? optionalDate(row.joinedAt, "เวลาเข้าร่วม")?.toISOString() : null,
    })),
  });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    await lockIdempotencyKeyInTx(client, tenantId, "open", key);
    const replay = await client.query(
      `SELECT id, status, billing_mode, guest_count, started_at, expected_end_at, ended_at,
              alert_before_minutes, amount_due, open_request_hash
         FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND open_idempotency_key = $2
        FOR UPDATE`,
      [tenantId, key]
    );
    if (replay.rowCount) {
      if (replay.rows[0].open_request_hash !== hash)
        throw new IdempotencyConflictError(IDEMPOTENCY_CONFLICT_MESSAGE, "open");
      await client.query("COMMIT");
      return mapSessionRow(replay.rows[0], true);
    }
    const table = await client.query(
      `SELECT 1 FROM bms_board_game_tables
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND active AND NOT blocked
        FOR UPDATE`,
      [tenantId, locationId, tableId]
    );
    if (!table.rowCount) throw new Error("ไม่พบโต๊ะบอร์ดเกมที่เปิดใช้งานอยู่");
    if (posDeviceId && posShiftId) {
      const shift = await client.query(
        `SELECT 1 FROM bms_pos_shifts
          WHERE tenant_id = $1 AND location_id = $2 AND device_id = $3 AND id = $4 AND status = 'OPEN'
          FOR SHARE`,
        [tenantId, locationId, posDeviceId, posShiftId]
      );
      if (!shift.rowCount) throw new Error("เครื่อง POS หรือกะไม่ตรงกับสาขานี้");
    }
    const preparedParticipants: PreparedParticipant[] = [];
    for (const participant of input.participants) {
      const prepared = await prepareParticipantInTx(client, tenantId, participant, startedAt);
      if (prepared.joinedAt < startedAt) throw new Error("เวลาเข้าร่วมต้องไม่ก่อนเวลาเปิดโต๊ะ");
      preparedParticipants.push(prepared);
    }
    const result = await client.query(
      `INSERT INTO bms_board_game_sessions
          (tenant_id, location_id, table_id, pos_device_id, pos_shift_id, billing_mode,
           guest_count, expected_duration_minutes, started_at, expected_end_at, alert_before_minutes,
           note, opened_by, open_idempotency_key, open_request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id, status, billing_mode, guest_count, started_at, expected_end_at, ended_at,
                 alert_before_minutes, amount_due`,
      [
        tenantId,
        locationId,
        tableId,
        posDeviceId,
        posShiftId,
        mode,
        preparedParticipants.length,
        expected,
        startedAt,
        expectedEndAt,
        alertBeforeMinutes,
        normalizedNote,
        actorUserId ?? null,
        key,
        hash,
      ]
    );
    for (const participant of preparedParticipants) {
      await insertParticipantInTx(client, tenantId, result.rows[0].id, participant);
    }
    await auditInTx(client, tenantId, actorUserId, "board_game.session_open", result.rows[0].id, {
      tableId,
      billingMode: mode,
      guestCount: preparedParticipants.length,
    });
    await client.query("COMMIT");
    return mapSessionRow(result.rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function addBoardGameParticipant(
  tenantId: string,
  input: BoardGameParticipantInput & { sessionId: string; idempotencyKey: string },
  actorUserId?: string | null
) {
  const sessionId = uuid(input.sessionId, "sessionId");
  const key = requestKey(input.idempotencyKey);
  const requestedJoinedAt = optionalDate(input.joinedAt, "เวลาเข้าร่วม");
  const hash = requestHash({
    sessionId,
    rateId: input.rateId ?? null,
    displayName: input.displayName?.trim() || null,
    participantType: input.participantType ?? null,
    customerId: input.customerId ?? null,
    billingGroupNo: input.billingGroupNo ?? 1,
    joinedAt: requestedJoinedAt?.toISOString() ?? null,
  });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const replay = await replayActionInTx<Record<string, unknown>>(
      client, tenantId, "participant.add", key, hash
    );
    if (replay) {
      await client.query("COMMIT");
      return { ...replay, replayed: true };
    }
    const session = await client.query<{ id: string; started_at: Date }>(
      `SELECT id, started_at FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'
        FOR UPDATE`,
      [tenantId, sessionId]
    );
    if (!session.rowCount) throw new Error("ไม่พบ session ที่เปิดอยู่");
    const prepared = await prepareParticipantInTx(
      client,
      tenantId,
      { ...input, joinedAt: requestedJoinedAt },
      new Date()
    );
    if (prepared.joinedAt < new Date(session.rows[0].started_at)) throw new Error("เวลาเข้าร่วมต้องไม่ก่อนเวลาเปิดโต๊ะ");
    const result = await insertParticipantInTx(client, tenantId, sessionId, prepared);
    await client.query(
      `UPDATE bms_board_game_sessions
          SET guest_count = guest_count + 1, version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, sessionId]
    );
    const row = result.rows[0];
    const response = {
      id: row.id,
      displayName: row.display_name,
      participantType: row.participant_type,
      billable: Boolean(row.billable),
      hourlyRate: Number(row.hourly_rate_snapshot),
      billingGroupNo: Number(row.billing_group_no),
      joinedAt: iso(row.joined_at),
      replayed: false,
    };
    await storeActionResultInTx(client, tenantId, "participant.add", key, hash, response);
    await auditInTx(client, tenantId, actorUserId, "board_game.participant_add", sessionId, {
      participantId: result.rows[0].id,
      participantType: prepared.participantType,
      billable: prepared.billable,
      billingGroupNo: prepared.billingGroupNo,
    });
    await client.query("COMMIT");
    return response;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function leaveBoardGameParticipant(
  tenantId: string,
  input: { sessionId: string; participantId: string; idempotencyKey: string; leftAt?: string | Date | null },
  actorUserId?: string | null
) {
  const sessionId = uuid(input.sessionId, "sessionId");
  const participantId = uuid(input.participantId, "participantId");
  const key = requestKey(input.idempotencyKey);
  const requestedLeftAt = optionalDate(input.leftAt, "เวลาออก");
  const leftAt = requestedLeftAt ?? new Date();
  const hash = requestHash({ sessionId, participantId, leftAt: requestedLeftAt?.toISOString() ?? null });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const replay = await replayActionInTx<Record<string, unknown>>(
      client, tenantId, "participant.leave", key, hash
    );
    if (replay) {
      await client.query("COMMIT");
      return { ...replay, replayed: true };
    }
    const participant = await client.query<{ joined_at: Date }>(
      `SELECT p.joined_at
         FROM bms_board_game_session_participants p
         JOIN bms_board_game_sessions s
           ON s.tenant_id = p.tenant_id AND s.id = p.session_id
        WHERE p.tenant_id = $1 AND p.session_id = $2 AND p.id = $3
          AND p.left_at IS NULL AND s.status = 'OPEN'
        FOR UPDATE OF p, s`,
      [tenantId, sessionId, participantId]
    );
    if (!participant.rowCount) throw new Error("ไม่พบผู้เล่นที่ยังอยู่ใน session นี้");
    if (leftAt < new Date(participant.rows[0].joined_at)) throw new Error("เวลาออกต้องไม่ก่อนเวลาเข้าร่วม");
    await client.query(
      `UPDATE bms_board_game_session_participants
          SET left_at = $4, updated_at = now()
        WHERE tenant_id = $1 AND session_id = $2 AND id = $3`,
      [tenantId, sessionId, participantId, leftAt]
    );
    await client.query(
      `UPDATE bms_board_game_sessions
          SET guest_count = GREATEST(0, guest_count - 1), version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, sessionId]
    );
    const response = { id: participantId, leftAt: leftAt.toISOString(), replayed: false };
    await storeActionResultInTx(client, tenantId, "participant.leave", key, hash, response);
    await auditInTx(client, tenantId, actorUserId, "board_game.participant_leave", sessionId, {
      participantId,
      overriddenTime: requestedLeftAt != null,
    });
    await client.query("COMMIT");
    return response;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function adjustBoardGameSessionTiming(
  tenantId: string,
  sessionIdInput: string,
  input: {
    idempotencyKey: string;
    billingMode?: BoardGameBillingMode | null;
    startedAt?: string | Date | null;
    expectedDurationMinutes?: number | null;
    alertBeforeMinutes?: number | null;
  },
  actorUserId?: string | null
) {
  const sessionId = uuid(sessionIdInput, "sessionId");
  const key = requestKey(input.idempotencyKey);
  const requestedStartedAt = optionalDate(input.startedAt, "เวลาเริ่ม");
  const hash = requestHash({
    sessionId,
    billingMode: input.billingMode ?? null,
    startedAt: requestedStartedAt?.toISOString() ?? null,
    expectedDurationMinutes: input.expectedDurationMinutes ?? null,
    alertBeforeMinutes: input.alertBeforeMinutes ?? null,
  });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const replay = await replayActionInTx<Record<string, unknown>>(
      client, tenantId, "session.adjust_timing", key, hash
    );
    if (replay) {
      await client.query("COMMIT");
      return { ...replay, replayed: true };
    }
    const current = await client.query(
      `SELECT billing_mode, started_at, expected_duration_minutes, alert_before_minutes
         FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'
        FOR UPDATE`,
      [tenantId, sessionId]
    );
    if (!current.rowCount) throw new Error("ไม่พบ session ที่เปิดอยู่");
    const row = current.rows[0];
    const mode = input.billingMode ?? row.billing_mode;
    if (mode !== "OPEN_ENDED" && mode !== "FIXED_DURATION") throw new Error("รูปแบบการคิดเวลาไม่ถูกต้อง");
    const startedAt = requestedStartedAt ?? new Date(row.started_at);
    const expectedDuration = mode === "FIXED_DURATION"
      ? integerInRange(
          input.expectedDurationMinutes ?? row.expected_duration_minutes,
          "เวลาที่ลูกค้าซื้อไว้",
          1,
          1440
        )
      : null;
    const expectedEndAt = expectedDuration
      ? new Date(startedAt.getTime() + expectedDuration * 60000)
      : null;
    const alertBeforeMinutes = integerInRange(
      input.alertBeforeMinutes ?? row.alert_before_minutes,
      "เวลาแจ้งเตือนล่วงหน้า",
      0,
      120
    );
    const previousStartedAt = new Date(row.started_at);
    if (startedAt.getTime() !== previousStartedAt.getTime()) {
      await client.query(
        `UPDATE bms_board_game_session_participants
            SET joined_at = $3, updated_at = now()
          WHERE tenant_id = $1 AND session_id = $2 AND joined_at = $4`,
        [tenantId, sessionId, startedAt, previousStartedAt]
      );
    }
    await client.query(
      `UPDATE bms_board_game_sessions
          SET billing_mode = $3, started_at = $4, expected_duration_minutes = $5,
              expected_end_at = $6, alert_before_minutes = $7,
              version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, sessionId, mode, startedAt, expectedDuration, expectedEndAt, alertBeforeMinutes]
    );
    const response = {
      sessionId,
      billingMode: mode as BoardGameBillingMode,
      startedAt: startedAt.toISOString(),
      expectedEndAt: expectedEndAt?.toISOString() ?? null,
      alertBeforeMinutes,
      replayed: false,
    };
    await storeActionResultInTx(client, tenantId, "session.adjust_timing", key, hash, response);
    await auditInTx(client, tenantId, actorUserId, "board_game.session_timing_adjust", sessionId, {
      previousStartedAt: previousStartedAt.toISOString(),
      startedAt: startedAt.toISOString(),
      previousBillingMode: row.billing_mode,
      billingMode: mode,
      expectedDurationMinutes: expectedDuration,
    });
    await client.query("COMMIT");
    return response;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function getBoardGameSession(tenantId: string, sessionIdInput: string) {
  const sessionId = uuid(sessionIdInput, "sessionId");
  await requireBoardGameCafeTenant({ query }, tenantId);
  const [session, participants, games] = await Promise.all([
    query(
      `SELECT id, location_id, table_id, status, billing_mode, guest_count, started_at,
              expected_end_at, ended_at, alert_before_minutes, amount_due, current_order_id,
              charge_snapshot
         FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, sessionId]
    ),
    query(
      `SELECT id, display_name, participant_type, billable, hourly_rate_snapshot,
              minimum_minutes_snapshot, rounding_minutes_snapshot, grace_minutes_snapshot,
              billing_group_no, joined_at, left_at
         FROM bms_board_game_session_participants
        WHERE tenant_id = $1 AND session_id = $2
        ORDER BY billing_group_no, created_at, id`,
      [tenantId, sessionId]
    ),
    query(
      `SELECT sg.id, sg.copy_id, sg.status, sg.checked_out_at, sg.returned_at,
              c.copy_code, t.title
         FROM bms_board_game_session_games sg
         JOIN bms_board_game_copies c ON c.tenant_id = sg.tenant_id AND c.id = sg.copy_id
         JOIN bms_board_game_titles t ON t.tenant_id = c.tenant_id AND t.id = c.title_id
        WHERE sg.tenant_id = $1 AND sg.session_id = $2
        ORDER BY sg.checked_out_at, sg.id`,
      [tenantId, sessionId]
    ),
  ]);
  if (!session.rowCount) throw new Error("ไม่พบ session");
  const row = session.rows[0];
  return {
    ...mapSessionRow(row),
    locationId: row.location_id,
    tableId: row.table_id,
    currentOrderId: row.current_order_id,
    chargeSnapshot: row.charge_snapshot ?? [],
    participants: participants.rows.map((participant: any) => ({
      id: participant.id,
      displayName: participant.display_name,
      participantType: participant.participant_type,
      billable: Boolean(participant.billable),
      hourlyRate: Number(participant.hourly_rate_snapshot),
      minimumMinutes: Number(participant.minimum_minutes_snapshot),
      roundingMinutes: Number(participant.rounding_minutes_snapshot),
      graceMinutes: Number(participant.grace_minutes_snapshot),
      billingGroupNo: Number(participant.billing_group_no),
      joinedAt: iso(participant.joined_at),
      leftAt: iso(participant.left_at),
    })),
    games: games.rows.map((game: any) => ({
      id: game.id,
      copyId: game.copy_id,
      copyCode: game.copy_code,
      title: game.title,
      status: game.status,
      checkedOutAt: iso(game.checked_out_at),
      returnedAt: iso(game.returned_at),
    })),
  };
}

export async function getBoardGameCheckoutForPos(
  tenantId: string,
  locationIdInput: string,
  sessionIdInput: string
) {
  const locationId = uuid(locationIdInput, "locationId");
  const sessionId = uuid(sessionIdInput, "sessionId");
  await requireBoardGameCafeTenant({ query }, tenantId);
  const result = await query(
    `SELECT s.id, s.status, s.started_at, s.ended_at, s.amount_due,
            jsonb_array_length(s.charge_snapshot) AS charge_line_count,
            t.code AS table_code, t.name AS table_name
       FROM bms_board_game_sessions s
       JOIN bms_board_game_tables t
         ON t.tenant_id = s.tenant_id AND t.id = s.table_id
      WHERE s.tenant_id = $1 AND s.location_id = $2 AND s.id = $3
        AND s.status = 'CLOSING' AND s.current_order_id IS NULL`,
    [tenantId, locationId, sessionId]
  );
  if (!result.rowCount) throw new Error("ไม่พบบิลเวลาเล่นที่รอชำระในสาขานี้");
  const row = result.rows[0];
  return {
    id: row.id,
    tableCode: row.table_code,
    tableName: row.table_name,
    startedAt: iso(row.started_at),
    endedAt: iso(row.ended_at),
    amountDue: Number(row.amount_due),
    chargeLineCount: Number(row.charge_line_count),
  };
}

function mapPublicLocationProfile(row: any): BoardGamePublicLocationProfile {
  return {
    locationId: row.location_id,
    publicVisible: Boolean(row.public_visible),
    displayName: row.display_name ?? row.location_name,
    summary: row.summary ?? null,
    publicAddress: row.public_address ?? row.location_address ?? null,
    publicPhone: row.public_phone ?? row.location_phone ?? null,
    openingHours: row.opening_hours ?? null,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    publishRates: row.publish_rates == null ? true : Boolean(row.publish_rates),
    publishAvailability: row.publish_availability == null ? true : Boolean(row.publish_availability),
  };
}

export async function getBoardGamePublicLocationProfile(
  tenantId: string,
  locationIdInput: string
): Promise<BoardGamePublicLocationProfile> {
  const locationId = uuid(locationIdInput, "locationId");
  await requireBoardGameCafeTenant({ query }, tenantId);
  const result = await query(
    `SELECT l.id AS location_id, l.name AS location_name, l.address AS location_address,
            l.phone AS location_phone, profile.public_visible, profile.display_name,
            profile.summary, profile.public_address, profile.public_phone,
            profile.opening_hours, profile.latitude, profile.longitude,
            profile.publish_rates, profile.publish_availability
       FROM bms_locations l
       LEFT JOIN bms_board_game_public_locations profile
         ON profile.tenant_id = l.tenant_id AND profile.location_id = l.id
      WHERE l.tenant_id = $1 AND l.id = $2 AND l.active`,
    [tenantId, locationId]
  );
  if (!result.rowCount) throw new Error("ไม่พบสาขาที่ต้องการตั้งค่าหน้าค้นหา");
  return mapPublicLocationProfile(result.rows[0]);
}

export async function upsertBoardGamePublicLocationProfile(
  tenantId: string,
  input: {
    locationId: string;
    publicVisible?: boolean | null;
    displayName?: string | null;
    summary?: string | null;
    publicAddress?: string | null;
    publicPhone?: string | null;
    openingHours?: string | null;
    latitude?: number | string | null;
    longitude?: number | string | null;
    publishRates?: boolean | null;
    publishAvailability?: boolean | null;
  },
  actorUserId?: string | null
): Promise<BoardGamePublicLocationProfile> {
  const locationId = uuid(input.locationId, "locationId");
  const publicVisible = booleanOrDefault(input.publicVisible, false, "สถานะเผยแพร่");
  const displayName = optionalText(input.displayName, "ชื่อสาขาสาธารณะ", 120);
  const summary = optionalText(input.summary, "คำอธิบายร้าน", 500);
  const publicAddress = optionalText(input.publicAddress, "ที่อยู่สาธารณะ", 300);
  const publicPhone = optionalText(input.publicPhone, "เบอร์โทรสาธารณะ", 40);
  const openingHours = optionalText(input.openingHours, "เวลาเปิดร้าน", 300);
  const latitude = input.latitude == null || input.latitude === "" ? null : Number(input.latitude);
  const longitude = input.longitude == null || input.longitude === "" ? null : Number(input.longitude);
  if ((latitude == null) !== (longitude == null)) throw new Error("ต้องระบุละติจูดและลองจิจูดให้ครบทั้งคู่");
  if (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    throw new Error("ละติจูดไม่ถูกต้อง");
  }
  if (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    throw new Error("ลองจิจูดไม่ถูกต้อง");
  }
  if (publicVisible && (latitude == null || longitude == null)) {
    throw new Error("ต้องระบุพิกัดก่อนเปิดให้ค้นหาร้านใกล้ฉัน");
  }
  const publishRates = booleanOrDefault(input.publishRates, true, "สถานะแสดงเรทราคา");
  const publishAvailability = booleanOrDefault(input.publishAvailability, true, "สถานะแสดงโต๊ะว่าง");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const location = await client.query(
      `SELECT id FROM bms_locations WHERE tenant_id = $1 AND id = $2 AND active`,
      [tenantId, locationId]
    );
    if (!location.rowCount) throw new Error("ไม่พบสาขาที่ต้องการตั้งค่าหน้าค้นหา");
    await client.query(
      `INSERT INTO bms_board_game_public_locations
          (tenant_id, location_id, public_visible, display_name, summary,
           public_address, public_phone, opening_hours, latitude, longitude,
           publish_rates, publish_availability)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (tenant_id, location_id) DO UPDATE SET
          public_visible = EXCLUDED.public_visible,
          display_name = EXCLUDED.display_name,
          summary = EXCLUDED.summary,
          public_address = EXCLUDED.public_address,
          public_phone = EXCLUDED.public_phone,
          opening_hours = EXCLUDED.opening_hours,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          publish_rates = EXCLUDED.publish_rates,
          publish_availability = EXCLUDED.publish_availability,
          updated_at = now()`,
      [
        tenantId, locationId, publicVisible, displayName, summary, publicAddress,
        publicPhone, openingHours, latitude, longitude, publishRates, publishAvailability,
      ]
    );
    await auditInTx(client, tenantId, actorUserId, "board_game.public_profile_upsert", locationId, {
      publicVisible,
      publishRates,
      publishAvailability,
    });
    await client.query("COMMIT");
    return await getBoardGamePublicLocationProfile(tenantId, locationId);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function listPublicBoardGameCafes(input: {
  latitude?: number | null;
  longitude?: number | null;
  radiusKm?: number | null;
  limit?: number | null;
} = {}): Promise<PublicBoardGameCafe[]> {
  const hasOrigin = input.latitude != null && input.longitude != null;
  const latitude = hasOrigin ? Number(input.latitude) : null;
  const longitude = hasOrigin ? Number(input.longitude) : null;
  if (hasOrigin && (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude! < -90 || latitude! > 90 || longitude! < -180 || longitude! > 180)) {
    throw new Error("พิกัดค้นหาไม่ถูกต้อง");
  }
  const requestedRadiusKm = Number(input.radiusKm ?? 50);
  const requestedLimit = Number(input.limit ?? 60);
  if (!Number.isFinite(requestedRadiusKm)) throw new Error("รัศมีค้นหาไม่ถูกต้อง");
  if (!Number.isFinite(requestedLimit)) throw new Error("จำนวนผลลัพธ์ไม่ถูกต้อง");
  const radiusKm = Math.min(Math.max(requestedRadiusKm, 1), 500);
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 100);
  const result = await query(
    `SELECT profile.location_id, profile.public_visible, profile.display_name,
            profile.summary, profile.public_address, profile.public_phone,
            profile.opening_hours, profile.latitude, profile.longitude,
            profile.publish_rates, profile.publish_availability,
            location.name AS location_name, tenant.slug AS tenant_slug,
            tenant.name AS shop_name, store.logo_url,
            CASE WHEN profile.publish_availability THEN (
              SELECT COUNT(*)::int FROM bms_board_game_tables table_row
               WHERE table_row.tenant_id = profile.tenant_id
                 AND table_row.location_id = profile.location_id
                 AND table_row.active AND NOT table_row.blocked
            ) ELSE NULL END AS total_tables,
            CASE WHEN profile.publish_availability THEN (
              SELECT COUNT(*)::int FROM bms_board_game_tables table_row
               WHERE table_row.tenant_id = profile.tenant_id
                 AND table_row.location_id = profile.location_id
                 AND table_row.active AND NOT table_row.blocked
                 AND NOT EXISTS (
                   SELECT 1 FROM bms_board_game_sessions session
                    WHERE session.tenant_id = table_row.tenant_id
                      AND session.table_id = table_row.id
                      AND session.status IN ('OPEN', 'CLOSING')
                 )
            ) ELSE NULL END AS available_tables,
            CASE WHEN profile.publish_rates THEN COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'name', rate.name,
                'customerType', rate.customer_type,
                'pricePerHour', rate.price_per_hour
              ) ORDER BY rate.sort_order, rate.name)
                FROM bms_board_game_time_rates rate
               WHERE rate.tenant_id = profile.tenant_id AND rate.active
            ), '[]'::jsonb) ELSE '[]'::jsonb END AS rates,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'title', game.title,
                'minPlayers', game.min_players,
                'maxPlayers', game.max_players,
                'typicalMinutes', game.typical_minutes
              ) ORDER BY game.title)
                FROM (
                  SELECT DISTINCT title.id, title.title, title.min_players,
                         title.max_players, title.typical_minutes
                    FROM bms_board_game_titles title
                    JOIN bms_board_game_copies copy
                      ON copy.tenant_id = title.tenant_id AND copy.title_id = title.id
                   WHERE title.tenant_id = profile.tenant_id
                     AND copy.location_id = profile.location_id
                     AND title.public_visible
                     AND copy.status NOT IN ('RETIRED', 'LOST')
                   ORDER BY title.title
                   LIMIT 12
                ) game
            ), '[]'::jsonb) AS games
       FROM bms_board_game_public_locations profile
       JOIN bms_locations location
         ON location.tenant_id = profile.tenant_id AND location.id = profile.location_id
       JOIN bms_tenants tenant
         ON tenant.id = profile.tenant_id AND tenant.active
       JOIN bms_store_profile store
         ON store.tenant_id = profile.tenant_id AND store.business_archetype = 'board_game_cafe'
      WHERE profile.public_visible AND location.active
      ORDER BY profile.updated_at DESC
      LIMIT 200`
  );
  const cafes = result.rows.map((row: any): PublicBoardGameCafe => {
    const profile = mapPublicLocationProfile(row);
    const distanceKm = hasOrigin
      ? haversineDistanceKm(latitude!, longitude!, profile.latitude!, profile.longitude!)
      : null;
    return {
      ...profile,
      tenantSlug: row.tenant_slug,
      shopName: row.shop_name,
      logoUrl: row.logo_url ?? null,
      distanceKm: distanceKm == null ? null : money(distanceKm),
      totalTables: row.total_tables == null ? null : Number(row.total_tables),
      availableTables: row.available_tables == null ? null : Number(row.available_tables),
      rates: (row.rates ?? []).map((rate: any) => ({
        name: String(rate.name),
        customerType: String(rate.customerType),
        pricePerHour: Number(rate.pricePerHour),
      })),
      games: (row.games ?? []).map((game: any) => ({
        title: String(game.title),
        minPlayers: game.minPlayers == null ? null : Number(game.minPlayers),
        maxPlayers: game.maxPlayers == null ? null : Number(game.maxPlayers),
        typicalMinutes: game.typicalMinutes == null ? null : Number(game.typicalMinutes),
      })),
    };
  });
  return cafes
    .filter((cafe) => cafe.distanceKm == null || cafe.distanceKm <= radiusKm)
    .sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY)
      || a.displayName.localeCompare(b.displayName))
    .slice(0, limit);
}

export async function calculateBoardGameSessionCharges(
  client: QueryClient,
  tenantId: string,
  sessionId: string,
  endedAt: Date | string
): Promise<{ lines: BoardGameChargeLine[]; total: number }> {
  const rows = await client.query<any>(
    `SELECT p.id, p.display_name, p.participant_type, p.billable, p.hourly_rate_snapshot,
            p.billing_group_no, p.joined_at,
            CASE
              WHEN s.billing_mode = 'FIXED_DURATION'
               AND s.expected_end_at > COALESCE(p.left_at, $3::timestamptz)
                THEN s.expected_end_at
              ELSE COALESCE(p.left_at, $3::timestamptz)
            END AS charge_end_at,
            p.minimum_minutes_snapshot AS minimum_minutes,
            p.rounding_minutes_snapshot AS rounding_minutes,
            p.grace_minutes_snapshot AS grace_minutes
       FROM bms_board_game_session_participants p
       JOIN bms_board_game_sessions s
         ON s.tenant_id = p.tenant_id AND s.id = p.session_id
      WHERE p.tenant_id = $1 AND p.session_id = $2
      ORDER BY p.created_at, p.id`,
    [tenantId, sessionId, endedAt]
  );
  const lines: BoardGameChargeLine[] = rows.rows.filter((row: any) => row.billable).map((row: any) => {
    const minutes = boardGameBillableMinutes({
      startedAt: row.joined_at,
      endedAt: row.charge_end_at,
      minimumMinutes: Number(row.minimum_minutes),
      roundingMinutes: Number(row.rounding_minutes),
      graceMinutes: Number(row.grace_minutes),
    });
    const hourlyRate = Number(row.hourly_rate_snapshot);
    return {
      participantId: row.id,
      displayName: row.display_name,
      participantType: row.participant_type,
      billingGroupNo: Number(row.billing_group_no),
      billableMinutes: minutes,
      hourlyRate,
      amount: money((minutes / 60) * hourlyRate),
    };
  });
  return { lines, total: money(lines.reduce((sum, line) => sum + line.amount, 0)) };
}

export async function closeBoardGameSessionForBilling(
  tenantId: string,
  sessionId: string,
  input: { idempotencyKey: string; endedAt?: string | Date | null; note?: string | null },
  actorUserId?: string | null
) {
  const scopedSessionId = uuid(sessionId, "sessionId");
  const key = requestKey(input.idempotencyKey);
  const requestedEndedAt = optionalDate(input.endedAt, "เวลาปิด");
  const normalizedNote = input.note?.trim() || null;
  const hash = requestHash({
    sessionId: scopedSessionId,
    endedAt: requestedEndedAt?.toISOString() ?? null,
    note: normalizedNote,
  });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    await lockIdempotencyKeyInTx(client, tenantId, "close", key);
    const session = await client.query(
      `SELECT id, status, started_at, ended_at, amount_due, charge_snapshot,
              settlement_idempotency_key, settlement_request_hash
         FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
      [tenantId, scopedSessionId]
    );
    if (!session.rowCount) throw new Error("ไม่พบ session");
    const row = session.rows[0];
    if (row.status === "CLOSING" || row.status === "PAID") {
      if (row.settlement_idempotency_key !== key || row.settlement_request_hash !== hash) {
        throw new IdempotencyConflictError(
          "session นี้เริ่มปิดบิลด้วยคำขออื่นแล้ว",
          "settlement",
        );
      }
      await client.query("COMMIT");
      return {
        sessionId: scopedSessionId,
        amountDue: Number(row.amount_due),
        lines: row.charge_snapshot ?? [],
        endedAt: iso(row.ended_at),
        replayed: true,
      };
    }
    if (row.status !== "OPEN") throw new Error("session นี้ปิดไปแล้ว");
    const endedAt = requestedEndedAt ?? new Date();
    if (endedAt <= new Date(row.started_at)) throw new Error("เวลาปิดต้องหลังเวลาเปิดโต๊ะ");
    const openLoans = await client.query(
      `SELECT 1 FROM bms_board_game_session_games
        WHERE tenant_id = $1 AND session_id = $2 AND status = 'CHECKED_OUT'
        LIMIT 1`,
      [tenantId, scopedSessionId]
    );
    if (openLoans.rowCount) throw new Error("กรุณารับคืนเกมทุกกล่องก่อนปิดบิล");
    const charges = await calculateBoardGameSessionCharges(client, tenantId, scopedSessionId, endedAt);
    await client.query(
      `UPDATE bms_board_game_sessions
          SET status = 'CLOSING', ended_at = $3, closed_by = $4, amount_due = $5,
              note = COALESCE($6, note), settlement_idempotency_key = $7,
              settlement_request_hash = $8, charge_snapshot = $9::jsonb,
              guest_count = 0, version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [
        tenantId, scopedSessionId, endedAt, actorUserId ?? null, charges.total,
        normalizedNote, key, hash, JSON.stringify(charges.lines),
      ]
    );
    await auditInTx(client, tenantId, actorUserId, "board_game.session_close_for_billing", scopedSessionId, {
      amountDue: charges.total,
      lineCount: charges.lines.length,
      overriddenTime: requestedEndedAt != null,
    });
    await client.query("COMMIT");
    return {
      sessionId: scopedSessionId,
      amountDue: charges.total,
      lines: charges.lines,
      endedAt: endedAt.toISOString(),
      replayed: false,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelBoardGameSession(
  tenantId: string,
  sessionId: string,
  input: { idempotencyKey: string; reason: string },
  actorUserId?: string | null
) {
  const scopedSessionId = uuid(sessionId, "sessionId");
  const key = requestKey(input.idempotencyKey);
  const reason = requiredText(input.reason, "เหตุผลยกเลิก", 500);
  const hash = requestHash({ sessionId: scopedSessionId, reason });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    await lockIdempotencyKeyInTx(client, tenantId, "cancel", key);
    const session = await client.query(
      `SELECT id, status, current_order_id, amount_due, ended_at,
              cancel_idempotency_key, cancel_request_hash
         FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
      [tenantId, scopedSessionId]
    );
    if (!session.rowCount) throw new Error("ไม่พบ session");
    const row = session.rows[0];
    if (row.status === "CANCELLED") {
      if (row.cancel_idempotency_key !== key || row.cancel_request_hash !== hash) {
        throw new IdempotencyConflictError(
          "session นี้ถูกยกเลิกด้วยคำขออื่นแล้ว",
          "cancel",
        );
      }
      await client.query("COMMIT");
      return { sessionId: scopedSessionId, status: "CANCELLED" as const, replayed: true };
    }
    if (row.status === "PAID" || row.current_order_id) throw new Error("session ที่สร้างบิลหรือชำระแล้วไม่สามารถยกเลิกได้");
    const openLoans = await client.query(
      `SELECT 1 FROM bms_board_game_session_games
        WHERE tenant_id = $1 AND session_id = $2 AND status = 'CHECKED_OUT'
        LIMIT 1`,
      [tenantId, scopedSessionId]
    );
    if (openLoans.rowCount) throw new Error("กรุณารับคืนเกมทุกกล่องก่อนยกเลิก session");
    await client.query(
      `UPDATE bms_board_game_sessions
          SET status = 'CANCELLED', ended_at = COALESCE(ended_at, now()), closed_by = $3,
              amount_due = 0, guest_count = 0, note = $4,
              cancel_idempotency_key = $5, cancel_request_hash = $6,
              version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, scopedSessionId, actorUserId ?? null, reason, key, hash]
    );
    await auditInTx(client, tenantId, actorUserId, "board_game.session_cancel", scopedSessionId, {
      previousAmountDue: Number(row.amount_due),
      reason,
    });
    await client.query("COMMIT");
    return { sessionId: scopedSessionId, status: "CANCELLED" as const, replayed: false };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function listBoardGameLibrary(tenantId: string, locationId?: string | null) {
  await requireBoardGameCafeTenant({ query }, tenantId);
  const scopedLocationId = locationId ? uuid(locationId, "locationId") : null;
  const result = await query(
    `SELECT t.id, t.title, t.min_players, t.max_players, t.typical_minutes,
            t.difficulty, t.language, t.tags, t.public_visible, t.linked_product_sku,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'id', c.id,
                  'locationId', c.location_id,
                  'copyCode', c.copy_code,
                  'status', c.status,
                  'conditionNote', c.condition_note
                )
                ORDER BY c.copy_code
              ) FILTER (WHERE c.id IS NOT NULL),
              '[]'::jsonb
            ) AS copies
       FROM bms_board_game_titles t
       LEFT JOIN bms_board_game_copies c
         ON c.tenant_id = t.tenant_id
        AND c.title_id = t.id
        AND ($2::uuid IS NULL OR c.location_id = $2::uuid)
      WHERE t.tenant_id = $1
      GROUP BY t.id
      ORDER BY t.title`,
    [tenantId, scopedLocationId]
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    title: row.title,
    minPlayers: row.min_players == null ? null : Number(row.min_players),
    maxPlayers: row.max_players == null ? null : Number(row.max_players),
    typicalMinutes: row.typical_minutes == null ? null : Number(row.typical_minutes),
    difficulty: row.difficulty,
    language: row.language,
    tags: row.tags ?? [],
    publicVisible: Boolean(row.public_visible),
    linkedProductSku: row.linked_product_sku,
    copies: row.copies ?? [],
  }));
}

export async function createBoardGameTitle(
  tenantId: string,
  input: {
    title: string;
    minPlayers?: number | null;
    maxPlayers?: number | null;
    typicalMinutes?: number | null;
    difficulty?: string | null;
    language?: string | null;
    tags?: string[] | null;
    publicVisible?: boolean | null;
    linkedProductSku?: string | null;
  },
  actorUserId?: string | null
) {
  const title = requiredText(input.title, "ชื่อเกม", 160);
  const minPlayers = input.minPlayers == null ? null : integerInRange(input.minPlayers, "จำนวนผู้เล่นขั้นต่ำ", 1, 100);
  const maxPlayers = input.maxPlayers == null ? null : integerInRange(input.maxPlayers, "จำนวนผู้เล่นสูงสุด", 1, 100);
  if (minPlayers != null && maxPlayers != null && maxPlayers < minPlayers) throw new Error("จำนวนผู้เล่นสูงสุดต้องไม่น้อยกว่าขั้นต่ำ");
  const typicalMinutes = input.typicalMinutes == null ? null : integerInRange(input.typicalMinutes, "เวลาเล่น", 1, 1440);
  const difficulty = input.difficulty ?? null;
  if (difficulty != null && !["LIGHT", "MEDIUM", "HEAVY", "CUSTOM"].includes(difficulty)) {
    throw new Error("ระดับความยากไม่ถูกต้อง");
  }
  const language = input.language ? requiredText(input.language, "ภาษา", 80) : null;
  const tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => requiredText(tag, "แท็ก", 60)).slice(0, 30)
    : [];
  if (input.tags != null && !Array.isArray(input.tags)) throw new Error("แท็กไม่ถูกต้อง");
  const publicVisible = booleanOrDefault(input.publicVisible, false, "สถานะแสดงเกมสาธารณะ");
  const linkedProductSku = input.linkedProductSku ? requiredText(input.linkedProductSku, "SKU สินค้าที่เชื่อม", 120) : null;
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const result = await client.query(
      `INSERT INTO bms_board_game_titles
          (tenant_id, title, min_players, max_players, typical_minutes, difficulty,
           language, tags, public_visible, linked_product_sku)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id, title) DO UPDATE SET
          min_players = EXCLUDED.min_players,
          max_players = EXCLUDED.max_players,
          typical_minutes = EXCLUDED.typical_minutes,
          difficulty = EXCLUDED.difficulty,
          language = EXCLUDED.language,
          tags = EXCLUDED.tags,
          public_visible = EXCLUDED.public_visible,
          linked_product_sku = EXCLUDED.linked_product_sku,
          updated_at = now()
       RETURNING id, title`,
      [
        tenantId,
        title,
        minPlayers,
        maxPlayers,
        typicalMinutes,
        difficulty,
        language,
        tags,
        publicVisible,
        linkedProductSku,
      ]
    );
    await auditInTx(client, tenantId, actorUserId, "board_game.title_upsert", result.rows[0].id, {
      title: result.rows[0].title,
    });
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function createBoardGameCopy(
  tenantId: string,
  input: {
    titleId: string;
    locationId: string;
    copyCode: string;
    purchaseOrderId?: string | null;
    purchaseCost?: number | null;
    acquiredAt?: string | Date | null;
  },
  actorUserId?: string | null
) {
  const titleId = uuid(input.titleId, "titleId");
  const locationId = uuid(input.locationId, "locationId");
  const copyCode = requiredText(input.copyCode, "รหัสกล่อง", 50);
  const purchaseOrderId = input.purchaseOrderId ? uuid(input.purchaseOrderId, "purchaseOrderId") : null;
  const purchaseCost = input.purchaseCost == null ? null : nonNegativeMoney(input.purchaseCost, "ราคาทุน");
  const acquiredAt = optionalDate(input.acquiredAt, "วันที่รับเกม");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const result = await client.query(
      `INSERT INTO bms_board_game_copies
          (tenant_id, title_id, location_id, copy_code, purchase_order_id, purchase_cost, acquired_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, copy_code, status`,
      [
        tenantId,
        titleId,
        locationId,
        copyCode,
        purchaseOrderId,
        purchaseCost,
        acquiredAt,
      ]
    );
    await auditInTx(client, tenantId, actorUserId, "board_game.copy_create", result.rows[0].id, {
      copyCode: result.rows[0].copy_code,
    });
    await client.query("COMMIT");
    return { id: result.rows[0].id, copyCode: result.rows[0].copy_code, status: result.rows[0].status };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function checkoutBoardGameCopy(
  tenantId: string,
  input: { sessionId: string; copyId: string; idempotencyKey: string },
  actorUserId?: string | null
) {
  const sessionId = uuid(input.sessionId, "sessionId");
  const copyId = uuid(input.copyId, "copyId");
  const key = requestKey(input.idempotencyKey);
  const hash = requestHash({ sessionId, copyId });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const replay = await replayActionInTx<Record<string, unknown>>(
      client, tenantId, "copy.checkout", key, hash
    );
    if (replay) {
      await client.query("COMMIT");
      return { ...replay, replayed: true };
    }
    const session = await client.query(
      `SELECT location_id FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'
        FOR UPDATE`,
      [tenantId, sessionId]
    );
    if (!session.rowCount) throw new Error("ไม่พบ session ที่เปิดอยู่");
    const copy = await client.query(
      `SELECT id FROM bms_board_game_copies
        WHERE tenant_id = $1 AND id = $2 AND location_id = $3 AND status = 'AVAILABLE'
        FOR UPDATE`,
      [tenantId, copyId, session.rows[0].location_id]
    );
    if (!copy.rowCount) throw new Error("เกมกล่องนี้ไม่พร้อมให้ยืม");
    const loan = await client.query(
      `INSERT INTO bms_board_game_session_games (tenant_id, session_id, copy_id)
       VALUES ($1,$2,$3)
       RETURNING id, checked_out_at`,
      [tenantId, sessionId, copyId]
    );
    await client.query(
      `UPDATE bms_board_game_copies
          SET status = 'IN_USE', updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, copyId]
    );
    const response = {
      id: loan.rows[0].id,
      checkedOutAt: iso(loan.rows[0].checked_out_at),
      replayed: false,
    };
    await storeActionResultInTx(client, tenantId, "copy.checkout", key, hash, response);
    await auditInTx(client, tenantId, actorUserId, "board_game.copy_checkout", sessionId, {
      copyId,
      loanId: loan.rows[0].id,
    });
    await client.query("COMMIT");
    return response;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function returnBoardGameCopy(
  tenantId: string,
  input: {
    loanId: string;
    idempotencyKey: string;
    status?: "RETURNED" | "ISSUE";
    copyStatus?: string | null;
    returnNote?: string | null;
  },
  actorUserId?: string | null
) {
  const loanId = uuid(input.loanId, "loanId");
  const status = input.status ?? "RETURNED";
  if (status !== "RETURNED" && status !== "ISSUE") throw new Error("สถานะคืนเกมไม่ถูกต้อง");
  const nextCopyStatus = (input.copyStatus ?? (status === "RETURNED" ? "AVAILABLE" : "NEEDS_CHECK")) as BoardGameCopyStatus;
  if (!COPY_RETURN_STATUSES.has(nextCopyStatus)) throw new Error("สถานะกล่องเกมหลังคืนไม่ถูกต้อง");
  if (status === "ISSUE" && nextCopyStatus === "AVAILABLE") throw new Error("เกมที่มีปัญหาไม่สามารถตั้งเป็นพร้อมให้ยืมได้");
  const returnNote = input.returnNote?.trim() || null;
  const key = requestKey(input.idempotencyKey);
  const hash = requestHash({ loanId, status, copyStatus: nextCopyStatus, returnNote });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const replay = await replayActionInTx<Record<string, unknown>>(
      client, tenantId, "copy.return", key, hash
    );
    if (replay) {
      await client.query("COMMIT");
      return { ...replay, replayed: true };
    }
    const loan = await client.query<{ copy_id: string; session_id: string }>(
      `SELECT copy_id, session_id FROM bms_board_game_session_games
        WHERE tenant_id = $1 AND id = $2 AND status = 'CHECKED_OUT'
        FOR UPDATE`,
      [tenantId, loanId]
    );
    if (!loan.rowCount) throw new Error("ไม่พบรายการยืมเกมที่ยังไม่คืน");
    const returnedAt = new Date();
    await client.query(
      `UPDATE bms_board_game_session_games
          SET status = $3, returned_at = $4, return_note = $5, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, loanId, status, returnedAt, returnNote]
    );
    await client.query(
      `UPDATE bms_board_game_copies
          SET status = $3, condition_note = COALESCE($4, condition_note),
              retired_at = CASE WHEN $3 = 'RETIRED' THEN COALESCE(retired_at, $5) ELSE NULL END,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, loan.rows[0].copy_id, nextCopyStatus, returnNote, returnedAt]
    );
    const response = {
      id: loanId,
      returnedAt: returnedAt.toISOString(),
      copyStatus: nextCopyStatus,
      replayed: false,
    };
    await storeActionResultInTx(client, tenantId, "copy.return", key, hash, response);
    await auditInTx(client, tenantId, actorUserId, "board_game.copy_return", loan.rows[0].session_id, {
      copyId: loan.rows[0].copy_id,
      loanId,
      copyStatus: nextCopyStatus,
    });
    await client.query("COMMIT");
    return response;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

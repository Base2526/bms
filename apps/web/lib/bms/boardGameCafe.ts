import { createHash } from "crypto";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { getClient, query } from "@/lib/db";
import {
  IDEMPOTENCY_CONFLICT_MESSAGE,
  IdempotencyConflictError,
} from "./idempotencyErrors";
import { listLocationsForUser } from "./locations";
import {
  applyBoardGamePassCoverage,
  boardGamePassExpiry,
  type BoardGamePassBudget,
  type BoardGamePassKind,
} from "./boardGamePassCoverage";
import {
  applyBestBoardGameOffer,
  eligibleBoardGameOffersInTx,
} from "./boardGameOffers";
import {
  refreshBoardGameSeatingInTx,
  refreshSessionFromGroupsInTx,
} from "./boardGameSessionStatus";
import { cancelOrderInTx, createOrderInTx } from "./orders";
import { resolvePosScan } from "./pos";
import { beginTenantTx } from "./tenant";

export type BoardGameBillingMode = "OPEN_ENDED" | "FIXED_DURATION";
export type BoardGameParticipantTimeMode = "ACTUAL" | "SESSION_END" | "DURATION";
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
  timeMode?: BoardGameParticipantTimeMode | null;
  purchasedDurationMinutes?: number | null;
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
  /** ป้ายเรทที่แช่ตอนรับผู้เล่น — เปลี่ยนชื่อเรทภายหลังต้องไม่แก้ใบเสร็จเก่า */
  rateCode?: string | null;
  rateName?: string | null;
  /** เวลาจริงกับเวลาที่ใช้คิดเงินแยกกัน เพราะแพ็กเกจแบบกำหนดเวลาหรือการปัดรอบอาจไม่เท่ากัน */
  joinedAt?: string | null;
  actualEndedAt?: string | null;
  chargedUntil?: string | null;
  actualMinutes?: number;
  billableMinutes: number;
  hourlyRate: number;
  /** ยอดที่ลูกค้าต้องจ่ายจริงหลังแพ็กเกจสมาชิกช่วยจ่ายแล้ว (`9.92`) */
  amount: number;
  // ฟิลด์ของ `9.92` · snapshot ที่แช่ไว้ก่อนหน้านั้นไม่มี — ผู้อ่านต้องทนกับ undefined ได้
  customerId?: string | null;
  /** ค่าเวลาก่อนแพ็กเกจช่วยจ่าย · เท่ากับ `amount` เมื่อไม่มีแพ็กเกจ */
  grossAmount?: number;
  passId?: string | null;
  coveredMinutes?: number;
  coveredAmount?: number;
  /** โปรโมชันค่าเวลาที่ชนะการเปรียบเทียบกับ member pass ณ ตอนปิดบิล (`10.3`) */
  offerId?: string | null;
  offerCode?: string | null;
  offerName?: string | null;
  offerDiscountAmount?: number;
};

/**
 * กลุ่มบิล (`9.89`) = สิ่งที่บิลหนึ่งใบเก็บเงิน
 *
 * โต๊ะหนึ่งโต๊ะมีได้หลายกลุ่ม และ **แต่ละกลุ่มออกบิลของตัวเอง** — ก่อน `9.89`
 * `billing_group_no` มีอยู่บนผู้เล่นและไหลไปถึงบรรทัดค่าเล่นก็จริง แต่ทุกกลุ่มถูกเก็บเงิน
 * ในออร์เดอร์ใบเดียวกัน "กลุ่มนี้จ่ายแล้วกลับก่อน" จึงไม่มีที่ให้บันทึก
 */
export type BoardGameBillingGroupStatus = BoardGameSessionStatus | "MERGED";

export type BoardGameBillingGroup = {
  id: string;
  groupNo: number;
  status: BoardGameBillingGroupStatus;
  /** ค่าเล่นที่แช่ไว้ตอนปิด — ยังเล่นอยู่จะเป็น 0 */
  amountDue: number;
  /** ยอดของที่สั่งเข้าบิลระหว่างเล่น (`9.90`) */
  tabAmount: number;
  endedAt: string | null;
  currentOrderId: string | null;
  chargeSnapshot: BoardGameChargeLine[];
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
  bookingEnabled: boolean;
  reservationReminderMinutes: number;
  timezone: string;
  reservationMinAdvanceMinutes: number;
  reservationRequestTtlMinutes: number;
  reservationDepositPolicy: "NONE" | "FIXED" | "PERCENT";
  reservationDepositAmount: number;
  reservationDepositPercent: number;
  reservationDepositPaymentWindowMinutes: number;
  reservationDepositRefundCutoffHours: number;
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

export type QueryClient = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: any[]): Promise<QueryResult<T>>;
};

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function iso(value: Date | string | null | undefined) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * เวลาของคอลัมน์ที่เป็น NOT NULL — ค่าที่หายไปแปลว่า query เลือกคอลัมน์ผิด ไม่ใช่ว่าข้อมูลว่าง
 * ล้มดัง ๆ ตรงนี้อ่านง่ายกว่าปล่อยคำว่า "null" หรือสตริงว่างไปโผล่บนจอของคนหน้าร้าน
 */
function isoRequired(value: Date | string | null | undefined, label: string): string {
  const formatted = iso(value);
  if (!formatted) throw new Error(`ไม่พบค่าของ ${label}`);
  return formatted;
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
  const candidates = [row.expected_end_at, row.next_participant_end_at]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  if (row.status !== "OPEN" || candidates.length === 0) return "NORMAL";
  const expected = Math.min(...candidates);
  const now = Date.now();
  if (now >= expected) return "OVERDUE";
  return now >= expected - Number(row.alert_before_minutes ?? 15) * 60000 ? "ENDING_SOON" : "NORMAL";
}

function mapSessionRow(row: any, replayed = false) {
  const nextAlertAt = [row.expected_end_at, row.next_participant_end_at]
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => Number.isFinite(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
  return {
    id: row.id,
    status: row.status as BoardGameSessionStatus,
    billingMode: row.billing_mode as BoardGameBillingMode,
    guestCount: Number(row.guest_count),
    startedAt: iso(row.started_at),
    expectedEndAt: iso(row.expected_end_at),
    nextAlertAt: nextAlertAt?.toISOString() ?? null,
    endedAt: iso(row.ended_at),
    alertBeforeMinutes: Number(row.alert_before_minutes ?? 15),
    alertStatus: computedAlertStatus(row),
    amountDue: Number(row.amount_due),
    replayed,
  };
}

type PreparedParticipant = {
  rateId: string | null;
  rateCode: string | null;
  rateName: string | null;
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
  timeMode: BoardGameParticipantTimeMode;
  plannedEndAt: Date | null;
};

type BoardGameRateRow = {
  id: string;
  code: string;
  name: string;
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

function boardGameActualMinutes(startedAt: Date | string, endedAt: Date | string): number {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.ceil((end - start) / 60000);
}

/** ใช้โดย `boardGameIdentity.ts` ด้วย — ทางเดียว ไม่มี import ย้อนกลับ (ด่านปิดบิลเป็น SQL ในไฟล์นี้) */
export async function requireBoardGameCafeTenant(client: QueryClient, tenantId: string) {
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
  defaultJoinedAt: Date,
  timing?: { defaultMode?: BoardGameParticipantTimeMode; sessionExpectedEndAt?: Date | null }
): Promise<PreparedParticipant> {
  let rate: BoardGameRateRow | null = null;
  if (input.rateId) {
    const rateId = uuid(input.rateId, "rateId");
    const rateResult = await client.query<BoardGameRateRow>(
      `SELECT id, code, name, price_per_hour, customer_type, minimum_minutes, rounding_minutes, grace_minutes
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
  const timeMode = (input.timeMode ?? timing?.defaultMode ?? "ACTUAL") as BoardGameParticipantTimeMode;
  if (!(["ACTUAL", "SESSION_END", "DURATION"] as string[]).includes(timeMode)) {
    throw new Error("รูปแบบเวลาของผู้เล่นไม่ถูกต้อง");
  }
  let plannedEndAt: Date | null = null;
  if (timeMode === "SESSION_END") {
    plannedEndAt = timing?.sessionExpectedEndAt ?? null;
    if (!plannedEndAt || plannedEndAt <= joinedAt) {
      throw new Error("เวลาสิ้นสุดของโต๊ะต้องอยู่หลังเวลาเข้าร่วม");
    }
  } else if (timeMode === "DURATION") {
    const minutes = integerInRange(input.purchasedDurationMinutes, "เวลาที่ผู้เล่นซื้อ", 1, 1440);
    plannedEndAt = new Date(joinedAt.getTime() + minutes * 60_000);
  }
  return {
    rateId: rate?.id ?? null,
    rateCode: rate?.code ?? null,
    rateName: rate?.name ?? null,
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
    timeMode,
    plannedEndAt,
  };
}

async function insertParticipantInTx(
  client: QueryClient,
  tenantId: string,
  sessionId: string,
  billingGroupId: string,
  participant: PreparedParticipant
) {
  return client.query(
    `INSERT INTO bms_board_game_session_participants
        (tenant_id, session_id, billing_group_id, rate_id, rate_code_snapshot, rate_name_snapshot,
         customer_id, display_name,
         participant_type, billable, hourly_rate_snapshot, minimum_minutes_snapshot,
         rounding_minutes_snapshot, grace_minutes_snapshot, billing_group_no, joined_at,
         time_mode, planned_end_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id, display_name, participant_type, billable, rate_code_snapshot, rate_name_snapshot,
               hourly_rate_snapshot,
               minimum_minutes_snapshot, rounding_minutes_snapshot, grace_minutes_snapshot,
               billing_group_no, billing_group_id, joined_at, left_at, time_mode, planned_end_at`,
    [
      tenantId, sessionId, billingGroupId, participant.rateId, participant.rateCode,
      participant.rateName, participant.customerId, participant.displayName,
      participant.participantType, participant.billable,
      participant.hourlyRate, participant.minimumMinutes, participant.roundingMinutes,
      participant.graceMinutes, participant.billingGroupNo, participant.joinedAt,
      participant.timeMode, participant.plannedEndAt,
    ]
  );
}

/**
 * คีย์กันรายการซ้ำของกลุ่ม แตกจากคีย์เดียวที่คนหน้าเครื่องส่งมา
 *
 * ปิดโต๊ะหนึ่งครั้ง = ปิดหลายกลุ่ม แต่คีย์เป็น unique ต่อร้าน จึงใช้คีย์เดียวกันซ้ำทุกกลุ่มไม่ได้
 * และการต่อท้ายเป็นข้อความ (`key:1`) ทะลุเพดาน 200 ตัวอักษรได้เมื่อคีย์ต้นทางยาว · แฮชจึง
 * ให้ทั้งความยาวคงที่และความเป็น deterministic ที่ retry ต้องการ — ยิงซ้ำด้วยคีย์เดิมได้คีย์กลุ่มเดิม
 */
function groupRequestKey(baseKey: string, groupNo: number): string {
  return createHash("sha256").update(`${baseKey}:bg-group:${groupNo}`).digest("hex");
}

type BillingGroupRow = {
  id: string;
  group_no: number;
  status: BoardGameBillingGroupStatus;
  amount_due: string;
  tab_amount: string;
  ended_at: Date | null;
  current_order_id: string | null;
  charge_snapshot: unknown;
  settlement_idempotency_key: string | null;
  settlement_request_hash: string | null;
  cancel_idempotency_key: string | null;
  cancel_request_hash: string | null;
};

function mapBillingGroupRow(row: BillingGroupRow): BoardGameBillingGroup {
  return {
    id: row.id,
    groupNo: Number(row.group_no),
    status: row.status,
    amountDue: Number(row.amount_due),
    tabAmount: Number(row.tab_amount),
    endedAt: iso(row.ended_at),
    currentOrderId: row.current_order_id,
    chargeSnapshot: Array.isArray(row.charge_snapshot)
      ? (row.charge_snapshot as BoardGameChargeLine[])
      : [],
  };
}

const BILLING_GROUP_COLUMNS = `id, group_no, status, amount_due, tab_amount, ended_at,
         current_order_id, charge_snapshot, settlement_idempotency_key, settlement_request_hash,
         cancel_idempotency_key, cancel_request_hash`;

async function lockSessionBillingGroupsInTx(
  client: QueryClient,
  tenantId: string,
  sessionId: string
): Promise<BillingGroupRow[]> {
  const result = await client.query<BillingGroupRow>(
    `SELECT ${BILLING_GROUP_COLUMNS}
       FROM bms_board_game_billing_groups
      WHERE tenant_id = $1 AND session_id = $2
      ORDER BY group_no
      FOR UPDATE`,
    [tenantId, sessionId]
  );
  return result.rows;
}

/**
 * หากลุ่มของหมายเลขที่ขอ · สร้างให้เมื่อยังไม่มี
 *
 * กลุ่มที่ปิดไปแล้วรับคนเพิ่มไม่ได้ — เวลาเล่นของคนที่เพิ่งเข้ามาจะไม่มีทางถูกคิดเงิน เพราะ
 * บรรทัดค่าเล่นของกลุ่มนั้นถูกแช่ไว้ตั้งแต่ตอนปิดแล้ว
 */
async function resolveBillingGroupInTx(
  client: QueryClient,
  tenantId: string,
  locationId: string,
  sessionId: string,
  groupNo: number
): Promise<string> {
  const existing = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM bms_board_game_billing_groups
      WHERE tenant_id = $1 AND session_id = $2 AND group_no = $3
      FOR UPDATE`,
    [tenantId, sessionId, groupNo]
  );
  if (existing.rowCount) {
    if (existing.rows[0].status !== "OPEN") {
      throw new Error(`กลุ่มบิล ${groupNo} ปิดไปแล้ว เพิ่มผู้เล่นเข้ากลุ่มนี้ไม่ได้`);
    }
    return existing.rows[0].id;
  }
  const created = await client.query<{ id: string }>(
    `INSERT INTO bms_board_game_billing_groups (tenant_id, location_id, session_id, group_no)
     VALUES ($1,$2,$3,$4)
     RETURNING id`,
    [tenantId, locationId, sessionId, groupNo]
  );
  return created.rows[0].id;
}

/**
 * สถานะของโต๊ะเป็น "ผลรวมของกลุ่ม" ไม่ใช่ค่าที่ตั้งเอง
 *
 * session ยังเปิดตราบใดที่มีกลุ่มไหนยังเล่นอยู่ · ตั้งแต่ `9.91` ที่นั่งเป็นเจ้าของโต๊ะจริง
 * และว่างก็ต่อเมื่อทุก session ที่แชร์ที่นั่งนั้นจบแล้ว
 */

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
  kind: "area" | "table" | "session" | "billingGroup" | "copy" | "loan" | "passPlan" | "memberPass"
): Promise<string | null> {
  const entityId = uuid(entityIdInput, `${kind}Id`);
  const statements = {
    area: `SELECT location_id FROM bms_board_game_areas WHERE tenant_id = $1 AND id = $2`,
    table: `SELECT location_id FROM bms_board_game_tables WHERE tenant_id = $1 AND id = $2`,
    session: `SELECT location_id FROM bms_board_game_sessions WHERE tenant_id = $1 AND id = $2`,
    billingGroup: `SELECT location_id FROM bms_board_game_billing_groups WHERE tenant_id = $1 AND id = $2`,
    copy: `SELECT location_id FROM bms_board_game_copies WHERE tenant_id = $1 AND id = $2`,
    loan: `SELECT s.location_id
             FROM bms_board_game_session_games g
             JOIN bms_board_game_sessions s
               ON s.tenant_id = g.tenant_id AND s.id = g.session_id
            WHERE g.tenant_id = $1 AND g.id = $2`,
    // แพ็กเกจของสาขาเดียว (`9.92`) — `NULL` แปลว่าขายได้ทุกสาขา ไม่ใช่ "ไม่พบ" · ผู้เรียก
    // แยกสองอย่างนี้ด้วย `boardGamePlanIsBranchScoped()` ไม่ใช่ด้วยค่าที่คืนมาตัวเดียว
    passPlan: `SELECT location_id FROM bms_board_game_pass_plans WHERE tenant_id = $1 AND id = $2`,
    // สาขาเป็น snapshot ของสัญญาที่ขายแล้ว (`9.94`) ห้ามตาม plan ปัจจุบัน เพราะการแก้
    // แคตตาล็อกภายหลังต้องไม่ย้ายสิทธิ์เก่าข้ามสาขา
    memberPass: `SELECT location_id
                   FROM bms_board_game_member_passes
                  WHERE tenant_id = $1 AND id = $2`,
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
export const locationOfBoardGameBillingGroup = (tenantId: string, billingGroupId: string) =>
  boardGameEntityLocation(tenantId, billingGroupId, "billingGroup");
export const locationOfBoardGameCopy = (tenantId: string, copyId: string) =>
  boardGameEntityLocation(tenantId, copyId, "copy");
export const locationOfBoardGameLoan = (tenantId: string, loanId: string) =>
  boardGameEntityLocation(tenantId, loanId, "loan");
/**
 * สาขาของแพ็กเกจ (`9.92`) — `null` มีสองความหมายที่ห้ามยุบเป็นอันเดียว: แพ็กเกจที่ขายได้
 * ทุกสาขา กับแพ็กเกจที่ไม่มีอยู่จริง · ผู้เรียกต้องตรวจว่ามีแถวอยู่ก่อนด้วย `boardGamePlanExists`
 */
export const locationOfBoardGamePassPlan = (tenantId: string, planId: string) =>
  boardGameEntityLocation(tenantId, planId, "passPlan");
export const locationOfBoardGameMemberPass = (tenantId: string, passId: string) =>
  boardGameEntityLocation(tenantId, passId, "memberPass");

export async function boardGamePlanExists(tenantId: string, planId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM bms_board_game_pass_plans WHERE tenant_id = $1 AND id = $2`,
    [tenantId, uuid(planId, "planId")]
  );
  return Boolean(result.rowCount);
}

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
      // `9.91`: โต๊ะปัจจุบันมาจาก seating ไม่ใช่ session เดิม · หลังรวมโต๊ะ session หลายก้อน
      // แชร์ seating เดียวกันได้ แต่บิล/เวลา/เกมยังอยู่กับ session ต้นฉบับทุกก้อน
      `SELECT t.id, t.area_id, t.code, t.name, t.seats, t.sort_order, t.blocked,
              st.id AS seating_id,
              sa.session_id, sa.session_ids, sa.session_count, sa.status,
              sa.billing_mode, sa.guest_count, sa.started_at, sa.expected_end_at,
              sa.next_alert_at,
              sa.alert_status,
              COALESCE(ga.amount_due, 0) AS amount_due,
              COALESCE(ga.group_count, 0) AS billing_group_count,
              COALESCE(ga.awaiting_payment_count, 0) AS awaiting_payment_count
         FROM bms_board_game_tables t
         LEFT JOIN bms_board_game_seatings st
           ON st.tenant_id = t.tenant_id AND st.table_id = t.id AND st.status = 'ACTIVE'
         LEFT JOIN LATERAL (
           SELECT (array_agg(s.id ORDER BY s.started_at, s.id))[1] AS session_id,
                  array_agg(s.id ORDER BY s.started_at, s.id) AS session_ids,
                  count(*)::integer AS session_count,
                  CASE WHEN bool_or(s.status = 'OPEN') THEN 'OPEN' ELSE 'CLOSING' END AS status,
                  (array_agg(s.billing_mode ORDER BY s.started_at, s.id))[1] AS billing_mode,
                  sum(s.guest_count)::integer AS guest_count,
                  min(s.started_at) AS started_at,
                  min(s.expected_end_at) FILTER (WHERE s.status = 'OPEN') AS expected_end_at,
                  LEAST(
                    min(s.expected_end_at) FILTER (WHERE s.status = 'OPEN'),
                    (SELECT min(p.planned_end_at)
                       FROM bms_board_game_session_participants p
                       JOIN bms_board_game_billing_groups pg
                         ON pg.tenant_id = p.tenant_id AND pg.id = p.billing_group_id
                       JOIN bms_board_game_sessions ps
                         ON ps.tenant_id = p.tenant_id AND ps.id = p.session_id
                      WHERE p.tenant_id = st.tenant_id
                        AND ps.seating_id = st.id AND ps.status = 'OPEN'
                        AND p.left_at IS NULL AND p.planned_end_at IS NOT NULL
                        AND pg.status = 'OPEN')
                  ) AS next_alert_at,
                  CASE
                    WHEN bool_or(s.status = 'OPEN' AND s.expected_end_at IS NOT NULL
                                 AND now() >= s.expected_end_at)
                      OR EXISTS (
                        SELECT 1 FROM bms_board_game_session_participants p
                        JOIN bms_board_game_billing_groups pg
                          ON pg.tenant_id = p.tenant_id AND pg.id = p.billing_group_id
                        JOIN bms_board_game_sessions ps
                          ON ps.tenant_id = p.tenant_id AND ps.id = p.session_id
                        WHERE p.tenant_id = st.tenant_id
                          AND ps.seating_id = st.id AND ps.status = 'OPEN'
                          AND p.left_at IS NULL AND p.planned_end_at IS NOT NULL
                          AND pg.status = 'OPEN' AND now() >= p.planned_end_at
                      ) THEN 'OVERDUE'
                    WHEN bool_or(s.status = 'OPEN' AND s.expected_end_at IS NOT NULL
                                 AND now() >= s.expected_end_at
                                   - make_interval(mins => s.alert_before_minutes))
                      OR EXISTS (
                        SELECT 1 FROM bms_board_game_session_participants p
                        JOIN bms_board_game_billing_groups pg
                          ON pg.tenant_id = p.tenant_id AND pg.id = p.billing_group_id
                        JOIN bms_board_game_sessions ps
                          ON ps.tenant_id = p.tenant_id AND ps.id = p.session_id
                        WHERE p.tenant_id = st.tenant_id
                          AND ps.seating_id = st.id AND ps.status = 'OPEN'
                          AND p.left_at IS NULL AND p.planned_end_at IS NOT NULL
                          AND pg.status = 'OPEN'
                          AND now() >= p.planned_end_at
                            - make_interval(mins => ps.alert_before_minutes)
                      ) THEN 'ENDING_SOON'
                    ELSE 'NORMAL'
                  END AS alert_status
             FROM bms_board_game_sessions s
            WHERE s.tenant_id = st.tenant_id AND s.seating_id = st.id
              AND s.status IN ('OPEN', 'CLOSING')
         ) sa ON st.id IS NOT NULL
         LEFT JOIN LATERAL (
           SELECT sum(bg.amount_due + bg.tab_amount) AS amount_due,
                  count(*)::integer AS group_count,
                  count(*) FILTER (WHERE bg.status = 'CLOSING')::integer AS awaiting_payment_count
             FROM bms_board_game_sessions s
             JOIN bms_board_game_billing_groups bg
               ON bg.tenant_id = s.tenant_id AND bg.session_id = s.id
            WHERE s.tenant_id = st.tenant_id AND s.seating_id = st.id
              AND s.status IN ('OPEN', 'CLOSING')
              AND bg.status NOT IN ('CANCELLED', 'MERGED')
         ) ga ON st.id IS NOT NULL
        WHERE t.tenant_id = $1 AND t.location_id = $2 AND t.active
        ORDER BY t.sort_order, t.code`,
      [tenantId, scopedLocationId]
    ),
    query(
      `WITH seating_states AS (
         SELECT st.id,
                CASE WHEN bool_or(s.status = 'OPEN') THEN 'OPEN' ELSE 'CLOSING' END AS status
           FROM bms_board_game_seatings st
           JOIN bms_board_game_sessions s
             ON s.tenant_id = st.tenant_id AND s.seating_id = st.id
            AND s.status IN ('OPEN', 'CLOSING')
          WHERE st.tenant_id = $1 AND st.location_id = $2 AND st.status = 'ACTIVE'
          GROUP BY st.id
       )
       SELECT status, count(*)::integer AS count FROM seating_states GROUP BY status`,
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
        seatingId: row.seating_id,
        sessionIds: Array.isArray(row.session_ids) ? row.session_ids : [row.session_id],
        sessionCount: Number(row.session_count ?? 1),
        status: row.status,
        billingMode: row.billing_mode,
        guestCount: Number(row.guest_count),
        startedAt: iso(row.started_at),
        expectedEndAt: iso(row.expected_end_at),
        nextAlertAt: iso(row.next_alert_at),
        alertStatus: row.alert_status ?? "NORMAL",
        amountDue: Number(row.amount_due),
        billingGroupCount: Number(row.billing_group_count),
        awaitingPaymentCount: Number(row.awaiting_payment_count),
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
    allowOverCapacity?: boolean | null;
  },
  actorUserId?: string | null,
  /** Existing tenant transaction used by queue seating. Omit everywhere else. */
  transactionClient?: PoolClient,
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
    allowOverCapacity: input.allowOverCapacity === true,
    participants: input.participants.map((row) => ({
      rateId: row.rateId ?? null,
      displayName: row.displayName?.trim() || null,
      participantType: row.participantType ?? null,
      customerId: row.customerId ?? null,
      billingGroupNo: row.billingGroupNo ?? 1,
      joinedAt: row.joinedAt ? optionalDate(row.joinedAt, "เวลาเข้าร่วม")?.toISOString() : null,
      timeMode: row.timeMode ?? null,
      purchasedDurationMinutes: row.purchasedDurationMinutes ?? null,
    })),
  });
  const ownsTransaction = transactionClient == null;
  const client = transactionClient ?? await getClient();
  try {
    if (ownsTransaction) {
      await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    }
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
      if (ownsTransaction) await client.query("COMMIT");
      return mapSessionRow(replay.rows[0], true);
    }
    const table = await client.query<{ seats: number }>(
      `SELECT seats FROM bms_board_game_tables
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND active AND NOT blocked
        FOR UPDATE`,
      [tenantId, locationId, tableId]
    );
    if (!table.rowCount) throw new Error("ไม่พบโต๊ะบอร์ดเกมที่เปิดใช้งานอยู่");
    const seats = Number(table.rows[0].seats);
    if (input.participants.length > seats && input.allowOverCapacity !== true) {
      throw new Error(`โต๊ะนี้มี ${seats} ที่นั่ง แต่กำลังเปิดให้ ${input.participants.length} คน — กรุณายืนยันการใช้โต๊ะเกินความจุ`);
    }
    const occupied = await client.query(
      `SELECT 1 FROM bms_board_game_seatings
        WHERE tenant_id = $1 AND table_id = $2 AND status = 'ACTIVE'
        FOR UPDATE`,
      [tenantId, tableId]
    );
    if (occupied.rowCount) throw new Error("โต๊ะนี้มีลูกค้าอยู่แล้ว");
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
      const prepared = await prepareParticipantInTx(client, tenantId, participant, startedAt, {
        defaultMode: mode === "FIXED_DURATION" ? "SESSION_END" : "ACTUAL",
        sessionExpectedEndAt: expectedEndAt,
      });
      if (prepared.joinedAt < startedAt) throw new Error("เวลาเข้าร่วมต้องไม่ก่อนเวลาเปิดโต๊ะ");
      preparedParticipants.push(prepared);
    }
    const seating = await client.query<{ id: string }>(
      `INSERT INTO bms_board_game_seatings
          (tenant_id, location_id, table_id, opened_at)
       VALUES ($1,$2,$3,$4)
       RETURNING id`,
      [tenantId, locationId, tableId, startedAt]
    );
    const seatingId = seating.rows[0].id;
    const result = await client.query(
      `INSERT INTO bms_board_game_sessions
          (tenant_id, location_id, table_id, seating_id, pos_device_id, pos_shift_id, billing_mode,
           guest_count, expected_duration_minutes, started_at, expected_end_at, alert_before_minutes,
           note, opened_by, open_idempotency_key, open_request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id, status, billing_mode, guest_count, started_at, expected_end_at, ended_at,
                 alert_before_minutes, amount_due`,
      [
        tenantId,
        locationId,
        tableId,
        seatingId,
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
    // หนึ่งกลุ่มบิลต่อหนึ่งหมายเลขกลุ่มที่พนักงานตั้งไว้ · โต๊ะปกติที่ไม่ได้แยกกลุ่มจึงได้
    // กลุ่มเดียวและออกบิลใบเดียวเหมือนก่อน `9.89` ทุกประการ
    const newSessionId = result.rows[0].id as string;
    await client.query(
      `UPDATE bms_board_game_seatings
          SET origin_session_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, seatingId, newSessionId]
    );
    const groupIdByNo = new Map<number, string>();
    for (const participant of preparedParticipants) {
      let groupId = groupIdByNo.get(participant.billingGroupNo);
      if (!groupId) {
        groupId = await resolveBillingGroupInTx(
          client, tenantId, locationId, newSessionId, participant.billingGroupNo
        );
        groupIdByNo.set(participant.billingGroupNo, groupId);
      }
      await insertParticipantInTx(client, tenantId, newSessionId, groupId, participant);
    }
    await auditInTx(client, tenantId, actorUserId, "board_game.session_open", newSessionId, {
      tableId,
      billingMode: mode,
      guestCount: preparedParticipants.length,
      billingGroupCount: groupIdByNo.size,
      seatingId,
      capacity: seats,
      overCapacity: preparedParticipants.length > seats,
    });
    if (ownsTransaction) await client.query("COMMIT");
    return mapSessionRow(result.rows[0]);
  } catch (error) {
    if (ownsTransaction) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

/**
 * Open a session inside the caller's tenant transaction.
 *
 * Queue seating uses this exact path so "SEATED" and the real timing/billing session either both
 * commit or both disappear.  The caller owns BEGIN/COMMIT/ROLLBACK and must already have applied
 * tenant context with `beginTenantTx()`.
 */
export function openBoardGameSessionInTx(
  client: PoolClient,
  tenantId: string,
  input: Parameters<typeof openBoardGameSession>[1],
  actorUserId?: string | null,
) {
  return openBoardGameSession(tenantId, input, actorUserId, client);
}

export async function addBoardGameParticipant(
  tenantId: string,
  input: BoardGameParticipantInput & {
    sessionId: string;
    idempotencyKey: string;
    allowOverCapacity?: boolean | null;
  },
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
    timeMode: input.timeMode ?? null,
    purchasedDurationMinutes: input.purchasedDurationMinutes ?? null,
    allowOverCapacity: input.allowOverCapacity === true,
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
    const session = await client.query<{
      id: string;
      started_at: Date;
      location_id: string;
      billing_mode: BoardGameBillingMode;
      expected_end_at: Date | null;
      seats: number;
      seating_id: string;
    }>(
      `SELECT s.id, s.started_at, s.location_id, s.billing_mode, s.expected_end_at,
              t.seats, s.seating_id
         FROM bms_board_game_sessions s
         JOIN bms_board_game_seatings st
           ON st.tenant_id = s.tenant_id AND st.id = s.seating_id
         JOIN bms_board_game_tables t
           ON t.tenant_id = st.tenant_id AND t.id = st.table_id
        WHERE s.tenant_id = $1 AND s.id = $2 AND s.status = 'OPEN'
        FOR UPDATE`,
      [tenantId, sessionId]
    );
    if (!session.rowCount) throw new Error("ไม่พบ session ที่เปิดอยู่");
    const sessionRow = session.rows[0];
    // Count only after the shared seating/table rows above are locked. Keeping this in a second
    // statement gives a waiter a fresh READ COMMITTED snapshot after another register commits;
    // a subquery in the locking SELECT could retain the pre-wait count and approve two additions.
    const activeGuests = await client.query<{ active_guests: number }>(
      `SELECT count(*)::int AS active_guests
         FROM bms_board_game_session_participants p
         JOIN bms_board_game_sessions ps
           ON ps.tenant_id = p.tenant_id AND ps.id = p.session_id
         JOIN bms_board_game_billing_groups g
           ON g.tenant_id = p.tenant_id AND g.id = p.billing_group_id
        WHERE p.tenant_id = $1 AND ps.seating_id = $2 AND ps.status = 'OPEN'
          AND p.left_at IS NULL AND g.status = 'OPEN'`,
      [tenantId, sessionRow.seating_id]
    );
    const nextGuestCount = Number(activeGuests.rows[0]?.active_guests ?? 0) + 1;
    if (nextGuestCount > Number(sessionRow.seats) && input.allowOverCapacity !== true) {
      throw new Error(`โต๊ะนี้มี ${sessionRow.seats} ที่นั่ง การเพิ่มคนนี้จะเป็น ${nextGuestCount} คน — กรุณายืนยันการใช้โต๊ะเกินความจุ`);
    }
    const prepared = await prepareParticipantInTx(
      client,
      tenantId,
      { ...input, joinedAt: requestedJoinedAt },
      new Date(),
      {
        defaultMode: sessionRow.billing_mode === "FIXED_DURATION" ? "SESSION_END" : "ACTUAL",
        sessionExpectedEndAt: sessionRow.expected_end_at ? new Date(sessionRow.expected_end_at) : null,
      }
    );
    if (prepared.joinedAt < new Date(session.rows[0].started_at)) throw new Error("เวลาเข้าร่วมต้องไม่ก่อนเวลาเปิดโต๊ะ");
    const billingGroupId = await resolveBillingGroupInTx(
      client, tenantId, session.rows[0].location_id, sessionId, prepared.billingGroupNo
    );
    const result = await insertParticipantInTx(client, tenantId, sessionId, billingGroupId, prepared);
    await refreshSessionFromGroupsInTx(client, tenantId, sessionId);
    const row = result.rows[0];
    const response = {
      id: row.id,
      displayName: row.display_name,
      participantType: row.participant_type,
      billable: Boolean(row.billable),
      hourlyRate: Number(row.hourly_rate_snapshot),
      billingGroupNo: Number(row.billing_group_no),
      billingGroupId: row.billing_group_id as string,
      joinedAt: iso(row.joined_at),
      timeMode: row.time_mode as BoardGameParticipantTimeMode,
      plannedEndAt: iso(row.planned_end_at),
      replayed: false,
    };
    await storeActionResultInTx(client, tenantId, "participant.add", key, hash, response);
    await auditInTx(client, tenantId, actorUserId, "board_game.participant_add", sessionId, {
      participantId: result.rows[0].id,
      participantType: prepared.participantType,
      billable: prepared.billable,
      billingGroupNo: prepared.billingGroupNo,
      timeMode: prepared.timeMode,
      overCapacity: nextGuestCount > Number(sessionRow.seats),
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
    const openSession = await client.query(
      `SELECT id FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'
        FOR UPDATE`,
      [tenantId, sessionId]
    );
    if (!openSession.rowCount) throw new Error("ไม่พบผู้เล่นที่ยังอยู่ใน session นี้");
    const participant = await client.query<{ joined_at: Date }>(
      `SELECT p.joined_at
         FROM bms_board_game_session_participants p
         JOIN bms_board_game_billing_groups g
           ON g.tenant_id = p.tenant_id AND g.id = p.billing_group_id
        WHERE p.tenant_id = $1 AND p.session_id = $2 AND p.id = $3
          AND p.left_at IS NULL AND g.status = 'OPEN'
        FOR UPDATE OF g, p`,
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
    await refreshSessionFromGroupsInTx(client, tenantId, sessionId);
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
    await client.query(
      `UPDATE bms_board_game_session_participants
          SET time_mode = CASE WHEN $3::timestamptz IS NULL THEN 'ACTUAL' ELSE 'SESSION_END' END,
              planned_end_at = $3::timestamptz,
              updated_at = now()
        WHERE tenant_id = $1 AND session_id = $2
          AND time_mode = 'SESSION_END'`,
      [tenantId, sessionId, expectedEndAt]
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

type BoardGameSeatingAction = "move" | "merge";

/**
 * ย้ายตำแหน่งจริงโดยไม่แตะ session/billing group/order (`9.91`)
 *
 * `move` = "ชุดลูกค้าที่เลือกย้ายไปโต๊ะว่าง" · โต๊ะที่มีชุดเดียวย้ายทั้งที่นั่ง (คง id/เวลาเปิดไว้)
 * ส่วนโต๊ะที่ถูกรวมไว้หลายชุดจะ **แยกเฉพาะชุดที่เลือก** ออกไปนั่งเอง ซึ่งเป็นทางกลับของการรวมโต๊ะ
 * `merge` = "ทั้งโต๊ะนี้ไปรวมกับโต๊ะนั้น" ย้าย session ทุกก้อนเข้า seating ปลายทาง
 *
 * ทั้งสองทางไม่แตะ session, กลุ่มบิล, tab หรือ order เลย — บิล เวลา และเกมที่ยืมจึงคง id เดิม
 */
async function relocateBoardGameSeating(
  tenantId: string,
  sessionIdInput: string,
  targetTableIdInput: string,
  input: { idempotencyKey: string; allowOverCapacity?: boolean | null },
  action: BoardGameSeatingAction,
  actorUserId?: string | null
) {
  const sessionId = uuid(sessionIdInput, "sessionId");
  const targetTableId = uuid(targetTableIdInput, "targetTableId");
  const key = requestKey(input.idempotencyKey);
  const actionKey = `seating.${action}`;
  const hash = requestHash({ sessionId, targetTableId, allowOverCapacity: input.allowOverCapacity === true });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const replay = await replayActionInTx<Record<string, unknown>>(
      client, tenantId, actionKey, key, hash
    );
    if (replay) {
      await client.query("COMMIT");
      return { ...replay, replayed: true };
    }

    // One tenant-level floor lock makes opposing A→B / B→A requests deterministic. These are
    // rare human floor actions; serialising them is cheaper and safer than a cross-row deadlock.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`board-game:${tenantId}:seating-floor`]
    );
    const selected = await client.query<{
      seating_id: string; location_id: string; status: string;
    }>(
      `SELECT seating_id, location_id, status
         FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, sessionId]
    );
    if (!selected.rowCount || !["OPEN", "CLOSING"].includes(selected.rows[0].status)) {
      throw new Error("ไม่พบ session ที่ยังอยู่บนโต๊ะ");
    }
    const sourceSeatingId = selected.rows[0].seating_id;
    const locationId = selected.rows[0].location_id;

    const sourcePreview = await client.query<{ table_id: string }>(
      `SELECT table_id FROM bms_board_game_seatings
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3`,
      [tenantId, locationId, sourceSeatingId]
    );
    if (!sourcePreview.rowCount) throw new Error("ไม่พบที่นั่งต้นทาง");
    if (sourcePreview.rows[0].table_id === targetTableId) {
      throw new Error("โต๊ะปลายทางเป็นโต๊ะเดิม");
    }

    // Lock the destination table before discovering its current seating. An opening request also
    // locks this row, so it cannot slip a new occupancy between our check and write.
    const targetTable = await client.query<{ id: string; seats: number }>(
      `SELECT id, seats FROM bms_board_game_tables
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND active AND NOT blocked
        FOR UPDATE`,
      [tenantId, locationId, targetTableId]
    );
    if (!targetTable.rowCount) throw new Error("ไม่พบโต๊ะปลายทางที่เปิดใช้งานในสาขานี้");

    const destination = await client.query<{ id: string }>(
      `SELECT id FROM bms_board_game_seatings
        WHERE tenant_id = $1 AND location_id = $2 AND table_id = $3 AND status = 'ACTIVE'`,
      [tenantId, locationId, targetTableId]
    );
    if (action === "move" && destination.rowCount) {
      throw new Error("โต๊ะปลายทางมีลูกค้าอยู่ — ใช้คำสั่งรวมโต๊ะ");
    }
    if (action === "merge" && !destination.rowCount) {
      throw new Error("โต๊ะปลายทางว่างอยู่ — ใช้คำสั่งย้ายโต๊ะ");
    }
    const destinationSeatingId = destination.rows[0]?.id ?? sourceSeatingId;

    // Match settlement's lock order: sessions first, seating second. Otherwise a payment could
    // hold the session while waiting for the seating as a merge held the seating waiting for it.
    const sessionRows = await client.query<{ id: string; seating_id: string; guest_count: number }>(
      `SELECT id, seating_id, guest_count FROM bms_board_game_sessions
        WHERE tenant_id = $1
          AND seating_id = ANY($2::uuid[])
        ORDER BY id
        FOR UPDATE`,
      [tenantId, [sourceSeatingId, destinationSeatingId]]
    );
    const lockedSeatings = await client.query<{ id: string; table_id: string; status: string }>(
      `SELECT id, table_id, status FROM bms_board_game_seatings
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])
        ORDER BY id
        FOR UPDATE`,
      [tenantId, [sourceSeatingId, destinationSeatingId]]
    );
    const source = lockedSeatings.rows.find((row) => row.id === sourceSeatingId);
    if (!source || source.status !== "ACTIVE") {
      throw new Error("ที่นั่งต้นทางไม่ได้เปิดอยู่แล้ว");
    }
    const fromTableId = source.table_id;
    const lockedDestination = destination.rows[0]
      ? lockedSeatings.rows.find((row) => row.id === destinationSeatingId)
      : null;
    if (action === "merge" && lockedDestination?.status !== "ACTIVE") {
      throw new Error("โต๊ะปลายทางไม่ได้เปิดอยู่แล้ว");
    }
    const sourceSessionIds = sessionRows.rows
      .filter((row) => row.seating_id === sourceSeatingId)
      .map((row) => row.id);
    const movingSessionIds = action === "move" && sourceSessionIds.length > 1
      ? [sessionId]
      : sourceSessionIds;
    const destinationSessionIds = sessionRows.rows
      .filter((row) => row.seating_id === destinationSeatingId)
      .map((row) => row.id);
    const capacitySessions = action === "merge"
      ? [...new Set([...movingSessionIds, ...destinationSessionIds])]
      : movingSessionIds;
    const capacitySessionIds = new Set(capacitySessions);
    const guestCount = sessionRows.rows.reduce(
      (total, row) => total + (capacitySessionIds.has(row.id) ? Number(row.guest_count) : 0),
      0,
    );
    if (guestCount > Number(targetTable.rows[0].seats) && input.allowOverCapacity !== true) {
      throw new Error(`โต๊ะปลายทางมี ${targetTable.rows[0].seats} ที่นั่ง แต่จะมี ${guestCount} คน — กรุณายืนยันการใช้โต๊ะเกินความจุ`);
    }

    let movedSeatingId = destinationSeatingId;
    let movedSessionIds = sourceSessionIds;

    if (action === "move" && sourceSessionIds.length > 1) {
      // ที่นั่งนี้ถูกรวมไว้หลายชุด — ย้ายเฉพาะชุดที่เลือกออกไปนั่งเอง ไม่งั้นการกดย้ายจากการ์ด
      // ของชุดหนึ่งจะลากอีกชุดไปโต๊ะใหม่ด้วยโดยไม่มีอะไรบนจอบอก · นี่คือทางกลับของการรวมโต๊ะ
      // ซึ่งถ้าไม่มี การรวมจะเป็นประตูทางเดียว
      const detached = await client.query<{ id: string }>(
        `INSERT INTO bms_board_game_seatings
            (tenant_id, location_id, table_id, opened_at)
         VALUES ($1,$2,$3, now())
         RETURNING id`,
        // origin_session_id ปล่อยว่างโดยตั้งใจ: session นี้เป็นต้นทางของที่นั่งเดิมไปแล้ว
        // และคอลัมน์นั้น unique ต่อร้าน · ที่นั่งปัจจุบันของทุก session อ่านจาก sessions.seating_id
        [tenantId, locationId, targetTableId]
      );
      movedSeatingId = detached.rows[0].id;
      movedSessionIds = [sessionId];
      await client.query(
        `UPDATE bms_board_game_sessions
            SET seating_id = $3, version = version + 1, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, sessionId, movedSeatingId]
      );
      // ที่นั่งเดิมยังมีชุดอื่นอยู่ จึงยัง ACTIVE — เรียกสูตรกลางแทนการเดา
      await refreshBoardGameSeatingInTx(client, tenantId, sourceSeatingId);
    } else if (action === "move") {
      movedSeatingId = sourceSeatingId;
      await client.query(
        `UPDATE bms_board_game_seatings
            SET table_id = $3, version = version + 1, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, sourceSeatingId, targetTableId]
      );
    } else {
      await client.query(
        `UPDATE bms_board_game_sessions
            SET seating_id = $3, version = version + 1, updated_at = now()
          WHERE tenant_id = $1 AND seating_id = $2`,
        [tenantId, sourceSeatingId, destinationSeatingId]
      );
      await client.query(
        `UPDATE bms_board_game_seatings
            SET status = 'MERGED', closed_at = now(), merged_into_seating_id = $3,
                version = version + 1, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, sourceSeatingId, destinationSeatingId]
      );
      await refreshBoardGameSeatingInTx(client, tenantId, destinationSeatingId);
    }

    const response = {
      action,
      seatingId: movedSeatingId,
      sourceSeatingId,
      fromTableId,
      toTableId: targetTableId,
      sessionIds: movedSessionIds,
      replayed: false,
    };
    await storeActionResultInTx(client, tenantId, actionKey, key, hash, response);
    await auditInTx(
      client,
      tenantId,
      actorUserId,
      action === "move" ? "board_game.seating_move" : "board_game.seating_merge",
      movedSeatingId,
      {
        sourceSeatingId, fromTableId, toTableId: targetTableId, sessionIds: movedSessionIds,
        guestCount, capacity: Number(targetTable.rows[0].seats),
        overCapacity: guestCount > Number(targetTable.rows[0].seats),
      }
    );
    await client.query("COMMIT");
    return response;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export function moveBoardGameSeating(
  tenantId: string,
  sessionId: string,
  targetTableId: string,
  input: { idempotencyKey: string; allowOverCapacity?: boolean | null },
  actorUserId?: string | null
) {
  return relocateBoardGameSeating(
    tenantId, sessionId, targetTableId, input, "move", actorUserId
  );
}

export function mergeBoardGameSeating(
  tenantId: string,
  sessionId: string,
  targetTableId: string,
  input: { idempotencyKey: string; allowOverCapacity?: boolean | null },
  actorUserId?: string | null
) {
  return relocateBoardGameSeating(
    tenantId, sessionId, targetTableId, input, "merge", actorUserId
  );
}

/**
 * แยกหนึ่งกลุ่มบิลออกจาก visit เดิมไปเป็น session ของตัวเองบนโต๊ะว่าง
 * ผู้เล่น เวลา และ tab ตามกลุ่มไป; เกม/บัตรเป็นของ session จึงต้องเลือกอย่างชัดเจน
 */
export async function detachBoardGameBillingGroupToTable(
  tenantId: string,
  input: {
    billingGroupId: string;
    targetTableId: string;
    loanIds?: string[] | null;
    identityHoldIds?: string[] | null;
    allowOverCapacity?: boolean | null;
    idempotencyKey: string;
  },
  actorUserId?: string | null,
) {
  const billingGroupId = uuid(input.billingGroupId, "billingGroupId");
  const targetTableId = uuid(input.targetTableId, "targetTableId");
  const loanIds = [...new Set((input.loanIds ?? []).map((id) => uuid(id, "loanId")))].sort();
  const holdIds = [...new Set((input.identityHoldIds ?? []).map((id) => uuid(id, "identityHoldId")))].sort();
  const key = requestKey(input.idempotencyKey);
  const hash = requestHash({ billingGroupId, targetTableId, loanIds, holdIds, allowOverCapacity: input.allowOverCapacity === true });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const replay = await replayActionInTx<Record<string, unknown>>(
      client, tenantId, "group.detach", key, hash
    );
    if (replay) { await client.query("COMMIT"); return { ...replay, replayed: true }; }
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`board-game:${tenantId}:seating-floor`]
    );
    // Discover without locking, then take the established session -> group order used by close/pay.
    // Group -> session here would deadlock with a cashier closing this group at the same moment.
    const owner = await client.query<{ session_id: string }>(
      `SELECT session_id FROM bms_board_game_billing_groups
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, billingGroupId]
    );
    if (!owner.rowCount) throw new Error("ไม่พบกลุ่มบิลที่ยังเล่นอยู่");
    const source = await client.query<{
      id: string; seating_id: string; started_at: Date; pos_device_id: string | null;
      pos_shift_id: string | null; alert_before_minutes: number;
      billing_mode: BoardGameBillingMode; expected_duration_minutes: number | null;
      expected_end_at: Date | null;
    }>(
      `SELECT id, seating_id, started_at, pos_device_id, pos_shift_id, alert_before_minutes,
              billing_mode, expected_duration_minutes, expected_end_at
         FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'
        FOR UPDATE`,
      [tenantId, owner.rows[0].session_id]
    );
    if (!source.rowCount) throw new Error("ชุดลูกค้าต้นทางไม่ได้เปิดอยู่แล้ว");
    const group = await client.query<{
      id: string; session_id: string; location_id: string; group_no: number; current_order_id: string | null;
    }>(
      `SELECT id, session_id, location_id, group_no, current_order_id
         FROM bms_board_game_billing_groups
        WHERE tenant_id = $1 AND id = $2 AND session_id = $3 AND status = 'OPEN'
        FOR UPDATE`,
      [tenantId, billingGroupId, owner.rows[0].session_id]
    );
    if (!group.rowCount) throw new Error("กลุ่มบิลถูกย้ายหรือปิดไปแล้ว กรุณาโหลดโต๊ะใหม่");
    const groupRow = group.rows[0];
    const otherGroup = await client.query(
      `SELECT 1 FROM bms_board_game_billing_groups
        WHERE tenant_id = $1 AND session_id = $2 AND id <> $3 AND status IN ('OPEN','CLOSING') LIMIT 1`,
      [tenantId, groupRow.session_id, billingGroupId]
    );
    if (!otherGroup.rowCount) throw new Error("กลุ่มนี้เป็นกลุ่มสุดท้ายของโต๊ะ — ใช้คำสั่งย้ายโต๊ะปกติ");
    const target = await client.query<{ seats: number }>(
      `SELECT seats FROM bms_board_game_tables
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND active AND NOT blocked
        FOR UPDATE`,
      [tenantId, groupRow.location_id, targetTableId]
    );
    if (!target.rowCount) throw new Error("ไม่พบโต๊ะปลายทางที่เปิดใช้งานในสาขานี้");
    const occupied = await client.query(
      `SELECT 1 FROM bms_board_game_seatings
        WHERE tenant_id = $1 AND location_id = $2 AND table_id = $3 AND status = 'ACTIVE'`,
      [tenantId, groupRow.location_id, targetTableId]
    );
    if (occupied.rowCount) throw new Error("โต๊ะปลายทางมีลูกค้าอยู่แล้ว");
    const people = await client.query<{ active_count: number }>(
      `SELECT count(*) FILTER (WHERE left_at IS NULL)::int AS active_count
         FROM bms_board_game_session_participants
        WHERE tenant_id = $1 AND billing_group_id = $2`,
      [tenantId, billingGroupId]
    );
    const activeCount = Number(people.rows[0]?.active_count ?? 0);
    if (activeCount < 1) throw new Error("กลุ่มนี้ไม่มีผู้เล่นที่ยังอยู่บนโต๊ะ");
    if (activeCount > Number(target.rows[0].seats) && input.allowOverCapacity !== true) {
      throw new Error(`โต๊ะปลายทางมี ${target.rows[0].seats} ที่นั่ง แต่กลุ่มนี้มี ${activeCount} คน — กรุณายืนยันการใช้โต๊ะเกินความจุ`);
    }
    const validLoans = loanIds.length ? await client.query<{ id: string }>(
      `SELECT id FROM bms_board_game_session_games
        WHERE tenant_id = $1 AND session_id = $2 AND id = ANY($3::uuid[]) AND status = 'CHECKED_OUT'
        FOR UPDATE`,
      [tenantId, groupRow.session_id, loanIds]
    ) : { rows: [], rowCount: 0 } as any;
    if ((validLoans.rowCount ?? 0) !== loanIds.length) throw new Error("มีเกมที่เลือกไม่ได้อยู่กับโต๊ะต้นทางแล้ว");
    const validHolds = holdIds.length ? await client.query<{ id: string; loan_id: string | null }>(
      `SELECT id, loan_id FROM bms_board_game_identity_holds
        WHERE tenant_id = $1 AND session_id = $2 AND id = ANY($3::uuid[]) AND status = 'HELD'
        FOR UPDATE`,
      [tenantId, groupRow.session_id, holdIds]
    ) : { rows: [] as Array<{ id: string; loan_id: string | null }>, rowCount: 0 };
    if ((validHolds.rowCount ?? 0) !== holdIds.length) throw new Error("มีบัตรที่เลือกไม่ได้อยู่กับโต๊ะต้นทางแล้ว");
    const separatedHold = validHolds.rows.find(
      (hold) => hold.loan_id && !loanIds.includes(hold.loan_id)
    );
    if (separatedHold) throw new Error("บัตรที่ผูกกับเกมต้องย้ายพร้อมเกมกล่องนั้น");
    const seating = await client.query<{ id: string }>(
      `INSERT INTO bms_board_game_seatings (tenant_id, location_id, table_id, opened_at)
       VALUES ($1,$2,$3, now()) RETURNING id`,
      [tenantId, groupRow.location_id, targetTableId]
    );
    const sourceRow = source.rows[0];
    const sessionKey = createHash("sha256").update(`${key}:detached-session`).digest("hex");
    const created = await client.query<{ id: string }>(
      `INSERT INTO bms_board_game_sessions
          (tenant_id, location_id, table_id, seating_id, pos_device_id, pos_shift_id,
           billing_mode, guest_count, expected_duration_minutes, started_at, expected_end_at,
           alert_before_minutes, note, opened_by, open_idempotency_key, open_request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [tenantId, groupRow.location_id, targetTableId, seating.rows[0].id,
        sourceRow.pos_device_id, sourceRow.pos_shift_id, sourceRow.billing_mode, activeCount,
        sourceRow.expected_duration_minutes,
        sourceRow.started_at, sourceRow.expected_end_at,
        sourceRow.alert_before_minutes,
        `แยกกลุ่มบิล ${groupRow.group_no} จาก session ${groupRow.session_id}`,
        actorUserId ?? null, sessionKey, hash]
    );
    const newSessionId = created.rows[0].id;
    await client.query(
      `UPDATE bms_board_game_billing_groups SET session_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, billingGroupId, newSessionId]
    );
    await client.query(
      `UPDATE bms_board_game_session_participants SET session_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND billing_group_id = $2`,
      [tenantId, billingGroupId, newSessionId]
    );
    if (groupRow.current_order_id) {
      const movedOrder = await client.query(
        `UPDATE bms_orders SET board_game_session_id = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
        [tenantId, groupRow.current_order_id, newSessionId]
      );
      if (!movedOrder.rowCount) {
        throw new Error("ใบจองของกลุ่มไม่ได้อยู่สถานะรอย้าย — ให้ผู้ดูแลตรวจบิลนี้ก่อน");
      }
    }
    if (loanIds.length) await client.query(
      `UPDATE bms_board_game_session_games SET session_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND session_id = $2 AND id = ANY($4::uuid[])`,
      [tenantId, groupRow.session_id, newSessionId, loanIds]
    );
    const movedHolds = holdIds.length || loanIds.length ? await client.query<{ id: string }>(
      `UPDATE bms_board_game_identity_holds SET session_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND session_id = $2 AND status = 'HELD'
          AND (id = ANY($4::uuid[]) OR loan_id = ANY($5::uuid[]))
        RETURNING id`,
      [tenantId, groupRow.session_id, newSessionId, holdIds, loanIds]
    ) : { rows: [] };
    const movedHoldIds = movedHolds.rows.map((hold) => hold.id).sort();
    await refreshSessionFromGroupsInTx(client, tenantId, groupRow.session_id);
    await refreshSessionFromGroupsInTx(client, tenantId, newSessionId);
    const response = {
      billingGroupId, sourceSessionId: groupRow.session_id, sessionId: newSessionId,
      tableId: targetTableId, seatingId: seating.rows[0].id, activeCount,
      loanIds, identityHoldIds: movedHoldIds, replayed: false,
    };
    await storeActionResultInTx(client, tenantId, "group.detach", key, hash, response);
    await auditInTx(client, tenantId, actorUserId, "board_game.billing_group_detach", billingGroupId, {
      sourceSessionId: groupRow.session_id, sessionId: newSessionId, targetTableId,
      activeCount, loanCount: loanIds.length, identityHoldCount: movedHoldIds.length,
      overCapacity: activeCount > Number(target.rows[0].seats),
    });
    await client.query("COMMIT");
    return response;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function getBoardGameSession(tenantId: string, sessionIdInput: string) {
  const sessionId = uuid(sessionIdInput, "sessionId");
  await requireBoardGameCafeTenant({ query }, tenantId);
  const [session, participants, games, billingGroups, tabItems, identityHolds] = await Promise.all([
    query(
      `SELECT s.id, s.location_id, st.table_id, s.table_id AS origin_table_id,
              origin_table.code AS origin_table_code, origin_table.name AS origin_table_name,
              s.seating_id, s.status, s.billing_mode,
              s.guest_count, s.started_at, s.expected_end_at, s.ended_at, s.alert_before_minutes,
              (SELECT min(p.planned_end_at)
                 FROM bms_board_game_session_participants p
                 JOIN bms_board_game_billing_groups pg
                   ON pg.tenant_id = p.tenant_id AND pg.id = p.billing_group_id
                WHERE p.tenant_id = s.tenant_id AND p.session_id = s.id
                  AND p.left_at IS NULL AND p.planned_end_at IS NOT NULL
                  AND pg.status = 'OPEN') AS next_participant_end_at,
              (SELECT COALESCE(sum(g.amount_due + g.tab_amount), 0)
                 FROM bms_board_game_billing_groups g
                WHERE g.tenant_id = s.tenant_id AND g.session_id = s.id) AS amount_due
         FROM bms_board_game_sessions s
         JOIN bms_board_game_seatings st
           ON st.tenant_id = s.tenant_id AND st.id = s.seating_id
         JOIN bms_board_game_tables origin_table
           ON origin_table.tenant_id = s.tenant_id AND origin_table.id = s.table_id
        WHERE s.tenant_id = $1 AND s.id = $2`,
      [tenantId, sessionId]
    ),
    query(
      `SELECT p.id, p.display_name, p.participant_type, p.billable,
              p.rate_code_snapshot, p.rate_name_snapshot, p.hourly_rate_snapshot,
              p.minimum_minutes_snapshot, p.rounding_minutes_snapshot, p.grace_minutes_snapshot,
              g.group_no AS billing_group_no, p.billing_group_id, g.status AS billing_group_status,
              p.joined_at, p.left_at, p.time_mode, p.planned_end_at
         FROM bms_board_game_session_participants p
         JOIN bms_board_game_billing_groups g
           ON g.tenant_id = p.tenant_id AND g.id = p.billing_group_id
        WHERE p.tenant_id = $1 AND p.session_id = $2
        ORDER BY g.group_no, p.created_at, p.id`,
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
    query<BillingGroupRow>(
      `SELECT ${BILLING_GROUP_COLUMNS}
         FROM bms_board_game_billing_groups
        WHERE tenant_id = $1 AND session_id = $2 AND status <> 'MERGED'
        ORDER BY group_no`,
      [tenantId, sessionId]
    ),
    query<any>(
      `SELECT i.id, i.billing_group_id, i.product_sku, i.product_name, i.size, i.pack_code,
              i.unit_name, i.pack_qty, i.modifier_names, i.note, i.added_at
         FROM bms_board_game_group_items i
         JOIN bms_board_game_billing_groups g
           ON g.tenant_id = i.tenant_id AND g.id = i.billing_group_id
        WHERE i.tenant_id = $1 AND g.session_id = $2 AND i.status = 'ACTIVE'
        ORDER BY g.group_no, i.added_at, i.id`,
      [tenantId, sessionId]
    ),
    // บัตรที่รับไว้ (`9.93`) — **เลขเต็มไม่เคยออกจาก server ทางนี้** มีแต่สี่ตัวท้ายไว้จับคู่
    // กับบัตรในลิ้นชัก · การอ่านเลขกลับออกมาเป็นคำสั่งของตัวเองที่มีสิทธิ์และ audit แยก
    query<any>(
      `SELECT h.id, h.loan_id, h.customer_id, h.document_kind, h.holder_name,
              h.document_number_tail, (h.document_number_encrypted IS NOT NULL) AS has_number,
              h.status, h.note, h.taken_at, h.returned_at
         FROM bms_board_game_identity_holds h
        WHERE h.tenant_id = $1 AND h.session_id = $2
        ORDER BY h.taken_at, h.id`,
      [tenantId, sessionId]
    ),
  ]);
  if (!session.rowCount) throw new Error("ไม่พบ session");
  const row = session.rows[0];
  const groups = billingGroups.rows.map(mapBillingGroupRow);
  const itemsByGroup = new Map<string, BoardGameTabItem[]>();
  for (const row of tabItems.rows as any[]) {
    const list = itemsByGroup.get(row.billing_group_id) ?? [];
    list.push({
      id: row.id,
      sku: row.product_sku,
      productName: row.product_name,
      size: row.size,
      packCode: row.pack_code,
      unitName: row.unit_name,
      packQty: Number(row.pack_qty),
      modifierNames: Array.isArray(row.modifier_names) ? row.modifier_names : [],
      note: row.note,
      addedAt: iso(row.added_at),
    });
    itemsByGroup.set(row.billing_group_id, list);
  }
  return {
    ...mapSessionRow(row),
    locationId: row.location_id,
    tableId: row.table_id,
    // `tableId` คือโต๊ะปัจจุบันจาก seating ส่วนสามช่องนี้คือโต๊ะที่ visit เปิดครั้งแรก
    // ใช้แยกทรัพย์สินของแต่ละชุดบนจอหลังรวมโต๊ะ โดยไม่เขียนทับประวัติ session
    originTableId: row.origin_table_id,
    originTableCode: row.origin_table_code,
    originTableName: row.origin_table_name,
    seatingId: row.seating_id,
    billingGroups: groups.map((group) => ({
      ...group,
      tabItems: itemsByGroup.get(group.id) ?? [],
    })),
    chargeSnapshot: groups.flatMap((group) => group.chargeSnapshot),
    participants: participants.rows.map((participant: any) => ({
      id: participant.id,
      displayName: participant.display_name,
      participantType: participant.participant_type,
      billable: Boolean(participant.billable),
      rateCode: participant.rate_code_snapshot ?? null,
      rateName: participant.rate_name_snapshot ?? null,
      hourlyRate: Number(participant.hourly_rate_snapshot),
      minimumMinutes: Number(participant.minimum_minutes_snapshot),
      roundingMinutes: Number(participant.rounding_minutes_snapshot),
      graceMinutes: Number(participant.grace_minutes_snapshot),
      billingGroupNo: Number(participant.billing_group_no),
      billingGroupId: participant.billing_group_id,
      billingGroupStatus: participant.billing_group_status as BoardGameBillingGroupStatus,
      joinedAt: iso(participant.joined_at),
      leftAt: iso(participant.left_at),
      timeMode: participant.time_mode as BoardGameParticipantTimeMode,
      plannedEndAt: iso(participant.planned_end_at),
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
    identityHolds: identityHolds.rows.map((hold: any) => ({
      id: hold.id,
      loanId: hold.loan_id ?? null,
      customerId: hold.customer_id ?? null,
      documentKind: hold.document_kind,
      holderName: hold.holder_name ?? null,
      documentNumberTail: hold.document_number_tail ?? null,
      hasDocumentNumber: Boolean(hold.has_number),
      status: hold.status as "HELD" | "RETURNED",
      note: hold.note ?? null,
      takenAt: isoRequired(hold.taken_at, "เวลารับบัตร"),
      returnedAt: iso(hold.returned_at),
    })),
  };
}

/**
 * สร้างใบจองของ tab ใหม่จากรายการที่ยังอยู่ (`9.90`)
 *
 * `createOrderInTx` เป็นที่เดียวที่ประกอบบิลบอร์ดเกม — มันอ่านรายการ tab เอง ปล่อยใบจองเก่า
 * ในทรานแซกชันเดียวกัน แล้วจองใหม่ทั้งชุด · ที่นี่จึงเหลือแค่ "เรียกให้ประกอบใหม่ แล้วผูกผลกลับ"
 * รูปเดียวกับที่บิลโต๊ะร้านอาหารสร้างใบจองใหม่ทุกครั้งที่ส่งครัว
 *
 * ไม่มีรายการเหลือ = ปล่อยใบจองแล้วไม่ต้องมีใบใหม่ (ใบจองเปล่าคือบิล ฿0 ที่ไม่มีใครตั้งใจ)
 */
async function rebuildGroupReservationInTx(
  client: PoolClient,
  tenantId: string,
  group: { id: string; locationId: string; version: number },
  actor: { userId: string; deviceId: string; shiftId: string }
): Promise<{ orderId: string | null; tabAmount: number }> {
  const active = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_board_game_group_items
      WHERE tenant_id = $1 AND billing_group_id = $2 AND status = 'ACTIVE'`,
    [tenantId, group.id]
  );
  if (Number(active.rows[0]?.n ?? 0) === 0) {
    const current = await client.query<{ current_order_id: string | null }>(
      `SELECT current_order_id FROM bms_board_game_billing_groups
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, group.id]
    );
    const orderId = current.rows[0]?.current_order_id ?? null;
    if (orderId) {
      const released = await cancelOrderInTx(client, tenantId, orderId);
      if (!released) throw new Error("ใบจองของบิลนี้อยู่สถานะที่ปล่อยคืนไม่ได้ — ให้ผู้ดูแลตรวจบิลนี้ก่อน");
    }
    await client.query(
      `UPDATE bms_board_game_billing_groups
          SET current_order_id = NULL, tab_amount = 0, version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, group.id]
    );
    return { orderId: null, tabAmount: 0 };
  }

  const nextVersion = Number(group.version) + 1;
  const created = await createOrderInTx(client, {
    tenantId,
    channel: "pos",
    items: [],
    locationId: group.locationId,
    posDeviceId: actor.deviceId,
    posShiftId: actor.shiftId,
    cashierUserId: actor.userId,
    editorId: actor.userId,
    // คีย์ต้องต่างทุกรอบ เพราะใบที่ถูกยกเลิกไปแล้วยังถือคีย์เดิมไว้
    idempotencyKey: `boardgame:${group.id}:v${nextVersion}`,
    boardGameBillingGroupId: group.id,
  });
  if (created.status !== "CREATED") {
    throw new Error(
      created.status === "INSUFFICIENT"
        ? `ของไม่พอสำหรับรายการบนบิลนี้ (${created.sku})`
        : `จองของสำหรับบิลนี้ไม่สำเร็จ (${created.status})`
    );
  }
  await client.query(
    `UPDATE bms_board_game_billing_groups
        SET current_order_id = $3, tab_amount = $4, version = $5, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, group.id, created.orderId, created.amountDue, nextVersion]
  );
  return { orderId: created.orderId, tabAmount: created.amountDue };
}

async function lockOpenGroupForTabInTx(
  client: QueryClient,
  tenantId: string,
  billingGroupId: string,
  locationId: string
) {
  const result = await client.query<{
    id: string; location_id: string; version: number; session_id: string; status: string;
  }>(
    `SELECT id, location_id, version, session_id, status
       FROM bms_board_game_billing_groups
      WHERE tenant_id = $1 AND id = $2 AND location_id = $3
      FOR UPDATE`,
    [tenantId, billingGroupId, locationId]
  );
  if (!result.rowCount) throw new Error("ไม่พบบิลบอร์ดเกมในสาขานี้");
  const row = result.rows[0];
  if (row.status !== "OPEN") {
    throw new Error("บิลนี้ปิดไปแล้ว เพิ่มหรือแก้รายการไม่ได้ — เปิดบิลใหม่ให้ลูกค้าแทน");
  }
  return row;
}

export type BoardGameTabItem = {
  id: string;
  sku: string;
  productName: string;
  size: string;
  packCode: string | null;
  unitName: string | null;
  packQty: number;
  modifierNames: string[];
  note: string | null;
  addedAt: string | null;
};

/**
 * สั่งของเข้าบิลระหว่างเล่น (`9.90`)
 *
 * ของออกจากตู้ตอนนี้ เงินเก็บทีหลัง — การจองจึงต้องเกิดทันที ไม่ใช่รอตอนปิดโต๊ะ ไม่งั้น
 * สต็อกผิดอยู่หลายชั่วโมงและอีกโต๊ะจะถูกสัญญาว่ามีกล่องสุดท้ายเหมือนกัน
 */
export async function addBoardGameGroupItem(
  tenantId: string,
  input: {
    billingGroupId: string;
    locationId: string;
    idempotencyKey: string;
    sku: string;
    size?: string | null;
    packCode?: string | null;
    packQty?: number | null;
    modifierCodes?: string[] | null;
    note?: string | null;
    deviceId: string;
    shiftId: string;
  },
  actorUserId: string
) {
  const billingGroupId = uuid(input.billingGroupId, "billingGroupId");
  const locationId = uuid(input.locationId, "locationId");
  const key = requestKey(input.idempotencyKey);
  const packQty = integerInRange(input.packQty ?? 1, "จำนวน", 1, 9999);
  const note = optionalText(input.note, "โน้ต", 300);
  const requestedCodes = Array.from(new Set(
    (input.modifierCodes ?? []).map((code) => String(code).trim().toUpperCase()).filter(Boolean)
  )).sort();
  const hash = requestHash({
    billingGroupId, sku: String(input.sku ?? "").trim(), size: input.size ?? null,
    packCode: input.packCode ?? null, packQty, modifierCodes: requestedCodes, note,
  });

  // ราคา/หน่วยขาย/ตัวเลือก ตัดสินด้วยตัวแกะบาร์โค้ดตัวเดียวกับที่เครื่องขายใช้ — สองตัวแกะ
  // แปลว่าวันหนึ่ง tab กับตะกร้าจะคิดคนละหน่วยขายจากรหัสเดียวกัน
  const hit = await resolvePosScan(tenantId, String(input.sku ?? "").trim(), {
    locationId,
    size: input.size ?? null,
    packCode: input.packCode ?? null,
    surface: "RETAIL_POS",
  });
  if (!hit) throw new Error("ไม่พบสินค้าหรือหน่วยขายนี้ในสาขานี้");
  // เลขเครื่อง (8.3) ถูกตรวจจากตะกร้าที่เครื่องขายเท่านั้น · ของบน tab ไม่ผ่านด่านนั้น
  // จึงห้ามขึ้น tab แทนที่จะปล่อยให้เล็ดลอดไปโดยไม่มีเลขเครื่องบันทึกไว้
  if (hit.serialTracked) {
    throw new Error(`${hit.productName} ต้องบันทึกเลขเครื่องตอนขาย จึงขึ้นบิลโต๊ะไม่ได้ — ขายแยกที่แท็บขาย`);
  }
  const allowed = new Map(hit.modifiers.map((modifier) => [modifier.code, modifier.name]));
  const invalid = requestedCodes.find((code) => !allowed.has(code));
  if (invalid) throw new Error(`ตัวเลือก ${invalid} ไม่ได้เปิดใช้กับสินค้านี้`);

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorUserId });
    await requireBoardGameCafeTenant(client, tenantId);
    const replay = await replayActionInTx<Record<string, unknown>>(
      client, tenantId, "tab.add", key, hash
    );
    if (replay) {
      await client.query("COMMIT");
      return { ...replay, replayed: true };
    }
    const group = await lockOpenGroupForTabInTx(client, tenantId, billingGroupId, locationId);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bms_board_game_group_items
         (tenant_id, billing_group_id, product_sku, product_name, size, pack_code, unit_name,
          pack_qty, base_qty, modifier_codes, modifier_names, note, added_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        tenantId, billingGroupId, hit.sku, hit.productName, hit.size, hit.packCode, hit.unitName,
        packQty, hit.baseQty, requestedCodes,
        requestedCodes.map((code) => allowed.get(code) ?? code), note, actorUserId,
      ]
    );
    const reservation = await rebuildGroupReservationInTx(
      client, tenantId,
      { id: billingGroupId, locationId: group.location_id, version: Number(group.version) },
      { userId: actorUserId, deviceId: uuid(input.deviceId, "deviceId"), shiftId: uuid(input.shiftId, "shiftId") }
    );
    const response = {
      itemId: inserted.rows[0].id,
      billingGroupId,
      sku: hit.sku,
      productName: hit.productName,
      packQty,
      tabAmount: reservation.tabAmount,
      replayed: false,
    };
    await storeActionResultInTx(client, tenantId, "tab.add", key, hash, response);
    await auditInTx(client, tenantId, actorUserId, "board_game.tab_item_add", billingGroupId, {
      itemId: inserted.rows[0].id, sku: hit.sku, size: hit.size,
      packCode: hit.packCode, packQty, modifierCount: requestedCodes.length,
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

/**
 * เอารายการออกจากบิลก่อนเก็บเงิน — เก็บแถวไว้เป็นประวัติ ไม่ลบทิ้ง
 *
 * "เราไม่ได้สั่งอันนี้" คือข้อโต้แย้งที่ตารางนี้มีไว้ตอบ · ลบแถวทิ้งแปลว่าตอบไม่ได้ว่าเคยมีบรรทัดนี้
 */
export async function removeBoardGameGroupItem(
  tenantId: string,
  input: {
    billingGroupId: string;
    locationId: string;
    itemId: string;
    idempotencyKey: string;
    reason?: string | null;
    deviceId: string;
    shiftId: string;
  },
  actorUserId: string
) {
  const billingGroupId = uuid(input.billingGroupId, "billingGroupId");
  const locationId = uuid(input.locationId, "locationId");
  const itemId = uuid(input.itemId, "itemId");
  const key = requestKey(input.idempotencyKey);
  const reason = optionalText(input.reason, "เหตุผล", 300);
  const hash = requestHash({ billingGroupId, itemId, reason });

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorUserId });
    await requireBoardGameCafeTenant(client, tenantId);
    const replay = await replayActionInTx<Record<string, unknown>>(
      client, tenantId, "tab.remove", key, hash
    );
    if (replay) {
      await client.query("COMMIT");
      return { ...replay, replayed: true };
    }
    const group = await lockOpenGroupForTabInTx(client, tenantId, billingGroupId, locationId);
    const removed = await client.query<{ product_sku: string }>(
      `UPDATE bms_board_game_group_items
          SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $4,
              cancel_reason = $5, updated_at = now()
        WHERE tenant_id = $1 AND billing_group_id = $2 AND id = $3 AND status = 'ACTIVE'
        RETURNING product_sku`,
      [tenantId, billingGroupId, itemId, actorUserId, reason]
    );
    if (!removed.rowCount) throw new Error("ไม่พบรายการนี้บนบิล หรือถูกเอาออกไปแล้ว");
    const reservation = await rebuildGroupReservationInTx(
      client, tenantId,
      { id: billingGroupId, locationId: group.location_id, version: Number(group.version) },
      { userId: actorUserId, deviceId: uuid(input.deviceId, "deviceId"), shiftId: uuid(input.shiftId, "shiftId") }
    );
    const response = { itemId, billingGroupId, tabAmount: reservation.tabAmount, replayed: false };
    await storeActionResultInTx(client, tenantId, "tab.remove", key, hash, response);
    await auditInTx(client, tenantId, actorUserId, "board_game.tab_item_remove", billingGroupId, {
      itemId, sku: removed.rows[0].product_sku, reason,
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

/** รวมสองกลุ่มที่ยังเล่นอยู่ให้เป็นบิลเดียวก่อนแช่ยอด */
export async function mergeBoardGameBillingGroups(
  tenantId: string,
  input: {
    sourceBillingGroupId: string;
    targetBillingGroupId: string;
    locationId: string;
    deviceId: string;
    shiftId: string;
    idempotencyKey: string;
  },
  actorUserId: string,
) {
  const sourceId = uuid(input.sourceBillingGroupId, "sourceBillingGroupId");
  const targetId = uuid(input.targetBillingGroupId, "targetBillingGroupId");
  if (sourceId === targetId) throw new Error("กลุ่มต้นทางและปลายทางต้องเป็นคนละกลุ่ม");
  const locationId = uuid(input.locationId, "locationId");
  const deviceId = uuid(input.deviceId, "deviceId");
  const shiftId = uuid(input.shiftId, "shiftId");
  const key = requestKey(input.idempotencyKey);
  const hash = requestHash({ sourceId, targetId, locationId });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorUserId });
    await requireBoardGameCafeTenant(client, tenantId);
    const replay = await replayActionInTx<Record<string, unknown>>(
      client, tenantId, "group.merge", key, hash
    );
    if (replay) { await client.query("COMMIT"); return { ...replay, replayed: true }; }
    const owners = await client.query<{ id: string; session_id: string }>(
      `SELECT id, session_id FROM bms_board_game_billing_groups
        WHERE tenant_id = $1 AND location_id = $2 AND id = ANY($3::uuid[])`,
      [tenantId, locationId, [sourceId, targetId]]
    );
    if (owners.rowCount !== 2) throw new Error("ไม่พบกลุ่มบิลทั้งสองในสาขานี้");
    const sessionIds = [...new Set(owners.rows.map((row) => row.session_id))];
    if (sessionIds.length !== 1) throw new Error("รวมบิลได้เฉพาะกลุ่มในชุดลูกค้าเดียวกัน");
    const lockedSession = await client.query(
      `SELECT id FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND status = 'OPEN'
        FOR UPDATE`,
      [tenantId, locationId, sessionIds[0]]
    );
    if (!lockedSession.rowCount) throw new Error("ชุดลูกค้านี้ไม่ได้เปิดอยู่แล้ว");
    const groups = await client.query<{
      id: string; session_id: string; group_no: number; status: string; version: number; location_id: string;
    }>(
      `SELECT id, session_id, group_no, status, version, location_id
         FROM bms_board_game_billing_groups
        WHERE tenant_id = $1 AND location_id = $2 AND id = ANY($3::uuid[])
        ORDER BY id FOR UPDATE`,
      [tenantId, locationId, [sourceId, targetId]]
    );
    if (groups.rowCount !== 2) throw new Error("กลุ่มบิลถูกย้ายหรือปิดไปแล้ว กรุณาโหลดโต๊ะใหม่");
    const source = groups.rows.find((row) => row.id === sourceId)!;
    const target = groups.rows.find((row) => row.id === targetId)!;
    if (source.session_id !== target.session_id) throw new Error("รวมบิลได้เฉพาะกลุ่มในชุดลูกค้าเดียวกัน");
    if (source.status !== "OPEN" || target.status !== "OPEN") {
      throw new Error("รวมได้เฉพาะกลุ่มที่ยังเล่นอยู่และยังไม่ได้ปิดยอด");
    }
    // Tab add/remove already locks group -> shift while rebuilding its reservation. Keep the same
    // order here; taking shift first would deadlock with a simultaneous tab edit holding a group.
    const shift = await client.query(
      `SELECT 1 FROM bms_pos_shifts
        WHERE tenant_id = $1 AND location_id = $2 AND device_id = $3 AND id = $4 AND status = 'OPEN'
        FOR KEY SHARE`,
      [tenantId, locationId, deviceId, shiftId]
    );
    if (!shift.rowCount) throw new Error("ต้องเปิดกะของเครื่องนี้ก่อนรวมบิล");
    await client.query(
      `UPDATE bms_board_game_group_items
          SET billing_group_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND billing_group_id = $2 AND status = 'ACTIVE'`,
      [tenantId, sourceId, targetId]
    );
    await client.query(
      `UPDATE bms_board_game_session_participants
          SET billing_group_id = $3, billing_group_no = $4, updated_at = now()
        WHERE tenant_id = $1 AND billing_group_id = $2`,
      [tenantId, sourceId, targetId, target.group_no]
    );
    await rebuildGroupReservationInTx(
      client, tenantId,
      { id: sourceId, locationId, version: Number(source.version) },
      { userId: actorUserId, deviceId, shiftId }
    );
    const rebuilt = await rebuildGroupReservationInTx(
      client, tenantId,
      { id: targetId, locationId, version: Number(target.version) },
      { userId: actorUserId, deviceId, shiftId }
    );
    await client.query(
      `UPDATE bms_board_game_billing_groups
          SET status = 'MERGED', merged_into_group_id = $3, ended_at = now(), closed_by = $4,
              version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'`,
      [tenantId, sourceId, targetId, actorUserId]
    );
    await refreshSessionFromGroupsInTx(client, tenantId, source.session_id);
    const response = {
      sourceBillingGroupId: sourceId,
      targetBillingGroupId: targetId,
      sessionId: source.session_id,
      tabAmount: rebuilt.tabAmount,
      replayed: false,
    };
    await storeActionResultInTx(client, tenantId, "group.merge", key, hash, response);
    await auditInTx(client, tenantId, actorUserId, "board_game.billing_group_merge", targetId, {
      sourceBillingGroupId: sourceId,
    });
    await client.query("COMMIT");
    return response;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

/**
 * บิลเวลาเล่นที่รอเก็บเงิน — คีย์ด้วย **กลุ่มบิล** ไม่ใช่โต๊ะ (`9.89`)
 *
 * โต๊ะที่แยกกลุ่มไว้มีบิลรออยู่หลายใบพร้อมกัน การอ้างด้วย session จึงตอบไม่ได้ว่าหมายถึงใบไหน
 */
export async function getBoardGameCheckoutForPos(
  tenantId: string,
  locationIdInput: string,
  billingGroupIdInput: string
) {
  const locationId = uuid(locationIdInput, "locationId");
  const billingGroupId = uuid(billingGroupIdInput, "billingGroupId");
  await requireBoardGameCafeTenant({ query }, tenantId);
  const result = await query(
    `SELECT g.id, g.status, g.group_no, g.ended_at, g.amount_due, g.tab_amount, g.session_id,
            g.current_order_id, g.charge_snapshot,
            jsonb_array_length(g.charge_snapshot) AS charge_line_count,
            -- 9.92: snapshot ก่อนหน้านั้นไม่มีคีย์นี้ · sum ข้าม NULL ให้เอง จึงได้ 0 ตามจริง
            (SELECT COALESCE(sum((line->>'coveredAmount')::numeric), 0)
               FROM jsonb_array_elements(g.charge_snapshot) line) AS pass_covered_amount,
            -- 10.3: หนึ่งกลุ่มใช้ข้อเสนอได้หนึ่งรายการ จึงสรุปชื่อ/รหัสครั้งเดียว แต่รวมยอดลดจากทุกคน
            (SELECT max(NULLIF(line->>'offerCode', ''))
               FROM jsonb_array_elements(g.charge_snapshot) line) AS offer_code,
            (SELECT max(NULLIF(line->>'offerName', ''))
               FROM jsonb_array_elements(g.charge_snapshot) line) AS offer_name,
            (SELECT COALESCE(sum((line->>'offerDiscountAmount')::numeric), 0)
               FROM jsonb_array_elements(g.charge_snapshot) line) AS offer_discount_amount,
            s.billing_mode, s.started_at, s.expected_end_at,
            t.code AS table_code, t.name AS table_name,
            (SELECT count(*) FROM bms_board_game_group_items i
              WHERE i.tenant_id = g.tenant_id AND i.billing_group_id = g.id
                AND i.status = 'ACTIVE') AS tab_item_count,
            (SELECT count(*)
               FROM bms_board_game_sessions os
               JOIN bms_board_game_billing_groups og
                 ON og.tenant_id = os.tenant_id AND og.session_id = os.id
              WHERE os.tenant_id = s.tenant_id AND os.seating_id = s.seating_id
                AND og.status NOT IN ('CANCELLED', 'MERGED')) AS session_group_count
       FROM bms_board_game_billing_groups g
       JOIN bms_board_game_sessions s
         ON s.tenant_id = g.tenant_id AND s.id = g.session_id
       JOIN bms_board_game_seatings st
         ON st.tenant_id = s.tenant_id AND st.id = s.seating_id
       JOIN bms_board_game_tables t
         ON t.tenant_id = st.tenant_id AND t.id = st.table_id
      WHERE g.tenant_id = $1 AND g.location_id = $2 AND g.id = $3
        AND g.status = 'CLOSING'`,
    [tenantId, locationId, billingGroupId]
  );
  if (!result.rowCount) throw new Error("ไม่พบบิลเวลาเล่นที่รอชำระในสาขานี้");
  const row = result.rows[0];

  // charge_snapshot รุ่นก่อน 10.6 ยังไม่มีเวลาเข้า/ออกและชื่อเรท แต่ participant ของกลุ่ม
  // ยังเป็นหลักฐานเดิมอยู่ จึงเติมเฉพาะ field ที่ขาดเพื่อให้บิลเก่าเปิดดูได้ โดยไม่คำนวณยอดใหม่
  // และไม่แตะ amount/billableMinutes ที่แช่ไว้แล้วเด็ดขาด
  const participantEvidence = await query<any>(
    `SELECT id, rate_code_snapshot, rate_name_snapshot, joined_at, left_at
       FROM bms_board_game_session_participants
      WHERE tenant_id = $1 AND billing_group_id = $2`,
    [tenantId, billingGroupId]
  );
  const evidenceByParticipant = new Map(participantEvidence.rows.map((participant: any) => (
    [participant.id, participant] as const
  )));
  const chargeLines: BoardGameChargeLine[] = (Array.isArray(row.charge_snapshot)
    ? row.charge_snapshot : []).map((raw: any) => {
    const evidence = evidenceByParticipant.get(raw.participantId);
    const joinedAt = raw.joinedAt ?? iso(evidence?.joined_at) ?? null;
    const actualEndedAt = raw.actualEndedAt ?? iso(evidence?.left_at ?? row.ended_at) ?? null;
    const expectedEndAt = iso(row.expected_end_at);
    const chargedUntil = raw.chargedUntil ?? (
      row.billing_mode === "FIXED_DURATION"
      && expectedEndAt
      && actualEndedAt
      && new Date(expectedEndAt).getTime() > new Date(actualEndedAt).getTime()
        ? expectedEndAt
        : actualEndedAt
    );
    return {
      ...raw,
      participantId: String(raw.participantId),
      displayName: raw.displayName ?? null,
      participantType: raw.participantType as BoardGameParticipantType,
      billingGroupNo: Number(raw.billingGroupNo),
      rateCode: raw.rateCode ?? evidence?.rate_code_snapshot ?? null,
      rateName: raw.rateName ?? evidence?.rate_name_snapshot ?? null,
      joinedAt,
      actualEndedAt,
      chargedUntil,
      actualMinutes: raw.actualMinutes == null && joinedAt && actualEndedAt
        ? boardGameActualMinutes(joinedAt, actualEndedAt)
        : Number(raw.actualMinutes ?? 0),
      billableMinutes: Number(raw.billableMinutes),
      hourlyRate: Number(raw.hourlyRate),
      amount: Number(raw.amount),
      grossAmount: raw.grossAmount == null ? undefined : Number(raw.grossAmount),
      coveredMinutes: raw.coveredMinutes == null ? undefined : Number(raw.coveredMinutes),
      coveredAmount: raw.coveredAmount == null ? undefined : Number(raw.coveredAmount),
      offerDiscountAmount: raw.offerDiscountAmount == null
        ? undefined : Number(raw.offerDiscountAmount),
    };
  });

  // ราคาสินค้าต้องมาจาก order snapshot ที่จองสต็อกให้ tab นี้แล้ว ไม่อ่านราคาปัจจุบันจาก
  // catalog เพราะการเปลี่ยนราคากลางคันต้องไม่เปลี่ยนคำอธิบายบิลที่ลูกค้ากำลังจะจ่าย
  // receipt_unit_price คือราคาที่แสดงบนใบเสร็จก่อนส่วนลดสินค้า ส่วนต่างจาก tab_amount
  // ส่งแยกเป็น tabPricingDiscountAmount ด้านล่าง เพื่อให้รายการ + ส่วนลด = ยอดที่เก็บจริง
  // โดยไม่แต่งราคาสุทธิต่อชิ้นขึ้นเอง (โปรบางชนิดจัดสรรต่อชิ้นไม่ได้อย่างซื่อตรง)
  const tabItems = row.current_order_id ? await query<any>(
    `SELECT oi.id::text AS id, oi.product_sku, oi.product_name, oi.size,
            oi.pack_code, oi.pack_unit_name,
            COALESCE(oi.pack_qty, oi.qty)::int AS quantity,
            oi.receipt_unit_price AS unit_price,
            round(oi.receipt_unit_price * COALESCE(oi.pack_qty, oi.qty), 2) AS amount
       FROM bms_order_items oi
      WHERE oi.tenant_id = $1 AND oi.order_id = $2
      ORDER BY oi.id`,
    [tenantId, row.current_order_id]
  ) : { rows: [] as any[] };
  const checkoutItems = tabItems.rows.map((item: any) => ({
    id: item.id,
    sku: item.product_sku,
    productName: item.product_name,
    size: item.size,
    packCode: item.pack_code ?? null,
    unitName: item.pack_unit_name ?? null,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unit_price),
    amount: Number(item.amount),
  }));
  const tabGrossAmount = money(checkoutItems.reduce((sum, item) => sum + item.amount, 0));
  const tabPricingDiscountAmount = money(Math.max(0, tabGrossAmount - Number(row.tab_amount)));
  return {
    id: row.id,
    sessionId: row.session_id,
    groupNo: Number(row.group_no),
    sessionGroupCount: Number(row.session_group_count),
    tableCode: row.table_code,
    tableName: row.table_name,
    billingMode: row.billing_mode,
    startedAt: iso(row.started_at),
    endedAt: iso(row.ended_at),
    // ค่าเล่นกับของที่สั่งระหว่างเล่นเป็นคนละก้อน · เครื่องขายต้องเห็นทั้งสองแยกกัน
    // ไม่งั้นแคชเชียร์อธิบายยอดรวมให้ลูกค้าไม่ได้ว่ามาจากอะไรบ้าง
    amountDue: Number(row.amount_due),
    tabAmount: Number(row.tab_amount),
    tabPricingDiscountAmount,
    totalDue: money(Number(row.amount_due) + Number(row.tab_amount)),
    tabItemCount: Number(row.tab_item_count),
    tabItems: checkoutItems,
    chargeLineCount: chargeLines.length,
    chargeLines,
    // ยอดที่แพ็กเกจสมาชิกจ่ายแทนไปแล้ว — แคชเชียร์ต้องอธิบายได้ว่าทำไมค่าเล่นถึงถูกกว่าที่ลูกค้าคิด
    passCoveredAmount: money(Number(row.pass_covered_amount ?? 0)),
    // แสดงเฉพาะข้อเสนอที่ชนะและถูกแช่ไว้ตอนปิดบิล ไม่ส่งรายการกติกาทั้งหมดไปทำให้จอขายรก
    offerCode: row.offer_code ?? null,
    offerName: row.offer_name ?? null,
    offerDiscountAmount: money(Number(row.offer_discount_amount ?? 0)),
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
    bookingEnabled: Boolean(row.booking_enabled),
    reservationReminderMinutes: Number(row.reservation_reminder_minutes ?? 180),
    timezone: row.timezone || "Asia/Bangkok",
    reservationMinAdvanceMinutes: Number(row.reservation_min_advance_minutes ?? 120),
    reservationRequestTtlMinutes: Number(row.reservation_request_ttl_minutes ?? 1440),
    reservationDepositPolicy: row.reservation_deposit_policy ?? "NONE",
    reservationDepositAmount: Number(row.reservation_deposit_amount ?? 0),
    reservationDepositPercent: Number(row.reservation_deposit_percent ?? 0),
    reservationDepositPaymentWindowMinutes: Number(
      row.reservation_deposit_payment_window_minutes ?? 60,
    ),
    reservationDepositRefundCutoffHours: Number(
      row.reservation_deposit_refund_cutoff_hours ?? 24,
    ),
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
            profile.publish_rates, profile.publish_availability, profile.booking_enabled,
            profile.reservation_reminder_minutes,
            profile.reservation_min_advance_minutes, profile.reservation_request_ttl_minutes,
            profile.reservation_deposit_policy, profile.reservation_deposit_amount,
            profile.reservation_deposit_percent, profile.reservation_deposit_payment_window_minutes,
            profile.reservation_deposit_refund_cutoff_hours,
            COALESCE(NULLIF(store.timezone, ''), 'Asia/Bangkok') AS timezone
       FROM bms_locations l
       JOIN bms_store_profile store ON store.tenant_id = l.tenant_id
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
    bookingEnabled?: boolean | null;
    reservationReminderMinutes?: number | string | null;
    reservationMinAdvanceMinutes?: number | string | null;
    reservationRequestTtlMinutes?: number | string | null;
    reservationDepositPolicy?: string | null;
    reservationDepositAmount?: number | string | null;
    reservationDepositPercent?: number | string | null;
    reservationDepositPaymentWindowMinutes?: number | string | null;
    reservationDepositRefundCutoffHours?: number | string | null;
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
  const bookingEnabled = booleanOrDefault(input.bookingEnabled, false, "สถานะรับจองออนไลน์");
  const reservationReminderMinutes = Number(input.reservationReminderMinutes ?? 180);
  if (!Number.isInteger(reservationReminderMinutes)
    || reservationReminderMinutes < 30 || reservationReminderMinutes > 10080) {
    throw new Error("เวลาแจ้งเตือนต้องอยู่ระหว่าง 30 ถึง 10080 นาที");
  }
  const reservationMinAdvanceMinutes = Number(input.reservationMinAdvanceMinutes ?? 120);
  const reservationRequestTtlMinutes = Number(input.reservationRequestTtlMinutes ?? 1440);
  const reservationDepositPolicy = String(input.reservationDepositPolicy ?? "NONE").toUpperCase();
  const reservationDepositAmount = Number(input.reservationDepositAmount ?? 0);
  const reservationDepositPercent = Number(input.reservationDepositPercent ?? 0);
  const reservationDepositPaymentWindowMinutes = Number(
    input.reservationDepositPaymentWindowMinutes ?? 60,
  );
  const reservationDepositRefundCutoffHours = Number(
    input.reservationDepositRefundCutoffHours ?? 24,
  );
  if (!Number.isInteger(reservationMinAdvanceMinutes)
    || reservationMinAdvanceMinutes < 30 || reservationMinAdvanceMinutes > 43200) {
    throw new Error("เวลาจองล่วงหน้าต้องอยู่ระหว่าง 30 ถึง 43200 นาที");
  }
  if (!Number.isInteger(reservationRequestTtlMinutes)
    || reservationRequestTtlMinutes < 30 || reservationRequestTtlMinutes > 10080) {
    throw new Error("อายุคำขอจองต้องอยู่ระหว่าง 30 ถึง 10080 นาที");
  }
  if (!["NONE", "FIXED", "PERCENT"].includes(reservationDepositPolicy)) {
    throw new Error("นโยบายมัดจำไม่ถูกต้อง");
  }
  if (!Number.isFinite(reservationDepositAmount) || reservationDepositAmount < 0
    || reservationDepositAmount > 1_000_000) throw new Error("ยอดมัดจำคงที่ไม่ถูกต้อง");
  if (!Number.isFinite(reservationDepositPercent) || reservationDepositPercent < 0
    || reservationDepositPercent > 100) throw new Error("เปอร์เซ็นต์มัดจำไม่ถูกต้อง");
  if (reservationDepositPolicy === "FIXED" && reservationDepositAmount <= 0) {
    throw new Error("นโยบายมัดจำคงที่ต้องมียอดมากกว่า 0");
  }
  if (reservationDepositPolicy === "PERCENT" && reservationDepositPercent <= 0) {
    throw new Error("นโยบายมัดจำเปอร์เซ็นต์ต้องมากกว่า 0");
  }
  if (!Number.isInteger(reservationDepositPaymentWindowMinutes)
    || reservationDepositPaymentWindowMinutes < 15
    || reservationDepositPaymentWindowMinutes > 1440) {
    throw new Error("เวลารอชำระมัดจำต้องอยู่ระหว่าง 15 ถึง 1440 นาที");
  }
  if (!Number.isInteger(reservationDepositRefundCutoffHours)
    || reservationDepositRefundCutoffHours < 0
    || reservationDepositRefundCutoffHours > 168) {
    throw new Error("ระยะเวลาคืนมัดจำต้องอยู่ระหว่าง 0 ถึง 168 ชั่วโมง");
  }
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
           publish_rates, publish_availability, booking_enabled, reservation_reminder_minutes,
           reservation_min_advance_minutes, reservation_request_ttl_minutes,
           reservation_deposit_policy, reservation_deposit_amount, reservation_deposit_percent,
           reservation_deposit_payment_window_minutes, reservation_deposit_refund_cutoff_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
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
          booking_enabled = EXCLUDED.booking_enabled,
          reservation_reminder_minutes = EXCLUDED.reservation_reminder_minutes,
          reservation_min_advance_minutes = EXCLUDED.reservation_min_advance_minutes,
          reservation_request_ttl_minutes = EXCLUDED.reservation_request_ttl_minutes,
          reservation_deposit_policy = EXCLUDED.reservation_deposit_policy,
          reservation_deposit_amount = EXCLUDED.reservation_deposit_amount,
          reservation_deposit_percent = EXCLUDED.reservation_deposit_percent,
          reservation_deposit_payment_window_minutes = EXCLUDED.reservation_deposit_payment_window_minutes,
          reservation_deposit_refund_cutoff_hours = EXCLUDED.reservation_deposit_refund_cutoff_hours,
          updated_at = now()`,
      [
        tenantId, locationId, publicVisible, displayName, summary, publicAddress,
        publicPhone, openingHours, latitude, longitude, publishRates, publishAvailability,
        bookingEnabled, reservationReminderMinutes, reservationMinAdvanceMinutes,
        reservationRequestTtlMinutes, reservationDepositPolicy, reservationDepositAmount,
        reservationDepositPercent, reservationDepositPaymentWindowMinutes,
        reservationDepositRefundCutoffHours,
      ]
    );
    await auditInTx(client, tenantId, actorUserId, "board_game.public_profile_upsert", locationId, {
      publicVisible,
      publishRates,
      publishAvailability,
      bookingEnabled,
      reservationReminderMinutes,
      reservationMinAdvanceMinutes,
      reservationRequestTtlMinutes,
      reservationDepositPolicy,
      reservationDepositAmount,
      reservationDepositPercent,
      reservationDepositPaymentWindowMinutes,
      reservationDepositRefundCutoffHours,
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
            profile.publish_rates, profile.publish_availability, profile.booking_enabled,
            profile.reservation_reminder_minutes,
            profile.reservation_min_advance_minutes, profile.reservation_request_ttl_minutes,
            profile.reservation_deposit_policy, profile.reservation_deposit_amount,
            profile.reservation_deposit_percent, profile.reservation_deposit_payment_window_minutes,
            profile.reservation_deposit_refund_cutoff_hours,
            location.name AS location_name, tenant.slug AS tenant_slug,
            tenant.name AS shop_name, store.logo_url,
            COALESCE(NULLIF(store.timezone, ''), 'Asia/Bangkok') AS timezone,
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
                   SELECT 1 FROM bms_board_game_seatings seating
                    WHERE seating.tenant_id = table_row.tenant_id
                      AND seating.table_id = table_row.id
                      AND seating.status = 'ACTIVE'
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

/**
 * ค่าเล่นของ "กลุ่มบิลหนึ่งกลุ่ม" ณ เวลาที่ปิด
 *
 * ⚠️ หมายเลขกลุ่มบนบรรทัดค่าเล่นอ่านจาก `g.group_no` ไม่ใช่ `p.billing_group_no` — คอลัมน์บน
 * ผู้เล่นเป็นสำเนาไว้แสดงผลเท่านั้น (`9.89`) ถ้าอ่านจากสำเนา วันที่สองค่าไม่ตรงกันบิลจะถูก
 * แบ่งตามค่าที่ไม่มีใครตั้ง
 */
// =============================================================
// แพ็กเกจสมาชิก (`9.92`) — เวลาที่สมาชิกจ่ายไว้ล่วงหน้า
// -------------------------------------------------------------
// แพ็กเกจไม่ใช่สินค้า (ไม่มี SKU ไม่ตัดสต็อก) เหมือนค่าเวลาเล่นเอง · การออกแพ็กเกจจึงเป็น
// คำสั่งที่มีสิทธิ์ของตัวเองแบบเดียวกับการออกบัตรของขวัญ (`8.9`) ไม่ใช่บรรทัดในตะกร้า
//
// ⚠️ การ **หักนาที** เกิดตอนปิดบิลของกลุ่มเท่านั้น ไม่ใช่ตอนพรีวิว — ตอนปิดคือจังหวะเดียวที่
// กลุ่มอ้างสิทธิ์เก็บเงินแบบผูกขาด (แช่ snapshot + คีย์ปิดบิล) · หักตอนพรีวิวเมื่อไร สองโต๊ะ
// ที่เปิดพร้อมกันจะกินโควตาใบเดียวกันสองรอบโดยไม่มีใครจ่ายเงินสักโต๊ะ
// =============================================================

export type BoardGamePassPlan = {
  id: string;
  locationId: string | null;
  code: string;
  name: string;
  kind: BoardGamePassKind;
  price: number;
  durationDays: number;
  includedMinutes: number | null;
  active: boolean;
  sortOrder: number;
  note: string | null;
};

export type BoardGameMemberPass = {
  id: string;
  locationId: string | null;
  customerId: string;
  customerName: string | null;
  planId: string | null;
  planCode: string;
  planName: string;
  kind: BoardGamePassKind;
  includedMinutes: number | null;
  remainingMinutes: number | null;
  pricePaid: number;
  startsAt: string;
  expiresAt: string;
  status: "ACTIVE" | "EXPIRED" | "CANCELLED";
  orderId: string | null;
  cancelReason: string | null;
  note: string | null;
};

const PASS_KINDS = new Set<BoardGamePassKind>(["UNLIMITED", "MINUTES"]);

function passKind(value: unknown): BoardGamePassKind {
  const kind = String(value ?? "").toUpperCase() as BoardGamePassKind;
  if (!PASS_KINDS.has(kind)) throw new Error("ชนิดแพ็กเกจต้องเป็น UNLIMITED หรือ MINUTES");
  return kind;
}

function mapPassPlan(row: any): BoardGamePassPlan {
  return {
    id: row.id,
    locationId: row.location_id ?? null,
    code: row.code,
    name: row.name,
    kind: row.kind,
    price: Number(row.price),
    durationDays: Number(row.duration_days),
    includedMinutes: row.included_minutes == null ? null : Number(row.included_minutes),
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
    note: row.note ?? null,
  };
}

function mapMemberPass(row: any): BoardGameMemberPass {
  const expiresAt = isoRequired(row.expires_at, "วันหมดอายุแพ็กเกจ");
  // Coverage and activeOnly already use expires_at as authority. Return the same truth to the UI
  // even before a maintenance job materialises EXPIRED on the row; showing ACTIVE here invited a
  // counter operator to promise a benefit the closing transaction would correctly refuse.
  const status = row.status === "ACTIVE" && new Date(expiresAt).getTime() <= Date.now()
    ? "EXPIRED"
    : row.status;
  return {
    id: row.id,
    locationId: row.location_id ?? null,
    customerId: row.customer_id,
    customerName: row.customer_name ?? null,
    planId: row.plan_id ?? null,
    planCode: row.plan_code,
    planName: row.plan_name,
    kind: row.kind,
    includedMinutes: row.included_minutes == null ? null : Number(row.included_minutes),
    remainingMinutes: row.remaining_minutes == null ? null : Number(row.remaining_minutes),
    pricePaid: Number(row.price_paid),
    startsAt: isoRequired(row.starts_at, "วันเริ่มใช้แพ็กเกจ"),
    expiresAt,
    status,
    orderId: row.order_id ?? null,
    cancelReason: row.cancel_reason ?? null,
    note: row.note ?? null,
  };
}

/**
 * แคตตาล็อกแพ็กเกจ · `visibleLocationIds` = สาขาที่ผู้เรียกดูแลอยู่จริง
 *
 * แพ็กเกจของสาขา (`location_id` มีค่า) ต้องไม่โผล่ให้คนที่ไม่ได้ดูแลสาขานั้นเห็น ไม่งั้นเขาจะ
 * เลือกมันไปขายได้ · แพ็กเกจระดับร้าน (`NULL`) เห็นได้ทุกคนตามนิยามของมันเอง ·
 * ไม่ส่งลิสต์มา = ไม่กรอง (ใช้กับเส้นทางภายในและเทสที่ขอบเขตถูกตัดสินมาก่อนแล้ว)
 */
export async function listBoardGamePassPlans(
  tenantId: string,
  visibleLocationIds?: string[] | null
): Promise<BoardGamePassPlan[]> {
  await requireBoardGameCafeTenant({ query }, tenantId);
  const scope = Array.isArray(visibleLocationIds)
    ? visibleLocationIds.map((id) => uuid(id, "locationId"))
    : null;
  const result = await query(
    `SELECT id, location_id, code, name, kind, price, duration_days, included_minutes,
            active, sort_order, note
       FROM bms_board_game_pass_plans
      WHERE tenant_id = $1
        AND ($2::uuid[] IS NULL OR location_id IS NULL OR location_id = ANY($2::uuid[]))
      ORDER BY active DESC, sort_order, name`,
    [tenantId, scope]
  );
  return result.rows.map(mapPassPlan);
}

export async function upsertBoardGamePassPlan(
  tenantId: string,
  input: {
    id?: string | null;
    locationId?: string | null;
    code?: string | null;
    name: string;
    kind: string;
    price: number;
    durationDays: number;
    includedMinutes?: number | null;
    active?: boolean | null;
    sortOrder?: number | null;
    note?: string | null;
  },
  actorUserId?: string | null
): Promise<BoardGamePassPlan> {
  const id = input.id ? uuid(input.id, "id") : null;
  const locationId = input.locationId ? uuid(input.locationId, "locationId") : null;
  const name = requiredText(input.name, "ชื่อแพ็กเกจ", 120);
  const code = normalizeCode(input.code || name);
  if (!code) throw new Error("ต้องระบุรหัสแพ็กเกจ");
  const kind = passKind(input.kind);
  const price = nonNegativeMoney(input.price, "ราคาแพ็กเกจ");
  const durationDays = integerInRange(input.durationDays, "จำนวนวันที่ใช้ได้", 1, 3650);
  // แพ็กเกจแบบโควตาต้องบอกจำนวนนาที ส่วนแบบไม่อั้นห้ามมี — ปล่อยให้กรอกทั้งคู่แปลว่า
  // วันหนึ่งจะมีแพ็กเกจ "ไม่อั้นแต่มี 600 นาที" ที่ไม่มีใครตอบได้ว่าหมายความว่าอะไร
  const includedMinutes = kind === "MINUTES"
    ? integerInRange(input.includedMinutes, "จำนวนนาทีในแพ็กเกจ", 1, 1_000_000)
    : null;
  const sortOrder = integerInRange(input.sortOrder ?? 0, "ลำดับ", -100000, 100000);
  const active = booleanOrDefault(input.active, true, "สถานะแพ็กเกจ");
  const note = optionalText(input.note, "หมายเหตุ", 500);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const result = await client.query(
      id
        ? `UPDATE bms_board_game_pass_plans
              SET location_id = $3, code = $4, name = $5, kind = $6, price = $7,
                  duration_days = $8, included_minutes = $9, active = $10, sort_order = $11,
                  note = $12, version = version + 1, updated_at = now()
            WHERE tenant_id = $1 AND id = $2
            RETURNING id, location_id, code, name, kind, price, duration_days,
                      included_minutes, active, sort_order, note`
        : `INSERT INTO bms_board_game_pass_plans
              (tenant_id, location_id, code, name, kind, price, duration_days,
               included_minutes, active, sort_order, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING id, location_id, code, name, kind, price, duration_days,
                     included_minutes, active, sort_order, note`,
      id
        ? [tenantId, id, locationId, code, name, kind, price, durationDays,
           includedMinutes, active, sortOrder, note]
        : [tenantId, locationId, code, name, kind, price, durationDays,
           includedMinutes, active, sortOrder, note]
    );
    if (!result.rowCount) throw new Error("ไม่พบแพ็กเกจที่ต้องการแก้ไข");
    await auditInTx(client, tenantId, actorUserId, "board_game.pass_plan_upsert", result.rows[0].id, {
      code, kind, price, durationDays, includedMinutes, active,
    });
    await client.query("COMMIT");
    return mapPassPlan(result.rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

const MEMBER_PASS_COLUMNS = `p.id, p.location_id, p.customer_id, p.plan_id, p.plan_code, p.plan_name, p.kind,
  p.included_minutes, p.remaining_minutes, p.price_paid, p.starts_at, p.expires_at,
  p.status, p.order_id, p.cancel_reason, p.note`;

/**
 * ยอดคงค้างของแพ็กเกจ + ตัวจับ drift ของยอดที่แคชไว้ (`9.92`)
 *
 * `9.92` ประกาศไว้ที่ migration เองว่า "ยอดนาทีเป็น cache ของ ledger — ตัวนับที่บางเส้นทางลืม
 * อัปเดตจะเพี้ยนเงียบ ๆ แล้วไม่มีใครรู้ว่าเริ่มเมื่อไร" แต่ไม่มีอะไรทำให้ข้อนั้น *ตรวจได้จริง* ·
 * แต้ม (`7.96`) และเครดิตร้าน (`8.9`) ต่างก็มี `balanceMismatchCount` ของตัวเอง นี่คือตัวเดียวกัน
 *
 * `outstandingMinutes` คือเวลาที่ร้าน "ติดค้าง" สมาชิกอยู่ — แพ็กเกจไม่อั้นไม่มีจำนวนนาทีให้นับ
 * จึงรายงานแยกเป็นจำนวนใบ ไม่ใช่ยัดเป็น 0 ซึ่งอ่านว่า "ใช้หมดแล้ว"
 */
export type BoardGamePassOutstanding = {
  activeMinutePasses: number;
  activeUnlimitedPasses: number;
  outstandingMinutes: number;
  expiringIn30Days: number;
  balanceMismatchCount: number;
};

export async function boardGamePassOutstanding(
  tenantId: string,
  visibleLocationIds?: string[] | null
): Promise<BoardGamePassOutstanding> {
  await requireBoardGameCafeTenant({ query }, tenantId);
  const scope = Array.isArray(visibleLocationIds)
    ? visibleLocationIds.map((id) => uuid(id, "locationId"))
    : null;
  const result = await query<{
    minute_passes: string; unlimited_passes: string; outstanding: string;
    expiring: string; mismatch: string;
  }>(
    `WITH scoped AS (
       SELECT * FROM bms_board_game_member_passes
        WHERE tenant_id = $1
          AND ($2::uuid[] IS NULL OR location_id IS NULL OR location_id = ANY($2::uuid[]))
     )
     SELECT
       (SELECT COUNT(*) FROM scoped
         WHERE status = 'ACTIVE' AND kind = 'MINUTES'
           AND expires_at > now()) AS minute_passes,
       (SELECT COUNT(*) FROM scoped
         WHERE status = 'ACTIVE' AND kind = 'UNLIMITED'
           AND expires_at > now()) AS unlimited_passes,
       COALESCE((SELECT SUM(remaining_minutes) FROM scoped
         WHERE status = 'ACTIVE' AND remaining_minutes IS NOT NULL
           AND expires_at > now()), 0) AS outstanding,
       COALESCE((SELECT SUM(remaining_minutes) FROM scoped
         WHERE status = 'ACTIVE' AND remaining_minutes IS NOT NULL
           AND expires_at > now() AND expires_at <= now() + interval '30 days'), 0) AS expiring,
       -- ยอดที่แคชไว้ต้องเท่ากับผลรวมของ ledger เสมอ · ledger เก็บขาใช้เป็นเลขติดลบ ขาคืนเป็นบวก
       -- แพ็กเกจไม่อั้นไม่มียอดให้เทียบ (NULL) จึงไม่นับเข้า drift
       (SELECT COUNT(*) FROM scoped p
         WHERE p.remaining_minutes IS NOT NULL
           AND p.remaining_minutes <> GREATEST(0, COALESCE(p.included_minutes, 0) + COALESCE((
             SELECT SUM(l.minutes) FROM bms_board_game_pass_ledger l
              WHERE l.tenant_id = p.tenant_id AND l.pass_id = p.id AND l.kind <> 'ISSUE'), 0))
         ) AS mismatch`,
    [tenantId, scope]
  );
  const row = result.rows[0];
  return {
    activeMinutePasses: Number(row?.minute_passes ?? 0),
    activeUnlimitedPasses: Number(row?.unlimited_passes ?? 0),
    outstandingMinutes: Number(row?.outstanding ?? 0),
    expiringIn30Days: Number(row?.expiring ?? 0),
    balanceMismatchCount: Number(row?.mismatch ?? 0),
  };
}

export async function listBoardGameMemberPasses(
  tenantId: string,
  input: {
    customerId?: string | null;
    activeOnly?: boolean | null;
    visibleLocationIds?: string[] | null;
  } = {}
): Promise<BoardGameMemberPass[]> {
  await requireBoardGameCafeTenant({ query }, tenantId);
  const customerId = input.customerId ? uuid(input.customerId, "customerId") : null;
  const activeOnly = Boolean(input.activeOnly);
  const scope = Array.isArray(input.visibleLocationIds)
    ? input.visibleLocationIds.map((id) => uuid(id, "locationId"))
    : null;
  const result = await query(
    `SELECT ${MEMBER_PASS_COLUMNS}, c.name AS customer_name
       FROM bms_board_game_member_passes p
       LEFT JOIN bms_customers c ON c.tenant_id = p.tenant_id AND c.id = p.customer_id
      WHERE p.tenant_id = $1
        AND ($2::uuid IS NULL OR p.customer_id = $2::uuid)
        AND (NOT $3::boolean OR (p.status = 'ACTIVE' AND p.expires_at > now()))
        AND ($4::uuid[] IS NULL OR p.location_id IS NULL OR p.location_id = ANY($4::uuid[]))
      ORDER BY p.expires_at DESC, p.created_at DESC
      LIMIT 200`,
    [tenantId, customerId, activeOnly, scope]
  );
  return result.rows.map(mapMemberPass);
}

/**
 * ขายแพ็กเกจให้สมาชิก — ราคาและจำนวนนาทีมาจากแพ็กเกจฝั่ง server เสมอ
 *
 * รูปเดียวกับการออกบัตรของขวัญ (`8.9`): เป็นคำสั่งที่มีสิทธิ์ของตัวเอง ไม่ใช่บรรทัดในตะกร้า ·
 * `orderId` เป็นการผูกกับบิลที่รับเงินไว้ ถ้าร้านเก็บเงินผ่านเครื่องขาย — ไม่ใช่สิ่งที่ทำให้เงินเข้า
 */
export async function issueBoardGameMemberPass(
  tenantId: string,
  input: {
    customerId: string;
    planId: string;
    idempotencyKey: string;
    startsAt?: string | Date | null;
    orderId?: string | null;
    note?: string | null;
    /** สาขาที่กำลังขาย — ใช้ตรวจกับแพ็กเกจที่ผูกสาขาไว้ · ผู้เรียกต้อง derive เอง ห้ามรับจาก body */
    locationId?: string | null;
  },
  actorUserId?: string | null
): Promise<BoardGameMemberPass & { replayed: boolean }> {
  const customerId = uuid(input.customerId, "customerId");
  const planId = uuid(input.planId, "planId");
  const orderId = input.orderId ? uuid(input.orderId, "orderId") : null;
  const locationId = input.locationId ? uuid(input.locationId, "locationId") : null;
  const key = requestKey(input.idempotencyKey);
  const note = optionalText(input.note, "หมายเหตุ", 500);
  const requestedStart = optionalDate(input.startsAt, "วันเริ่มใช้");
  const hash = requestHash({
    customerId,
    planId,
    startsAt: requestedStart?.toISOString() ?? null,
    orderId,
    note,
    locationId,
  });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    await lockIdempotencyKeyInTx(client, tenantId, "pass.issue", key);
    const replay = await client.query(
      `SELECT ${MEMBER_PASS_COLUMNS}, p.issue_request_hash, c.name AS customer_name
         FROM bms_board_game_member_passes p
         LEFT JOIN bms_customers c ON c.tenant_id = p.tenant_id AND c.id = p.customer_id
        WHERE p.tenant_id = $1 AND p.issue_idempotency_key = $2`,
      [tenantId, key]
    );
    if (replay.rowCount) {
      if (replay.rows[0].issue_request_hash !== hash) {
        throw new IdempotencyConflictError(IDEMPOTENCY_CONFLICT_MESSAGE, "pass.issue");
      }
      await client.query("COMMIT");
      return { ...mapMemberPass(replay.rows[0]), replayed: true };
    }
    const member = await client.query<{ id: string }>(
      `SELECT id FROM bms_customers WHERE tenant_id = $1 AND id = $2`,
      [tenantId, customerId]
    );
    if (!member.rowCount) throw new Error("ไม่พบลูกค้ารายนี้ในร้าน");
    const plan = await client.query<any>(
      `SELECT id, location_id, code, name, kind, price, duration_days, included_minutes
         FROM bms_board_game_pass_plans
        WHERE tenant_id = $1 AND id = $2 AND active
        FOR UPDATE`,
      [tenantId, planId]
    );
    if (!plan.rowCount) throw new Error("ไม่พบแพ็กเกจที่เปิดขายอยู่");
    // `9.92` ประกาศไว้ที่คอลัมน์เองว่า "มีค่า = แพ็กเกจของสาขานั้นสาขาเดียว" · ด่านนั้นต้องอยู่
    // ตรงที่เงินเกิด ไม่ใช่เฉพาะที่ route — ผู้เรียกที่ไม่ผ่าน route (เทส, งานภายใน, เส้นทางใหม่
    // ในอนาคต) จะขายข้ามสาขาได้เงียบ ๆ ถ้าด่านอยู่ข้างนอกอย่างเดียว
    const planLocationId: string | null = plan.rows[0].location_id ?? null;
    if (planLocationId && locationId !== planLocationId) {
      throw new Error("แพ็กเกจนี้ขายได้เฉพาะสาขาที่ผูกไว้");
    }
    if (orderId) {
      const linkedOrder = await client.query(
        `SELECT 1 FROM bms_orders
          WHERE tenant_id = $1 AND id = $2
            AND ($3::uuid IS NULL OR location_id = $3::uuid)`,
        [tenantId, orderId, planLocationId]
      );
      if (!linkedOrder.rowCount) {
        throw new Error("บิลที่ผูกแพ็กเกจไม่อยู่ในร้านหรือสาขาที่ขายแพ็กเกจนี้");
      }
    }
    const row = plan.rows[0];
    const startsAt = requestedStart ?? new Date();
    const expiresAt = boardGamePassExpiry(startsAt, Number(row.duration_days));
    const includedMinutes = row.included_minutes == null ? null : Number(row.included_minutes);
    const inserted = await client.query<any>(
      `INSERT INTO bms_board_game_member_passes
          (tenant_id, location_id, customer_id, plan_id, plan_code, plan_name, kind,
           included_minutes, price_paid, remaining_minutes, starts_at, expires_at, order_id,
           issue_idempotency_key, issue_request_hash, issued_by, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING ${MEMBER_PASS_COLUMNS.replace(/\bp\./g, "")}`,
      [
        tenantId, planLocationId, customerId, row.id, row.code, row.name, row.kind,
        includedMinutes, Number(row.price), includedMinutes, startsAt, expiresAt, orderId,
        key, hash, actorUserId ?? null, note,
      ]
    );
    await client.query(
      `INSERT INTO bms_board_game_pass_ledger
          (tenant_id, pass_id, kind, minutes, actor_user_id, note)
       VALUES ($1,$2,'ISSUE',$3,$4,$5)`,
      // แพ็กเกจไม่อั้นไม่มีโควตาให้บวก — ลง 0 ไว้เพื่อให้ประวัติเริ่มที่การออกบัตรเสมอ
      [tenantId, inserted.rows[0].id, includedMinutes ?? 0, actorUserId ?? null, note]
    );
    await auditInTx(client, tenantId, actorUserId, "board_game.pass_issue", inserted.rows[0].id, {
      customerId, planCode: row.code, kind: row.kind, pricePaid: Number(row.price),
      includedMinutes, expiresAt: expiresAt.toISOString(), orderId,
    });
    await client.query("COMMIT");
    return { ...mapMemberPass(inserted.rows[0]), customerName: null, replayed: false };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/** ยกเลิกแพ็กเกจ — ไม่คืนเงินให้เอง การคืนเงินเดินทางคืนเงินของ POS เหมือนของอย่างอื่น */
export async function cancelBoardGameMemberPass(
  tenantId: string,
  passIdInput: string,
  input: { reason: string },
  actorUserId?: string | null
): Promise<BoardGameMemberPass> {
  const passId = uuid(passIdInput, "passId");
  const reason = requiredText(input.reason, "เหตุผลยกเลิก", 500);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    const result = await client.query<any>(
      `UPDATE bms_board_game_member_passes
          SET status = 'CANCELLED', cancel_reason = $3, version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'
        RETURNING ${MEMBER_PASS_COLUMNS.replace(/\bp\./g, "")}`,
      [tenantId, passId, reason]
    );
    if (!result.rowCount) throw new Error("ไม่พบแพ็กเกจที่ยังใช้งานอยู่");
    // การยกเลิกใบปัจจุบันต้องหยุดสัญญาต่ออายุด้วย ไม่งั้น cron สร้างใบใหม่กลับมาในวันหมดอายุ
    // ทั้งที่พนักงานเพิ่งบันทึกว่าลูกค้าเลิกใช้แพ็กเกจแล้ว
    await client.query(
      `UPDATE bms_board_game_pass_renewals
          SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $3,
              cancel_reason = $4, version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND source_pass_id = $2 AND status <> 'CANCELLED'`,
      [tenantId, passId, actorUserId ?? null, `ยกเลิกพร้อมแพ็กเกจ: ${reason}`]
    );
    await auditInTx(client, tenantId, actorUserId, "board_game.pass_cancel", passId, { reason });
    await client.query("COMMIT");
    return { ...mapMemberPass(result.rows[0]), customerName: null };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * แพ็กเกจที่ใช้ได้ของทุกคนในกลุ่มบิลนี้ · `lock` = ตอนปิดบิลจริง
 *
 * ต้องล็อกแถวแพ็กเกจ **ก่อน** คิดยอด ไม่งั้นสองกลุ่มที่ปิดพร้อมกันต่างอ่านโควตาเดิม
 * แล้วหักทั้งคู่ · ลำดับล็อกคือ session -> กลุ่ม -> แพ็กเกจ เสมอ
 */
async function activePassesForGroupInTx(
  client: QueryClient,
  tenantId: string,
  billingGroupId: string,
  at: Date,
  options: { lock: boolean }
): Promise<Map<string, BoardGamePassBudget>> {
  const result = await client.query<{
    id: string; customer_id: string; kind: BoardGamePassKind; remaining_minutes: string | null;
  }>(
    `SELECT pass.id, pass.customer_id, pass.kind, pass.remaining_minutes
       FROM bms_board_game_member_passes pass
      WHERE pass.tenant_id = $1
        AND pass.status = 'ACTIVE'
        AND pass.starts_at <= $3::timestamptz
        AND pass.expires_at > $3::timestamptz
        -- NULL = ใช้ได้ทั้งร้าน; ใบผูกสาขาใช้ได้เฉพาะสาขาของกลุ่มบิลนั้น สาขาเป็น
        -- snapshot บนใบ (9.94) ไม่อ่านจาก plan ที่อาจถูกย้ายภายหลัง
        AND (
          pass.location_id IS NULL
          OR pass.location_id = (
            SELECT bill.location_id
              FROM bms_board_game_billing_groups bill
             WHERE bill.tenant_id = $1 AND bill.id = $2
          )
        )
        AND pass.customer_id IN (
          SELECT part.customer_id
            FROM bms_board_game_session_participants part
           WHERE part.tenant_id = $1 AND part.billing_group_id = $2
             AND part.customer_id IS NOT NULL
        )
      -- ลูกค้าถือได้หลายใบ · เลือกใบที่ช่วยจ่ายได้จริงก่อนเสมอ: ไม่อั้น > ใบที่ยังมีโควตา >
      -- ใบที่ใกล้หมดอายุที่สุด · เรียงด้วย id เฉย ๆ จะเลือกใบที่ใช้หมดแล้วแล้วบอกสมาชิกว่า
      -- แพ็กเกจที่เพิ่งซื้อช่วยอะไรไม่ได้
      ORDER BY (pass.kind = 'UNLIMITED') DESC,
               (pass.remaining_minutes IS NULL OR pass.remaining_minutes > 0) DESC,
               pass.expires_at, pass.id${options.lock ? "\n        FOR UPDATE" : ""}`,
    [tenantId, billingGroupId, at]
  );
  const passes = new Map<string, BoardGamePassBudget>();
  for (const row of result.rows) {
    // ใบแรกตามลำดับข้างบนใบเดียวที่ถูกใช้ — กันไม่ให้สองใบของคนเดียวกันช่วยจ่ายบรรทัดเดียวกันซ้อนกัน
    if (passes.has(row.customer_id)) continue;
    passes.set(row.customer_id, {
      id: row.id,
      kind: row.kind,
      remainingMinutes: row.remaining_minutes == null ? null : Number(row.remaining_minutes),
    });
  }
  return passes;
}

/** หักนาทีจริงตาม snapshot ที่เพิ่งแช่ · ยิงซ้ำไม่หักซ้ำเพราะ ledger มี unique ต่อ (ใบ, บิล, คน) */
async function consumePassMinutesInTx(
  client: QueryClient,
  tenantId: string,
  billingGroupId: string,
  lines: BoardGameChargeLine[],
  actorUserId?: string | null
) {
  for (const line of lines) {
    if (!line.passId || !line.coveredMinutes) continue;
    const ledger = await client.query(
      `INSERT INTO bms_board_game_pass_ledger
          (tenant_id, pass_id, kind, minutes, covered_amount, billing_group_id,
           participant_id, actor_user_id)
       VALUES ($1,$2,'CONSUME',$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        tenantId, line.passId, -line.coveredMinutes, line.coveredAmount ?? 0,
        billingGroupId, line.participantId, actorUserId ?? null,
      ]
    );
    if (!ledger.rowCount) continue;
    // แพ็กเกจไม่อั้นไม่มีโควตาให้หัก (`remaining_minutes` เป็น NULL) — ประวัติอย่างเดียวพอ
    await client.query(
      `UPDATE bms_board_game_member_passes
          SET remaining_minutes = GREATEST(0, remaining_minutes - $3),
              version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND remaining_minutes IS NOT NULL`,
      [tenantId, line.passId, line.coveredMinutes]
    );
  }
}

/** คืนนาทีเมื่อโต๊ะถูกยกเลิกหลังปิดบิล — กลุ่มที่ **จ่ายแล้ว** ยกเลิกไม่ได้อยู่แล้ว */
async function reversePassMinutesForGroupInTx(
  client: QueryClient,
  tenantId: string,
  billingGroupId: string,
  actorUserId?: string | null
) {
  const consumed = await client.query<{
    pass_id: string; participant_id: string | null; minutes: string; covered_amount: string;
  }>(
    `SELECT pass_id, participant_id, minutes, covered_amount
       FROM bms_board_game_pass_ledger
      WHERE tenant_id = $1 AND billing_group_id = $2 AND kind = 'CONSUME'`,
    [tenantId, billingGroupId]
  );
  for (const row of consumed.rows) {
    const minutes = Math.abs(Number(row.minutes));
    const reversed = await client.query(
      `INSERT INTO bms_board_game_pass_ledger
          (tenant_id, pass_id, kind, minutes, covered_amount, billing_group_id,
           participant_id, actor_user_id)
       VALUES ($1,$2,'REVERSE',$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        tenantId, row.pass_id, minutes, Number(row.covered_amount),
        billingGroupId, row.participant_id, actorUserId ?? null,
      ]
    );
    if (!reversed.rowCount) continue;
    await client.query(
      `UPDATE bms_board_game_member_passes
          SET remaining_minutes = remaining_minutes + $3,
              version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND remaining_minutes IS NOT NULL`,
      [tenantId, row.pass_id, minutes]
    );
  }
}

export async function calculateBoardGameGroupCharges(
  client: QueryClient,
  tenantId: string,
  billingGroupId: string,
  endedAt: Date | string,
  // แพ็กเกจที่ **ล็อกไว้แล้ว** จากผู้เรียกที่กำลังปิดบิล · ไม่ส่งมา = พรีวิว ซึ่งอ่านเองแบบไม่ล็อก
  // และไม่หักโควตา (การหักเกิดที่ `consumePassMinutesInTx` หลังแช่ snapshot เท่านั้น)
  lockedPasses?: Map<string, BoardGamePassBudget>
): Promise<{ lines: BoardGameChargeLine[]; total: number }> {
  const rows = await client.query<any>(
    `SELECT p.id, p.customer_id, p.display_name, p.participant_type, p.billable,
            p.rate_code_snapshot, p.rate_name_snapshot, p.hourly_rate_snapshot,
            g.group_no AS billing_group_no, p.joined_at,
            COALESCE(p.left_at, $3::timestamptz) AS actual_end_at,
            CASE
              WHEN p.planned_end_at > COALESCE(p.left_at, $3::timestamptz)
                THEN p.planned_end_at
              ELSE COALESCE(p.left_at, $3::timestamptz)
            END AS charge_end_at,
            p.minimum_minutes_snapshot AS minimum_minutes,
            p.rounding_minutes_snapshot AS rounding_minutes,
            p.grace_minutes_snapshot AS grace_minutes
       FROM bms_board_game_session_participants p
       JOIN bms_board_game_billing_groups g
         ON g.tenant_id = p.tenant_id AND g.id = p.billing_group_id
       JOIN bms_board_game_sessions s
         ON s.tenant_id = g.tenant_id AND s.id = g.session_id
      WHERE p.tenant_id = $1 AND p.billing_group_id = $2
      ORDER BY p.created_at, p.id`,
    [tenantId, billingGroupId, endedAt]
  );
  const billable = rows.rows.filter((row: any) => row.billable).map((row: any) => ({
    row,
    customerId: row.customer_id ?? null,
    billableMinutes: boardGameBillableMinutes({
      startedAt: row.joined_at,
      endedAt: row.charge_end_at,
      minimumMinutes: Number(row.minimum_minutes),
      roundingMinutes: Number(row.rounding_minutes),
      graceMinutes: Number(row.grace_minutes),
    }),
    hourlyRate: Number(row.hourly_rate_snapshot),
  }));
  const passes = lockedPasses
    ?? await activePassesForGroupInTx(client, tenantId, billingGroupId, new Date(endedAt), { lock: false });
  const coverage = applyBoardGamePassCoverage(billable, passes);
  const passLines: BoardGameChargeLine[] = billable.map((entry, index) => ({
    participantId: entry.row.id,
    displayName: entry.row.display_name,
    participantType: entry.row.participant_type,
    billingGroupNo: Number(entry.row.billing_group_no),
    rateCode: entry.row.rate_code_snapshot ?? null,
    rateName: entry.row.rate_name_snapshot ?? null,
    joinedAt: iso(entry.row.joined_at),
    actualEndedAt: iso(entry.row.actual_end_at),
    chargedUntil: iso(entry.row.charge_end_at),
    actualMinutes: boardGameActualMinutes(entry.row.joined_at, entry.row.actual_end_at),
    billableMinutes: entry.billableMinutes,
    hourlyRate: entry.hourlyRate,
    amount: coverage[index].amount,
    customerId: entry.customerId,
    grossAmount: coverage[index].grossAmount,
    passId: coverage[index].passId,
    coveredMinutes: coverage[index].coveredMinutes,
    coveredAmount: coverage[index].coveredAmount,
  }));
  const passTotal = money(passLines.reduce((sum, line) => sum + line.amount, 0));

  // โปรโมชันและ pass เป็นสิทธิ์ค่าเวลาสองชนิดที่ไม่ซ้อนกัน: เลือกยอดที่ต่ำกว่าให้ลูกค้า
  // อัตโนมัติ และเมื่อเสมอกันเลือกโปรโมชันเพื่อไม่เผาโควตา pass โดยไม่เกิดประโยชน์เพิ่ม
  const offerContext = await eligibleBoardGameOffersInTx(client, tenantId, billingGroupId);
  const offer = applyBestBoardGameOffer(
    passLines.map((line) => ({
      billableMinutes: line.billableMinutes,
      grossAmount: Number(line.grossAmount ?? line.amount),
    })),
    offerContext.offers,
    { at: new Date(endedAt), timezone: offerContext.timezone, productSkus: offerContext.productSkus },
  );
  if (!offer || offer.total > passTotal) return { lines: passLines, total: passTotal };

  const offerLines: BoardGameChargeLine[] = passLines.map((line, index) => ({
    ...line,
    amount: offer.lines[index].amount,
    passId: null,
    coveredMinutes: 0,
    coveredAmount: 0,
    offerId: offer.lines[index].offerId,
    offerCode: offer.lines[index].offerCode,
    offerName: offer.lines[index].offerName,
    offerDiscountAmount: offer.lines[index].offerDiscountAmount,
  }));
  return { lines: offerLines, total: offer.total };
}

async function closeOpenBillingGroupInTx(
  client: PoolClient,
  tenantId: string,
  group: BillingGroupRow,
  endedAt: Date,
  settlementKey: string,
  settlementHash: string,
  actorUserId?: string | null,
): Promise<BoardGameBillingGroup> {
  // ล็อกแพ็กเกจก่อนคิดยอด · สองกลุ่มที่ปิดพร้อมกันจะได้ไม่อ่านโควตาเดิมแล้วหักทั้งคู่
  const passes = await activePassesForGroupInTx(client, tenantId, group.id, endedAt, { lock: true });
  const charges = await calculateBoardGameGroupCharges(client, tenantId, group.id, endedAt, passes);
  const updated = await client.query<BillingGroupRow>(
    `UPDATE bms_board_game_billing_groups
        SET status = 'CLOSING', ended_at = $3, closed_by = $4, amount_due = $5,
            settlement_idempotency_key = $6, settlement_request_hash = $7,
            charge_snapshot = $8::jsonb, version = version + 1, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'
      RETURNING ${BILLING_GROUP_COLUMNS}`,
    [
      tenantId, group.id, endedAt, actorUserId ?? null, charges.total,
      settlementKey, settlementHash, JSON.stringify(charges.lines),
    ]
  );
  if (!updated.rowCount) throw new Error("กลุ่มบิลนี้ปิดไปแล้ว");
  // หักโควตาหลังจาก snapshot ถูกแช่แล้วเท่านั้น — ทั้งสองอยู่ในทรานแซกชันเดียวกัน จึงไม่มีทาง
  // ที่นาทีจะถูกหักโดยที่บิลไม่ได้ลดราคา หรือกลับกัน
  await consumePassMinutesInTx(client, tenantId, group.id, charges.lines, actorUserId);
  return mapBillingGroupRow(updated.rows[0]);
}

/**
 * ปิดเฉพาะกลุ่มที่กำลังจะจ่าย โดยปล่อยให้กลุ่มอื่นบนโต๊ะเล่นต่อ (Phase 3)
 *
 * กลุ่มคือหน่วยของเงินอยู่แล้วตั้งแต่ `9.89`; การบังคับให้ปิดทั้ง session เพียงเพื่อให้คนหนึ่ง
 * กลับก่อนจะทำให้เวลาของทุกคนถูกแช่พร้อมกันอย่างผิดความจริง คำสั่งนี้จึงล็อก session ก่อนกลุ่ม
 * (ลำดับเดียวกับคำสั่งปิดทั้งโต๊ะ), แช่เฉพาะ charge snapshot ของกลุ่มที่ขอ และคำนวณสถานะโต๊ะ
 * ใหม่จากกลุ่มทั้งหมด โต๊ะยังเป็น OPEN ตราบใดที่มีกลุ่มอื่นกำลังเล่นอยู่
 */
export async function closeBoardGameBillingGroupForBilling(
  tenantId: string,
  billingGroupIdInput: string,
  input: { idempotencyKey: string; endedAt?: string | Date | null },
  actorUserId?: string | null,
) {
  const billingGroupId = uuid(billingGroupIdInput, "billingGroupId");
  const key = requestKey(input.idempotencyKey);
  const requestedEndedAt = optionalDate(input.endedAt, "เวลาปิด");
  const hash = requestHash({
    billingGroupId,
    endedAt: requestedEndedAt?.toISOString() ?? null,
  });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    await requireBoardGameCafeTenant(client, tenantId);
    await lockIdempotencyKeyInTx(client, tenantId, "billing_group.close", key);

    // หา session ก่อนแบบไม่ล็อก แล้วล็อก session -> ทุกกลุ่มตามลำดับเดียวกับ close ทั้งโต๊ะ
    // เพื่อไม่ให้สองแคชเชียร์ปิดคนละระดับแล้ว deadlock กัน
    const owner = await client.query<{ session_id: string }>(
      `SELECT session_id FROM bms_board_game_billing_groups
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, billingGroupId]
    );
    if (!owner.rowCount) throw new Error("ไม่พบกลุ่มบิล");
    const sessionId = owner.rows[0].session_id;
    const session = await client.query<{ id: string; status: BoardGameSessionStatus; started_at: Date }>(
      `SELECT id, status, started_at FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
      [tenantId, sessionId]
    );
    if (!session.rowCount) throw new Error("ไม่พบ session");
    const groups = await lockSessionBillingGroupsInTx(client, tenantId, sessionId);
    const group = groups.find((row) => row.id === billingGroupId);
    if (!group) throw new Error("ไม่พบกลุ่มบิล");

    if (group.status !== "OPEN") {
      if (
        (group.status === "CLOSING" || group.status === "PAID")
        && group.settlement_idempotency_key === key
        && group.settlement_request_hash === hash
      ) {
        const replay = mapBillingGroupRow(group);
        await client.query("COMMIT");
        return {
          sessionId,
          groups: [replay],
          amountDue: replay.amountDue,
          lines: replay.chargeSnapshot,
          endedAt: replay.endedAt,
          replayed: true,
        };
      }
      if (group.status === "CANCELLED") throw new Error("กลุ่มบิลนี้ถูกยกเลิกไปแล้ว");
      throw new IdempotencyConflictError("กลุ่มบิลนี้เริ่มปิดด้วยคำขออื่นแล้ว", "settlement");
    }

    const endedAt = requestedEndedAt ?? new Date();
    if (endedAt <= new Date(session.rows[0].started_at)) {
      throw new Error("เวลาปิดต้องหลังเวลาเปิดโต๊ะ");
    }

    // ถ้ายังมีกลุ่มอื่นเล่นอยู่ กล่องเกมยังเป็นของ session และเล่นต่อได้ตามปกติ แต่กลุ่มสุดท้าย
    // ห้ามปิดจนกว่าจะรับคืนครบ มิฉะนั้นโต๊ะจะไม่มีผู้เล่นแล้วแต่ทรัพย์สินยังค้างเป็น CHECKED_OUT
    const otherOpenGroups = groups.filter((row) => row.status === "OPEN" && row.id !== billingGroupId);
    if (!otherOpenGroups.length) {
      const openLoans = await client.query(
        `SELECT 1 FROM bms_board_game_session_games
          WHERE tenant_id = $1 AND session_id = $2 AND status = 'CHECKED_OUT'
          LIMIT 1`,
        [tenantId, sessionId]
      );
      if (openLoans.rowCount) throw new Error("กรุณารับคืนเกมทุกกล่องก่อนปิดบิลสุดท้าย");
      // บัตรที่รับไว้ต้องกลับไปอยู่ในมือเจ้าของก่อนโต๊ะนี้จบ (`9.93`)
      // ความล้มเหลวที่เกิดจริงไม่ใช่ "หาบัตรไม่เจอ" แต่คือลูกค้าเดินออกไปโดยที่บัตรยังอยู่ในลิ้นชัก ·
      // บัตรเป็นของ "การมาเล่นครั้งนี้" ไม่ใช่ของกลุ่มใดกลุ่มหนึ่ง ด่านจึงอยู่ที่เดียวกับกล่องเกม
      const heldDocuments = await client.query(
        `SELECT 1 FROM bms_board_game_identity_holds
          WHERE tenant_id = $1 AND session_id = $2 AND status = 'HELD'
          LIMIT 1`,
        [tenantId, sessionId]
      );
      if (heldDocuments.rowCount) throw new Error("กรุณาคืนบัตรที่รับไว้ให้ลูกค้าก่อนปิดบิลสุดท้าย");
    }

    const closed = await closeOpenBillingGroupInTx(
      client, tenantId, group, endedAt, key, hash, actorUserId
    );
    await refreshSessionFromGroupsInTx(client, tenantId, sessionId);
    await auditInTx(client, tenantId, actorUserId, "board_game.billing_group_close_for_billing", billingGroupId, {
      sessionId,
      groupNo: closed.groupNo,
      amountDue: closed.amountDue,
      tabAmount: closed.tabAmount,
      lineCount: closed.chargeSnapshot.length,
      overriddenTime: requestedEndedAt != null,
    });
    await client.query("COMMIT");
    return {
      sessionId,
      groups: [closed],
      amountDue: closed.amountDue,
      lines: closed.chargeSnapshot,
      endedAt: closed.endedAt,
      replayed: false,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * ปิดเวลาเล่นของโต๊ะ = ปิดทุกกลุ่มบิลที่ยังเปิดอยู่ แล้วส่งบิลคนละใบต่อกลุ่มให้เครื่องขาย
 *
 * โต๊ะที่มีกลุ่มเดียว (ค่าปริยาย) ได้บิลใบเดียวเหมือนเดิมทุกประการ · โต๊ะที่พนักงานแยกกลุ่มไว้
 * ตอนเปิดโต๊ะจะได้บิลตามจำนวนกลุ่ม ซึ่งก่อน `9.89` ทำไม่ได้เลย: ทุกกลุ่มถูกยัดลงออร์เดอร์ใบเดียว
 *
 * กลุ่มที่ปิดไปก่อนหน้าด้วยคำขออื่นจะไม่ถูกแตะและไม่ถูกรวมในผลของคำขอนี้ — ไม่เช่นนั้น
 * response แรกกับ replay จะตอบคนละชุด และคำสั่งปิดทั้งโต๊ะจะอ้างบิลที่กลุ่มอื่นปิดไว้เป็นผลงานตัวเอง
 */
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
      `SELECT id, status, started_at
         FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
      [tenantId, scopedSessionId]
    );
    if (!session.rowCount) throw new Error("ไม่พบ session");
    const row = session.rows[0];
    const groups = await lockSessionBillingGroupsInTx(client, tenantId, scopedSessionId);
    if (!groups.length) throw new Error("session นี้ไม่มีกลุ่มบิล");
    const openGroups = groups.filter((group) => group.status === "OPEN");

    if (!openGroups.length) {
      const settled = groups.filter(
        (group) => !["CANCELLED", "MERGED"].includes(group.status),
      );
      if (!settled.length) throw new Error("session นี้ถูกยกเลิกไปแล้ว");
      // ยิงซ้ำของคำขอเดิม = กลุ่มถือคีย์ที่แตกจากคีย์นี้ · ไม่มีเลย = คนอื่นปิดไปก่อนแล้ว
      const mine = settled.filter(
        (group) => group.settlement_idempotency_key === groupRequestKey(key, Number(group.group_no))
          && group.settlement_request_hash === hash
      );
      if (!mine.length) {
        throw new IdempotencyConflictError(
          "session นี้เริ่มปิดบิลด้วยคำขออื่นแล้ว",
          "settlement",
        );
      }
      await client.query("COMMIT");
      return {
        sessionId: scopedSessionId,
        groups: mine.map(mapBillingGroupRow),
        amountDue: money(mine.reduce((sum, group) => sum + Number(group.amount_due), 0)),
        lines: mine.flatMap((group) => mapBillingGroupRow(group).chargeSnapshot),
        endedAt: iso(mine.reduce<Date | null>(
          (latest, group) => (group.ended_at && (!latest || group.ended_at > latest) ? group.ended_at : latest),
          null
        )),
        replayed: true,
      };
    }

    const endedAt = requestedEndedAt ?? new Date();
    if (endedAt <= new Date(row.started_at)) throw new Error("เวลาปิดต้องหลังเวลาเปิดโต๊ะ");
    const openLoans = await client.query(
      `SELECT 1 FROM bms_board_game_session_games
        WHERE tenant_id = $1 AND session_id = $2 AND status = 'CHECKED_OUT'
        LIMIT 1`,
      [tenantId, scopedSessionId]
    );
    if (openLoans.rowCount) throw new Error("กรุณารับคืนเกมทุกกล่องก่อนปิดบิล");
    // บัตรที่รับไว้ต้องกลับไปอยู่ในมือเจ้าของก่อนโต๊ะนี้จบ (`9.93`)
    // ความล้มเหลวที่เกิดจริงไม่ใช่ "หาบัตรไม่เจอ" แต่คือลูกค้าเดินออกไปโดยที่บัตรยังอยู่ในลิ้นชัก ·
    // บัตรเป็นของ "การมาเล่นครั้งนี้" ไม่ใช่ของกลุ่มใดกลุ่มหนึ่ง ด่านจึงอยู่ที่เดียวกับกล่องเกม
    const heldDocuments = await client.query(
      `SELECT 1 FROM bms_board_game_identity_holds
        WHERE tenant_id = $1 AND session_id = $2 AND status = 'HELD'
        LIMIT 1`,
      [tenantId, scopedSessionId]
    );
    if (heldDocuments.rowCount) throw new Error("กรุณาคืนบัตรที่รับไว้ให้ลูกค้าก่อนปิดบิล");

    const closed: BoardGameBillingGroup[] = [];
    for (const group of openGroups) {
      const groupNo = Number(group.group_no);
      closed.push(await closeOpenBillingGroupInTx(
        client,
        tenantId,
        group,
        endedAt,
        groupRequestKey(key, groupNo),
        hash,
        actorUserId,
      ));
    }

    if (normalizedNote) {
      await client.query(
        `UPDATE bms_board_game_sessions SET note = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, scopedSessionId, normalizedNote]
      );
    }
    await refreshSessionFromGroupsInTx(client, tenantId, scopedSessionId);

    const total = money(closed.reduce((sum, group) => sum + group.amountDue, 0));
    await auditInTx(client, tenantId, actorUserId, "board_game.session_close_for_billing", scopedSessionId, {
      amountDue: total,
      groupCount: closed.length,
      lineCount: closed.reduce((sum, group) => sum + group.chargeSnapshot.length, 0),
      overriddenTime: requestedEndedAt != null,
    });
    await client.query("COMMIT");
    return {
      sessionId: scopedSessionId,
      groups: closed,
      amountDue: total,
      lines: closed.flatMap((group) => group.chargeSnapshot),
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
      `SELECT id, status FROM bms_board_game_sessions
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
      [tenantId, scopedSessionId]
    );
    if (!session.rowCount) throw new Error("ไม่พบ session");
    const groups = await lockSessionBillingGroupsInTx(client, tenantId, scopedSessionId);
    if (!groups.length) throw new Error("session นี้ไม่มีกลุ่มบิล");
    // กลุ่มที่ **เก็บเงินไปแล้ว** ยกเลิกที่นี่ไม่ได้ — เงินที่รับมาแล้วต้องคืนผ่านเส้นทางคืนเงินของ POS
    //
    // ⚠️ `current_order_id` อย่างเดียวตัดสินไม่ได้แล้วตั้งแต่ `9.90`: ใบที่กลุ่มถืออยู่ระหว่างเล่น
    // คือ **ใบจองของ tab** ซึ่งเป็นสิ่งที่การยกเลิกโต๊ะต้องปล่อยคืน ไม่ใช่เหตุผลที่จะห้ามยกเลิก
    // ลูกค้าเดินออกโดยไม่จ่ายแล้วของที่จองไว้ต้องกลับมาขายได้ ไม่ใช่ค้างอยู่กับโต๊ะที่ไม่มีใครนั่ง
    if (groups.some((group) => group.status === "PAID")) {
      throw new Error("session ที่ชำระเงินแล้วไม่สามารถยกเลิกได้");
    }
    const cancellable = groups.filter(
      (group) => !["CANCELLED", "MERGED"].includes(group.status),
    );
    if (!cancellable.length) {
      // ยิงซ้ำของคำขอเดิม = กลุ่มถือคีย์ยกเลิกที่แตกจากคีย์นี้ · ไม่มีเลย = คนอื่นยกเลิกไปก่อนแล้ว
      const mine = groups.some(
        (group) => group.cancel_idempotency_key === groupRequestKey(key, Number(group.group_no))
          && group.cancel_request_hash === hash
      );
      if (!mine) {
        throw new IdempotencyConflictError(
          "session นี้ถูกยกเลิกด้วยคำขออื่นแล้ว",
          "cancel",
        );
      }
      await client.query("COMMIT");
      return { sessionId: scopedSessionId, status: "CANCELLED" as const, replayed: true };
    }
    const openLoans = await client.query(
      `SELECT 1 FROM bms_board_game_session_games
        WHERE tenant_id = $1 AND session_id = $2 AND status = 'CHECKED_OUT'
        LIMIT 1`,
      [tenantId, scopedSessionId]
    );
    if (openLoans.rowCount) throw new Error("กรุณารับคืนเกมทุกกล่องก่อนยกเลิก session");
    // ยกเลิกโต๊ะก็ต้องคืนบัตร (`9.93`) — ไม่งั้นการยกเลิกกลายเป็นทางเลี่ยงด่านตอนปิดบิล
    // ความล้มเหลวที่เกิดจริงไม่ใช่ "หาบัตรไม่เจอ" แต่คือลูกค้าเดินออกไปโดยที่บัตรยังอยู่ในลิ้นชัก ·
    // บัตรเป็นของ "การมาเล่นครั้งนี้" ไม่ใช่ของกลุ่มใดกลุ่มหนึ่ง ด่านจึงอยู่ที่เดียวกับกล่องเกม
    const heldDocuments = await client.query(
      `SELECT 1 FROM bms_board_game_identity_holds
        WHERE tenant_id = $1 AND session_id = $2 AND status = 'HELD'
        LIMIT 1`,
      [tenantId, scopedSessionId]
    );
    if (heldDocuments.rowCount) throw new Error("กรุณาคืนบัตรที่รับไว้ให้ลูกค้าก่อนยกเลิกโต๊ะ");
    const previousAmountDue = money(
      cancellable.reduce((sum, group) => sum + Number(group.amount_due), 0)
    );
    for (const group of cancellable) {
      // ปล่อยใบจองของ tab ก่อน ไม่งั้นของที่ลูกค้าไม่ได้เอาไปจะถูกกันไว้ให้โต๊ะที่ยกเลิกแล้วตลอดไป
      const live = await client.query<{ id: string }>(
        `SELECT id FROM bms_orders
          WHERE tenant_id = $1 AND board_game_billing_group_id = $2 AND status = 'PENDING'
          FOR UPDATE`,
        [tenantId, group.id]
      );
      for (const row of live.rows) {
        const released = await cancelOrderInTx(client, tenantId, row.id);
        if (!released) {
          throw new Error("ใบจองของบิลนี้อยู่สถานะที่ปล่อยคืนไม่ได้ — ให้ผู้ดูแลตรวจบิลนี้ก่อน");
        }
      }
      // กลุ่มที่ปิดไปแล้วอาจหักโควตาแพ็กเกจของสมาชิกไป — ยกเลิกโต๊ะต้องคืนนาทีนั้น
      // ไม่งั้นสมาชิกเสียเวลาในแพ็กเกจให้กับโต๊ะที่ไม่มีใครจ่ายเงิน
      await reversePassMinutesForGroupInTx(client, tenantId, group.id, actorUserId);
      await client.query(
        `UPDATE bms_board_game_billing_groups
            SET status = 'CANCELLED', ended_at = COALESCE(ended_at, now()), closed_by = $3,
                amount_due = 0, tab_amount = 0, current_order_id = NULL, cancel_reason = $4,
                cancel_idempotency_key = $5, cancel_request_hash = $6,
                version = version + 1, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [
          tenantId, group.id, actorUserId ?? null, reason,
          groupRequestKey(key, Number(group.group_no)), hash,
        ]
      );
    }
    await client.query(
      `UPDATE bms_board_game_sessions SET note = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, scopedSessionId, reason]
    );
    await refreshSessionFromGroupsInTx(client, tenantId, scopedSessionId);
    await auditInTx(client, tenantId, actorUserId, "board_game.session_cancel", scopedSessionId, {
      previousAmountDue,
      groupCount: cancellable.length,
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

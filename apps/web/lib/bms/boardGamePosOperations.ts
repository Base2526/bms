/**
 * คำสั่งบอร์ดเกมของ "เครื่องขาย" — ชุดเดียวที่ทั้ง GraphQL (แอป RN) และ REST (เบราว์เซอร์) ใช้
 * ---------------------------------------------------------------------------------------
 * ก่อนไฟล์นี้ เส้นบอร์ดเกมมีผู้เรียกฝั่งเครื่องขายอยู่ทางเดียวคือ resolver ใน
 * `graphql/bmsPosDevice.ts` ซึ่งถือสามอย่างไว้ในตัวเอง: **สิทธิ์ของแต่ละคำสั่ง** ·
 * **ด่านว่า session/loan อยู่สาขาของเครื่องนี้จริง** · และ **การแปลง input เป็นค่าที่ service รับ**
 * พอเบราว์เซอร์ต้องทำงานเดียวกัน (จอ `/pos` ไม่มี Apollo provider จึงยิง REST) การก็อปสามอย่างนั้น
 * ไปไว้ใน route คือการมีตัวตัดสินสิทธิ์สองชุด — วันที่กติกาเปลี่ยน อีกฝั่งจะยังอนุญาตของเดิม
 * โดยไม่มีอะไรฟ้อง
 *
 * ไฟล์นี้จึงถือของที่ **ต้องเหมือนกันเสมอ** ส่วนที่ต่างกันโดยธรรมชาติ (จะยืนยันตัวตนยังไง
 * และจะคืน error หน้าตาไหน) ยังเป็นของ adapter แต่ละตัว
 *
 * ขอบเขต: ไม่ตรวจ PIN และไม่ตรวจ permission เอง — ผู้เรียกทำมาก่อนตามตาราง
 * `BOARD_GAME_POS_ACTIONS` ซึ่งเป็นที่เดียวที่ประกาศว่าคำสั่งไหนใช้สิทธิ์อะไร
 */
import {
  addBoardGameParticipant,
  adjustBoardGameSessionTiming,
  cancelBoardGameSession,
  checkoutBoardGameCopy,
  closeBoardGameSessionForBilling,
  getBoardGameCheckoutForPos,
  getBoardGameSession,
  leaveBoardGameParticipant,
  listBoardGameFloor,
  listBoardGameLibrary,
  listBoardGameTimeRates,
  locationOfBoardGameLoan,
  locationOfBoardGameSession,
  openBoardGameSession,
  returnBoardGameCopy,
} from "./boardGameCafe";
import { isIdempotencyConflictError } from "./idempotencyErrors";
import { isPosUuid } from "./posRouteHelpers";

/**
 * การปฏิเสธตามกติกา ไม่ใช่เซิร์ฟเวอร์พัง — รูปเดียวกับ `RestaurantCheckError` (9.62)
 *
 * เหตุผลเดียวกันเป๊ะ: `boardGameCafe.ts` ปฏิเสธด้วย `throw new Error(...)` 63 จุด ถ้าปล่อยให้
 * ตกไปถึงตัวจัดการ error กลางของ REST จะตอบ 500 ที่ **ข้อความจริงถูกลบทิ้งบน production**
 * เหลือ "เซิร์ฟเวอร์ผิดพลาด" ส่วน GraphQL จะติดรหัส `INTERNAL_SERVER_ERROR` ซึ่งเอกสารสัญญา
 * ของไคลเอนต์สั่งให้ **ยิงซ้ำด้วยคีย์เดิม** → คำขอที่ผิดกติกาจะวนล้มแบบเดิมตลอดไป
 */
export class BoardGamePosError extends Error {
  constructor(
    message: string,
    /** `BAD_INPUT` = ข้อมูลที่ส่งมาผิดรูป · `REJECTED` = กติกาไม่ให้ทำ · `NOT_FOUND` = ไม่ใช่ของสาขานี้ */
    readonly reason: "BAD_INPUT" | "REJECTED" | "NOT_FOUND" = "REJECTED",
  ) {
    super(message);
    this.name = "BoardGamePosError";
  }
}

export function isBoardGamePosError(error: unknown): error is BoardGamePosError {
  return error instanceof BoardGamePosError;
}

function badInput(message: string): never {
  throw new BoardGamePosError(message, "BAD_INPUT");
}

function notFound(message: string): never {
  throw new BoardGamePosError(message, "NOT_FOUND");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * ตัดสินว่า error ที่หลุดออกมาจาก service เป็น "กติกาปฏิเสธ" หรือ "ของพังจริง"
 *
 * คืน `null` = ห้ามแตะ ให้มันหลุดไปตามเดิม · คืนคำปฏิเสธ = ตอบคนหน้าเครื่องเป็น 4xx ได้
 *
 * ⚠️ เป็นการตัดสินที่ขอบ ไม่ใช่ที่ต้นทาง — ทางที่ถูกกว่าคือให้ `boardGameCafe.ts` โยนคลาสของ
 * ตัวเองทั้ง 63 จุด แต่นั่นคือการแก้ไฟล์ที่ถือเส้นเงินทั้งไฟล์ในรอบเดียว จึงกันด้วยกฎที่แคบแทน:
 * ของที่ **เป็นความผิดพลาดของโปรแกรมหรือของฐานข้อมูล** ต้องหลุดไปเป็น 500 ตามเดิมเสมอ
 * (500 ที่มี stack ใน system_logs มีค่ากว่า 409 ที่อ่านว่า "คนหน้าเครื่องทำผิด")
 *
 * ปลอดภัยที่จะตอบว่า "ตัดสินแล้ว" เพราะทุกคำสั่งของ `boardGameCafe.ts` ทำงานในทรานแซกชันเดียว
 * การ throw จึง rollback ทั้งก้อน รวมถึงคีย์กันรายการซ้ำที่เก็บไว้บนแถวเดียวกัน — คำขอที่ถูก
 * ปฏิเสธจึงไม่เคยเขียนอะไรค้างไว้ ครั้งหน้าที่คนหน้าเครื่องกดคือเจตนาใหม่ที่ต้องมีคีย์ใหม่
 */
export function boardGameRejectionFrom(error: unknown): BoardGamePosError | null {
  if (isBoardGamePosError(error)) return error;
  // คีย์ซ้ำที่เนื้อในเปลี่ยน — มีคลาสและรหัสของตัวเองอยู่แล้ว ปล่อยผ่านให้ adapter จัดประเภท
  if (isIdempotencyConflictError(error)) return null;
  // SQLSTATE ของ pg (เช่น 23505, 42P01) = ฐานข้อมูลปฏิเสธ ไม่ใช่กติกาธุรกิจ
  if (typeof (error as { code?: unknown } | null)?.code === "string") return null;
  // บั๊กของโค้ดเอง — รายงานเป็นคำปฏิเสธคือการกลบต้นเหตุ
  if (
    error instanceof TypeError
    || error instanceof RangeError
    || error instanceof ReferenceError
    || error instanceof SyntaxError
  ) return null;
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return null;
  return new BoardGamePosError(message, "REJECTED");
}

async function callService<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const rejection = boardGameRejectionFrom(error);
    if (rejection) throw rejection;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// ตารางสิทธิ์: ที่เดียวที่ประกาศว่าคำสั่งไหนต้องถือสิทธิ์อะไร
// ---------------------------------------------------------------------------

export type BoardGamePosAction =
  | "workspace"
  | "session"
  | "checkout"
  | "open"
  | "participant.add"
  | "participant.leave"
  | "timing"
  | "close"
  | "cancel"
  | "copy.checkout"
  | "copy.return";

export type BoardGamePosActionSpec = {
  /** สิทธิ์หลักที่ต้องถือ — ตัวที่ผู้เรียกใช้ตอนตรวจ PIN */
  permission: string;
  /**
   * สิทธิ์เพิ่มเติมที่ต้องถือด้วย · รับ input เพราะ `copy.return` เข้มขึ้นเมื่อคนหน้าเครื่อง
   * ตั้งสถานะกล่องเกมเป็นอย่างอื่นนอกจาก "พร้อมให้ยืม/รอตรวจ" (= ตัดสินใจเรื่องทรัพย์สิน)
   */
  extraPermissions: (input: Record<string, unknown>) => string[];
  /** ต้องมีกะเปิดอยู่ไหม — เฉพาะคำสั่งที่ผูกกับเงิน/ของในกะนั้น */
  requiresOpenShift: boolean;
};

const NO_EXTRA = () => [] as string[];

export const BOARD_GAME_POS_ACTIONS: Record<BoardGamePosAction, BoardGamePosActionSpec> = {
  workspace: {
    permission: "board_game.session.manage",
    extraPermissions: () => ["board_game.library.view"],
    requiresOpenShift: false,
  },
  session: {
    permission: "board_game.session.manage",
    extraPermissions: NO_EXTRA,
    requiresOpenShift: false,
  },
  // บิลที่ส่งต่อไปแท็บขายเป็นเรื่องของการเก็บเงิน ไม่ใช่การจัดการโต๊ะ
  checkout: {
    permission: "pos.sell",
    extraPermissions: NO_EXTRA,
    requiresOpenShift: false,
  },
  open: {
    permission: "board_game.session.manage",
    extraPermissions: NO_EXTRA,
    requiresOpenShift: true,
  },
  "participant.add": {
    permission: "board_game.session.manage",
    extraPermissions: NO_EXTRA,
    requiresOpenShift: false,
  },
  "participant.leave": {
    permission: "board_game.session.manage",
    extraPermissions: NO_EXTRA,
    requiresOpenShift: false,
  },
  // แก้เวลาเริ่ม/เวลาที่ซื้อไว้ = แก้ยอดเงิน จึงเป็นสิทธิ์ของตัวเอง ไม่ใช่สิทธิ์เปิดโต๊ะ
  timing: {
    permission: "board_game.session.override_time",
    extraPermissions: NO_EXTRA,
    requiresOpenShift: false,
  },
  close: {
    permission: "board_game.session.manage",
    extraPermissions: NO_EXTRA,
    requiresOpenShift: true,
  },
  cancel: {
    permission: "board_game.session.cancel",
    extraPermissions: NO_EXTRA,
    requiresOpenShift: false,
  },
  "copy.checkout": {
    permission: "board_game.session.manage",
    extraPermissions: () => ["board_game.library.view"],
    requiresOpenShift: false,
  },
  "copy.return": {
    permission: "board_game.session.manage",
    extraPermissions: (input) => {
      const copyStatus = text(input.copyStatus).toUpperCase();
      if (!copyStatus || copyStatus === "AVAILABLE" || copyStatus === "NEEDS_CHECK") return [];
      return ["board_game.library.manage"];
    },
    requiresOpenShift: false,
  },
};

export function isBoardGamePosAction(value: unknown): value is BoardGamePosAction {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(BOARD_GAME_POS_ACTIONS, value);
}

// ---------------------------------------------------------------------------
// ตัวแปลง input — รูปเดียวกับที่ resolver ของ POS ใช้อยู่ ไม่ใช่กฎชุดใหม่
// ---------------------------------------------------------------------------

function uuid(value: unknown, message: string): string {
  const parsed = text(value);
  if (!isPosUuid(parsed)) return badInput(message);
  return parsed;
}

function optionalUuid(value: unknown, message: string): string | null {
  const parsed = text(value);
  if (!parsed) return null;
  if (!isPosUuid(parsed)) return badInput(message);
  return parsed;
}

function idempotencyKey(value: unknown): string {
  const key = text(value);
  if (key.length < 8 || key.length > 200) {
    return badInput("idempotencyKey ต้องยาว 8-200 ตัวอักษร");
  }
  return key;
}

function billingMode(value: unknown): "OPEN_ENDED" | "FIXED_DURATION" {
  return text(value).toUpperCase() === "FIXED_DURATION" ? "FIXED_DURATION" : "OPEN_ENDED";
}

function participantDraft(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return badInput("ผู้เล่นไม่ถูกต้อง");
  }
  const row = value as Record<string, unknown>;
  return {
    rateId: optionalUuid(row.rateId, "อัตราค่าบริการไม่ถูกต้อง"),
    customerId: optionalUuid(row.customerId, "สมาชิกไม่ถูกต้อง"),
    displayName: text(row.displayName) || null,
    participantType: text(row.participantType) || undefined,
    billingGroupNo: Number(row.billingGroupNo ?? 1),
  };
}

// ---------------------------------------------------------------------------
// ด่านสาขา: id ที่ผู้เรียกส่งมาต้องเป็นของสาขาที่เครื่องนี้ผูกอยู่จริง
// ---------------------------------------------------------------------------

export type BoardGamePosScope = {
  tenantId: string;
  locationId: string;
  /** id ของเครื่องขาย — ประทับลง session ที่เปิดจากเครื่องนี้ */
  deviceId: string;
  /** กะที่เปิดอยู่ของเครื่องนี้ (null ได้เมื่อคำสั่งนั้นไม่ต้องใช้กะ) */
  shiftId: string | null;
};

async function sessionAtScope(scope: BoardGamePosScope, value: unknown): Promise<string> {
  const sessionId = uuid(value, "session บอร์ดเกมไม่ถูกต้อง");
  const locationId = await locationOfBoardGameSession(scope.tenantId, sessionId);
  if (locationId !== scope.locationId) return notFound("ไม่พบ session บอร์ดเกมในสาขานี้");
  return sessionId;
}

async function loanAtScope(scope: BoardGamePosScope, value: unknown): Promise<string> {
  const loanId = uuid(value, "รายการยืมเกมไม่ถูกต้อง");
  const locationId = await locationOfBoardGameLoan(scope.tenantId, loanId);
  if (locationId !== scope.locationId) return notFound("ไม่พบรายการยืมเกมในสาขานี้");
  return loanId;
}

// ---------------------------------------------------------------------------
// ตัวเดินคำสั่ง
// ---------------------------------------------------------------------------

export async function loadBoardGamePosWorkspace(scope: BoardGamePosScope) {
  const [floor, rates, library] = await Promise.all([
    listBoardGameFloor(scope.tenantId, scope.locationId),
    listBoardGameTimeRates(scope.tenantId),
    listBoardGameLibrary(scope.tenantId, scope.locationId),
  ]);
  return { floor, rates, library };
}

export async function loadBoardGamePosSession(scope: BoardGamePosScope, sessionIdInput: unknown) {
  const sessionId = await sessionAtScope(scope, sessionIdInput);
  return callService(() => getBoardGameSession(scope.tenantId, sessionId));
}

export async function loadBoardGamePosCheckout(scope: BoardGamePosScope, sessionIdInput: unknown) {
  const sessionId = await sessionAtScope(scope, sessionIdInput);
  return callService(() =>
    getBoardGameCheckoutForPos(scope.tenantId, scope.locationId, sessionId));
}

/**
 * คำสั่งที่เขียนข้อมูล · ผู้เรียกต้องตรวจ PIN + สิทธิ์ตาม `BOARD_GAME_POS_ACTIONS` มาก่อนแล้ว
 * และต้องส่ง `shiftId` มาให้เมื่อ spec บอกว่าต้องมีกะเปิด
 */
export async function runBoardGamePosMutation(
  scope: BoardGamePosScope,
  actorUserId: string,
  action: BoardGamePosAction,
  input: Record<string, unknown>,
): Promise<unknown> {
  const key = idempotencyKey(input.idempotencyKey);
  switch (action) {
    case "open": {
      if (!scope.shiftId) return badInput("ต้องเปิดกะของเครื่องนี้ก่อน");
      const participants = Array.isArray(input.participants)
        ? input.participants.map(participantDraft)
        : [];
      return callService(() => openBoardGameSession(
        scope.tenantId,
        {
          idempotencyKey: key,
          locationId: scope.locationId,
          tableId: uuid(input.tableId, "โต๊ะบอร์ดเกมไม่ถูกต้อง"),
          billingMode: billingMode(input.billingMode),
          expectedDurationMinutes: input.expectedDurationMinutes == null
            ? null
            : Number(input.expectedDurationMinutes),
          alertBeforeMinutes: Number(input.alertBeforeMinutes ?? 15),
          participants: participants as never,
          posDeviceId: scope.deviceId,
          posShiftId: scope.shiftId,
          note: text(input.note) || null,
        },
        actorUserId,
      ));
    }
    case "participant.add": {
      const sessionId = await sessionAtScope(scope, input.sessionId);
      const draft = participantDraft(input);
      return callService(() => addBoardGameParticipant(
        scope.tenantId,
        { ...draft, sessionId, idempotencyKey: key } as never,
        actorUserId,
      ));
    }
    case "participant.leave": {
      const sessionId = await sessionAtScope(scope, input.sessionId);
      return callService(() => leaveBoardGameParticipant(
        scope.tenantId,
        {
          sessionId,
          participantId: uuid(input.participantId, "ผู้เล่นไม่ถูกต้อง"),
          idempotencyKey: key,
        },
        actorUserId,
      ));
    }
    case "timing": {
      const sessionId = await sessionAtScope(scope, input.sessionId);
      return callService(() => adjustBoardGameSessionTiming(
        scope.tenantId,
        sessionId,
        {
          idempotencyKey: key,
          billingMode: billingMode(input.billingMode),
          expectedDurationMinutes: input.expectedDurationMinutes == null
            ? null
            : Number(input.expectedDurationMinutes),
          alertBeforeMinutes: Number(input.alertBeforeMinutes),
        },
        actorUserId,
      ));
    }
    case "close": {
      if (!scope.shiftId) return badInput("ต้องเปิดกะของเครื่องนี้ก่อน");
      const sessionId = await sessionAtScope(scope, input.sessionId);
      return callService(() => closeBoardGameSessionForBilling(
        scope.tenantId,
        sessionId,
        { idempotencyKey: key, note: text(input.reason) || null },
        actorUserId,
      ));
    }
    case "cancel": {
      const sessionId = await sessionAtScope(scope, input.sessionId);
      // service บังคับเหตุผลอยู่แล้ว แต่ปฏิเสธด้วย throw ธรรมดา — ด่านของ input เป็นงานของชั้นนี้
      const reason = text(input.reason);
      if (!reason) return badInput("ยกเลิก session ต้องระบุเหตุผล");
      return callService(() => cancelBoardGameSession(
        scope.tenantId,
        sessionId,
        { idempotencyKey: key, reason },
        actorUserId,
      ));
    }
    case "copy.checkout": {
      const sessionId = await sessionAtScope(scope, input.sessionId);
      return callService(() => checkoutBoardGameCopy(
        scope.tenantId,
        { sessionId, copyId: uuid(input.copyId, "กล่องเกมไม่ถูกต้อง"), idempotencyKey: key },
        actorUserId,
      ));
    }
    case "copy.return": {
      const loanId = await loanAtScope(scope, input.loanId);
      return callService(() => returnBoardGameCopy(
        scope.tenantId,
        {
          loanId,
          idempotencyKey: key,
          status: text(input.status).toUpperCase() === "ISSUE" ? "ISSUE" : "RETURNED",
          copyStatus: text(input.copyStatus).toUpperCase() || null,
          returnNote: text(input.returnNote) || null,
        },
        actorUserId,
      ));
    }
    default:
      return badInput("คำสั่งบอร์ดเกมไม่ถูกต้อง");
  }
}

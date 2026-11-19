"use client";

import { usePosText, thaiPosText, type PosTranslator } from "@/lib/pos/usePosText";
/**
 * แท็บ "โต๊ะ/เวลา" ของเครื่องขายบนเบราว์เซอร์
 * ------------------------------------------------------------------
 * ก่อนมีไฟล์นี้ ร้านบอร์ดเกมบนเว็บเปิด/ปิดโต๊ะได้ที่ `/admin/board-game` เท่านั้น แล้วส่งบิล
 * มาที่ `/pos?boardGameBillingGroupId=...` · แปลว่าบัญชี `pos_only` (ซึ่งถูกปฏิเสธตั้งแต่ตอน
 * login ของหลังบ้าน) **เปิดโต๊ะไม่ได้เลย** ทั้งที่การเปิดโต๊ะคือสิ่งที่ร้านแบบนี้ทำบ่อยที่สุด
 * แอป RN มีแท็บนี้อยู่แล้ว — ไฟล์นี้คือฝั่งเบราว์เซอร์ของงานเดียวกัน
 *
 * ทุกคำสั่งยิง `/api/pos/board-game` ซึ่งเรียก `lib/bms/boardGamePosOperations.ts` ตัวเดียว
 * กับที่ GraphQL ของ RN เรียก — สิทธิ์ ด่านสาขา และการแปลง input จึงมีชุดเดียว
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CloseOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLiveRefresh, usePageVisible } from '@/app/hooks/useLiveRefresh';
import { describeAgo, feedHealth } from '@/lib/pos/orderAlertSound';
import { copyTextToClipboard } from '@/lib/pos/clipboard';
import PosDismissibleAlert from '@/components/pos/PosDismissibleAlert';
import BoardGameCopyPicker from '@/components/pos/BoardGameCopyPicker';
import { useI18n } from '@/lib/i18nContext';
import type { PosServiceCallNotice } from '@/components/pos/PosWorkspaceContext';
import { usePosStartupPreparation } from '@/components/pos/PosStartupPreparation';

type Props = {
  token: string;
  cashierUserId: string;
  pin: string;
  /** Desktop content-refresh signal; omitted by browser and legacy callers. */
  refreshSignal?: number;
  /**
   * ส่งบิลเวลาเล่นที่ปิดแล้วไปให้แท็บขายเก็บเงิน — เส้นเดียวกับที่ `/admin/board-game` ใช้
   *
   * ส่ง **id ของกลุ่มบิล** ไม่ใช่ของโต๊ะ (`9.89`): โต๊ะที่แยกกลุ่มมีบิลรออยู่หลายใบพร้อมกัน
   * การส่ง id ของโต๊ะไปจึงตอบไม่ได้ว่าแท็บขายต้องเก็บเงินใบไหน
   */
  onCheckout: (billingGroupId: string) => void;
  onServiceCallsChange?: (calls: PosServiceCallNotice[]) => void;
};

type SessionSummary = {
  id: string;
  seatingId: string | null;
  sessionIds: string[] | null;
  sessionCount: number | null;
  status: string;
  billingMode: string;
  guestCount: number;
  startedAt: string | null;
  expectedEndAt: string | null;
  nextAlertAt: string | null;
  alertStatus: string;
  amountDue: number;
  billingGroupCount: number;
  awaitingPaymentCount: number;
};

type TabItem = {
  id: string; sku: string; productName: string; size: string;
  packCode: string | null; unitName: string | null; packQty: number;
  modifierNames: string[]; note: string | null; addedAt: string | null;
};

type BillingGroup = {
  id: string;
  groupNo: number;
  status: string;
  /** ค่าเล่นที่แช่ไว้ตอนปิด — ยังเล่นอยู่จะเป็น 0 */
  amountDue: number;
  /** ยอดของที่สั่งเข้าบิลระหว่างเล่น (`9.90`) */
  tabAmount: number;
  endedAt: string | null;
  currentOrderId: string | null;
  chargeSnapshot: Array<{
    participantId: string; displayName: string | null; participantType: string;
    rateCode: string | null; rateName: string | null;
    joinedAt: string | null; actualEndedAt: string | null; chargedUntil: string | null;
    actualMinutes: number | null; billableMinutes: number; hourlyRate: number;
    amount: number; grossAmount: number | null; coveredAmount: number | null;
    offerDiscountAmount: number | null;
  }>;
  tabItems: TabItem[];
};
type Table = {
  id: string; areaId: string; code: string; name: string;
  seats: number; sortOrder: number; blocked: boolean;
  openSession: SessionSummary | null;
};
type Area = { id: string; name: string; sortOrder: number };
type Rate = {
  id: string; code: string; name: string; customerType: string;
  pricePerHour: number; minimumMinutes: number; roundingMinutes: number;
  graceMinutes: number; active: boolean; sortOrder: number;
};
type Copy = { id: string; locationId: string; copyCode: string; status: string; conditionNote: string | null };
type Title = { id: string; title: string; imageUrl?: string | null; copies: Copy[] };
type ServiceCall = {
  id: string; sessionId: string; tableCode: string; tableName: string;
  requestCode: string; requestNote: string | null; status: 'PENDING' | 'ACKNOWLEDGED';
  createdAt: string;
};
type WaitlistEntry = {
  id: string; kind: 'WALK_IN' | 'RESERVATION'; serviceDate: string;
  queueNo: number | null; status: string; partySize: number;
  guestName: string | null; guestPhone: string | null; guestEmail: string | null; note: string | null;
  preferredAreaId: string | null; preferredAreaName: string | null;
  reservedFor: string | null; reservedDurationMinutes: number | null;
  reservedTableId: string | null; reservedTableCode: string | null;
  confirmedAt: string | null; checkedInAt: string | null;
  source: 'STAFF' | 'PUBLIC' | 'CHAT'; reviewedAt: string | null; rejectionReason: string | null;
  reminderStatus: string; reminderSentAt: string | null;
  decisionNotificationStatus: string; depositPolicy: string; depositAmount: number;
  depositStatus: string; depositDueAt: string | null; depositRefundEligibleUntil: string | null;
  seatedTableId: string | null; seatedTableCode: string | null; seatedSessionId: string | null;
  calledAt: string | null; seatedAt: string | null; closedAt: string | null; createdAt: string;
};
type Waitlist = {
  entries: WaitlistEntry[]; waitingCount: number; calledCount: number;
  confirmedReservationCount: number; requestedReservationCount: number;
  waitingGuests: number; longestWaitMinutes: number;
  tables: Array<{ id: string; areaId: string; code: string; name: string; seats: number;
    availability: string; expectedAvailableAt: string | null;
    nextReservedAt: string | null; nextReservedUntil: string | null }>;
};
type Workspace = {
  floor: { areas: Area[]; tables: Table[] };
  rates: Rate[];
  library: Title[];
  serviceCalls: ServiceCall[];
  waitlist: Waitlist;
};

type Participant = {
  id: string; displayName: string | null; participantType: string; billable: boolean;
  rateCode: string | null; rateName: string | null;
  hourlyRate: number; billingGroupNo: number; billingGroupId: string;
  billingGroupStatus: string; joinedAt: string | null; leftAt: string | null;
  timeMode: 'ACTUAL' | 'SESSION_END' | 'DURATION'; plannedEndAt: string | null;
};
type Loan = {
  id: string; copyId: string; copyCode: string | null; title: string | null;
  status: string; checkedOutAt: string | null; returnedAt: string | null;
};
/**
 * บัตรที่ร้านถือไว้ค้ำกล่องเกม (`9.93`) — **ไม่มีเลขเต็มในรูปนี้โดยตั้งใจ** จอเครื่องขายหันออก
 * ทางลูกค้า มีแต่สี่ตัวท้ายไว้หาบัตรใบที่ถูกในลิ้นชัก · การอ่านเลขกลับออกมาอยู่หลังบ้านอย่างเดียว
 */
type IdentityHold = {
  id: string; loanId: string | null; documentKind: string;
  holderName: string | null; documentNumberTail: string | null; hasDocumentNumber: boolean;
  status: 'HELD' | 'RETURNED'; note: string | null;
  takenAt: string; returnedAt: string | null;
};
type SessionDetail = {
  id: string; status: string; billingMode: string; guestCount: number;
  startedAt: string | null; expectedEndAt: string | null; nextAlertAt: string | null; endedAt: string | null;
  alertBeforeMinutes: number; alertStatus: string; amountDue: number;
  tableId: string;
  originTableId: string;
  originTableCode: string;
  originTableName: string;
  seatingId: string;
  billingGroups: BillingGroup[];
  participants: Participant[]; games: Loan[];
  identityHolds: IdentityHold[];
};

type Member = { customerId: string; name: string | null; phone: string | null; memberNo: string | null };

type Draft = {
  key: string;
  customerId: string | null;
  memberNo: string | null;
  displayName: string;
  rateId: string;
  billingGroupNo: number;
  timeMode: 'ACTUAL' | 'SESSION_END' | 'DURATION';
  purchasedDurationMinutes: number | null;
};

type FloorFilter = 'ALL' | 'AVAILABLE' | 'PLAYING' | 'ATTENTION' | 'PAYING';

/**
 * ป้ายชนิดเอกสาร — ลิสต์เดียวกับ `BOARD_GAME_IDENTITY_KINDS` ของ service · ชนิดที่ server
 * ไม่รู้จักถูกแสดงเป็นรหัสดิบแทนการซ่อน เพราะบัตรที่ไม่มีป้ายคือบัตรที่หาไม่เจอในลิ้นชัก
 */
const IDENTITY_KIND_LABEL = (posText: PosTranslator = thaiPosText): Record<string, string> => ({
  NATIONAL_ID: posText("บัตรประชาชน"),
  STUDENT_ID: posText("บัตรนักเรียน/นักศึกษา"),
  DRIVER_LICENSE: posText("ใบขับขี่"),
  PASSPORT: posText("พาสปอร์ต"),
  OTHER: posText("อื่น ๆ"),
});

const PARTICIPANT_TYPE_LABEL = (posText: PosTranslator = thaiPosText): Record<string, string> => ({
  GENERAL: posText("ทั่วไป"),
  STUDENT: posText("นักเรียน/นักศึกษา"),
  MEMBER: posText("สมาชิก"),
  CHILD: posText("เด็ก"),
  GUARDIAN: posText("ผู้ปกครอง"),
  OBSERVER: posText("ผู้สังเกตการณ์"),
  FOOD_ONLY: posText("อาหารและเครื่องดื่มเท่านั้น"),
  CUSTOM: posText("อัตราพิเศษ"),
});

function baht(value: number) {
  return (Math.round((Number(value) || 0) * 100) / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function elapsedLabel(startedAt: string | null | undefined, now: number, posText: PosTranslator = thaiPosText) {
  if (!startedAt) return '-';
  const minutes = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? posText("{v0} ชม. {v1} น.", { v0: hours, v1: minutes % 60 }) : posText("{v0} นาที", { v0: minutes });
}

function minutesLabel(value: number | null | undefined, posText: PosTranslator = thaiPosText) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  if (hours <= 0) return posText("{v0} นาที", { v0: minutes });
  return minutes % 60 ? posText("{v0} ชม. {v1} นาที", { v0: hours, v1: minutes % 60 }) : posText("{v0} ชม.", { v0: hours });
}

function durationBetweenLabel(startedAt: string | null | undefined, endedAt: string | null | undefined, now: number, posText: PosTranslator = thaiPosText) {
  if (!startedAt) return '-';
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '-';
  return minutesLabel(Math.max(0, Math.floor((end - start) / 60_000)), posText);
}

function rateLabel(participant: Pick<Participant, 'rateName' | 'participantType' | 'billable' | 'hourlyRate'>, posText: PosTranslator = thaiPosText) {
  if (!participant.billable) return posText("ไม่คิดเงิน");
  const name = participant.rateName || PARTICIPANT_TYPE_LABEL(posText)[participant.participantType] || participant.participantType;
  return posText("{v0} · ฿{v1}/ชม.", { v0: name, v1: baht(participant.hourlyRate) });
}

function timeLabel(value: string | null | undefined) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '-';
  return parsed.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function localDateInput(value: string | Date | null | undefined) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function localTimeInput(value: string | Date | null | undefined) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function dateFromInput(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 12);
  return Number.isFinite(date.getTime()) ? date : null;
}

function calendarMonthLabel(value: string, posText: PosTranslator = thaiPosText) {
  const date = dateFromInput(`${value}-01`);
  return date?.toLocaleDateString(posText.locale, { month: 'long', year: 'numeric' }) ?? posText("กำลังเตรียมปฏิทิน");
}

function calendarDateLabel(value: string, posText: PosTranslator = thaiPosText) {
  const date = dateFromInput(value);
  return date?.toLocaleDateString(posText.locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) ?? posText("เลือกวันที่");
}

function reservationDateKey(entry: Pick<WaitlistEntry, 'serviceDate' | 'reservedFor'>) {
  // Older servers returned PostgreSQL DATE through String(date).slice(0, 10), e.g. "Sun Sep 20".
  // Fall back to the authoritative reservation instant so the calendar still exposes the booking
  // while a rolling deployment has a mixture of old and new server processes.
  return /^\d{4}-\d{2}-\d{2}$/.test(entry.serviceDate)
    ? entry.serviceDate
    : localDateInput(entry.reservedFor);
}

function shiftCalendarMonth(value: string, amount: number) {
  const date = dateFromInput(`${value}-01`) ?? new Date();
  date.setMonth(date.getMonth() + amount, 1);
  return localDateInput(date).slice(0, 7);
}

function calendarDays(value: string) {
  const first = dateFromInput(`${value}-01`);
  if (!first) return [];
  const startOffset = (first.getDay() + 6) % 7; // จันทร์เป็นวันแรกเหมือนปฏิทินไทยหน้าร้าน
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
  const cellCount = Math.ceil((startOffset + last.getDate()) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), index - startOffset + 1, 12);
    return {
      key: localDateInput(date),
      day: date.getDate(),
      inMonth: date.getMonth() === first.getMonth(),
    };
  });
}

function detailStatusLabel(session: SessionDetail, now: number, posText: PosTranslator = thaiPosText) {
  if (session.status !== 'OPEN' || !session.nextAlertAt) return tableStateLabel(session, posText);
  const remaining = Math.ceil((new Date(session.nextAlertAt).getTime() - now) / 60_000);
  if (!Number.isFinite(remaining)) return tableStateLabel(session, posText);
  if (remaining < 0) return posText("เกินเวลา · {v0} นาที", { v0: Math.abs(remaining) });
  if (session.alertStatus === 'ENDING_SOON') return posText("ใกล้หมดเวลา · เหลือ {v0} นาที", { v0: remaining });
  return posText("กำลังเล่น · เหลือ {v0} นาที", { v0: remaining });
}

function attentionLabel(session: Pick<SessionSummary, 'nextAlertAt' | 'alertStatus'>, now: number, posText: PosTranslator = thaiPosText) {
  if (!session.nextAlertAt) return alertLabel(session.alertStatus, posText);
  const remainingMs = new Date(session.nextAlertAt).getTime() - now;
  if (!Number.isFinite(remainingMs)) return alertLabel(session.alertStatus, posText);
  return remainingMs <= 0
    ? posText("เกิน {v0} นาที", { v0: Math.max(1, Math.ceil(Math.abs(remainingMs) / 60_000)) })
    : posText("เหลือ {v0} นาที", { v0: Math.ceil(remainingMs / 60_000) });
}

/**
 * นาทีที่ลูกค้าซื้อไว้ — คิดจากช่วง เริ่ม→สิ้นสุดที่คาด เพราะ server เก็บเป็นเวลาสิ้นสุด
 * ไม่ใช่จำนวนนาที · สูตรเดียวกับปุ่ม "เพิ่มเวลา 30 นาที" ของแอป RN
 */
function plannedMinutes(session: { startedAt: string | null; expectedEndAt: string | null } | null) {
  if (!session?.startedAt || !session.expectedEndAt) return 0;
  const start = new Date(session.startedAt).getTime();
  const end = new Date(session.expectedEndAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(1, Math.round((end - start) / 60000));
}

function alertLabel(status: string | null | undefined, posText: PosTranslator = thaiPosText) {
  if (status === 'OVERDUE') return posText("เกินเวลา");
  if (status === 'ENDING_SOON') return posText("ใกล้หมดเวลา");
  return posText("กำลังเล่น");
}

function serviceCallLabel(code: string, posText: PosTranslator = thaiPosText) {
  return ({
    GAME_HELP: posText("ช่วยสอนเกม"),
    GAME_ISSUE: posText("ชิ้นส่วนขาด / เกมชำรุด"),
    FOOD_DRINK: posText("อาหารหรือเครื่องดื่ม"),
    BILL: posText("ขอคิดเงิน"),
    EXTEND_TIME: posText("ขอต่อเวลา"),
    CLEANUP: posText("น้ำหก / ทำความสะอาด"),
    OTHER: posText("อื่น ๆ"),
  } as Record<string, string>)[code] ?? code;
}

/**
 * โต๊ะที่ปิดเวลาแล้วยังไม่ได้เก็บเงินคือโต๊ะที่ยังว่างไม่ได้ แต่ก็ไม่ได้เล่นอยู่ — ป้าย
 * "กำลังเล่น" บนโต๊ะที่ครัวเรียกเก็บเงินไปแล้วคือสิ่งที่ทำให้พนักงานเดินไปถามลูกค้าผิดเรื่อง
 */
function tableStateLabel(session: { status: string; alertStatus: string } | null, posText: PosTranslator = thaiPosText) {
  if (!session) return posText("ว่าง");
  if (session.status === 'CLOSING') return posText("รอเก็บเงิน");
  // โต๊ะที่จบไปแล้วยังค้างบนจอได้ — อีกเครื่องเก็บเงิน/ยกเลิกระหว่างที่การ์ดเปิดอยู่ ·
  // ถ้าปล่อยตกไป alertLabel() มันจะอ่านว่า "กำลังเล่น" ซึ่งเป็นคำตอบที่ผิดที่สุดที่จะให้
  if (session.status === 'PAID') return posText("เก็บเงินแล้ว");
  if (session.status === 'CANCELLED') return posText("ยกเลิกแล้ว");
  return alertLabel(session.alertStatus, posText);
}

/** โต๊ะที่จบแล้ว — ไม่มีอะไรให้สั่งต่อ มีแต่ให้ปิดการ์ดทิ้ง */
function isTerminalSession(status: string) {
  return status === 'PAID' || status === 'CANCELLED';
}

function matchesFloorFilter(table: Table, filter: FloorFilter) {
  const open = table.openSession;
  if (filter === 'AVAILABLE') return !table.blocked && !open;
  if (filter === 'PLAYING') return open?.status === 'OPEN';
  if (filter === 'ATTENTION') return Boolean(open && open.alertStatus !== 'NORMAL');
  if (filter === 'PAYING') return Boolean(open && (
    open.status === 'CLOSING' || open.awaitingPaymentCount > 0
  ));
  return true;
}

/**
 * เงินของโต๊ะที่ "ตั้งไว้แล้วจริง ๆ" แยกจากเวลาที่ยังเดินอยู่
 *
 * ⚠️ `amount_due` ของกลุ่มบิลคือ **ค่าเล่นที่ถูกแช่ไว้ตอนปิดบิล** (`9.89` เขียนกฎนี้ไว้เอง
 * และเส้นเดียวที่เขียนคอลัมน์นี้คือ `closeOpenBillingGroupInTx`) กลุ่มที่ยังเล่นอยู่จึงเป็น
 * 0 เสมอ — 0 ที่แปลว่า "ยังไม่ถูกแช่" ไม่ใช่ "ไม่ติดเงิน"
 *
 * การพิมพ์เลขนั้นออกมาตรง ๆ บนโต๊ะที่เล่นมาสองชั่วโมงคือการบอกพนักงานว่าโต๊ะนี้ไม่ติดอะไร ·
 * `/admin/board-game` แสดงยอดเฉพาะตอน CLOSING และแอป RN ก็ทำแบบเดียวกัน — จอนี้เคยเป็น
 * ที่เดียวที่ยังพิมพ์ทุกสถานะ
 */
function moneySoFar(groups: Array<{ status: string; amountDue: number; tabAmount: number }>) {
  let settled = 0;
  let openTab = 0;
  let stillPlaying = false;
  for (const group of groups) {
    if (group.status === 'CANCELLED') continue;
    if (group.status === 'OPEN') {
      stillPlaying = true;
      openTab += Number(group.tabAmount) || 0;
    } else if (group.status === 'CLOSING') {
      settled += (Number(group.amountDue) || 0) + (Number(group.tabAmount) || 0);
    }
  }
  return { settled, openTab, stillPlaying };
}

/** ป้ายสถานะสายข้อมูล — คำและสีมาจากกฎเดียวกับจอครัว/จอร้านอาหาร */
function feedTone(health: 'LIVE' | 'SLOW' | 'STALE') {
  return health === 'STALE' ? 'pos-bg-feed--stale' : health === 'SLOW' ? 'pos-bg-feed--slow' : '';
}

/**
 * `crypto.randomUUID` มีเฉพาะ secure context (HTTPS/localhost) — เครื่องขายบางร้านเปิดผ่าน
 * IP ในวง LAN · คีย์กันรายการซ้ำที่สร้างไม่ได้แปลว่ากดไม่ได้เลย จึงต้องมีทางถอย
 */
function newKey() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* ignore */ }
  return `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function BoardGamePanel({ token, cashierUserId, pin, refreshSignal = 0, onCheckout, onServiceCallsChange }: Props) {
  const posText = usePosText();
  const { t } = useI18n();
  const { takeBoardGameWorkspace } = usePosStartupPreparation();
  const ready = Boolean(token && cashierUserId && pin);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceLoadError, setWorkspaceLoadError] = useState('');
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [sessionLoadingId, setSessionLoadingId] = useState('');
  const sessionRequestVersion = useRef(0);
  const [sharedSessionDetails, setSharedSessionDetails] = useState<Record<string, SessionDetail>>({});
  const [sharedSessionsLoading, setSharedSessionsLoading] = useState(false);
  const [sharedSessionsError, setSharedSessionsError] = useState('');
  const sharedSessionsRequestVersion = useRef(0);
  /**
   * ⚠️ `run()` ถูกประกาศใหม่ทุก render จึงปิดทับ `selectedId` **ของ render นั้น** ·
   * callback `after` ที่ล้างการเลือก (ยกเลิกโต๊ะ) จึงถูกทับทันทีด้วยการโหลด session
   * ตัวเดิมกลับมาในบรรทัดถัดไป = การ์ดของโต๊ะที่เพิ่งยกเลิกเด้งกลับขึ้นจอ พร้อมป้าย
   * "กำลังเล่น" และฟอร์มยกเลิกที่กดแล้วล้มซ้ำ
   *
   * ref คือความจริงของ "ตอนนี้กำลังดูโต๊ะไหน" ส่วน state มีไว้ให้ React วาดใหม่เท่านั้น —
   * ทุกที่ที่ **ตัดสินใจ** ต้องอ่าน ref ไม่ใช่ state
   */
  const selectedIdRef = useRef('');
  const [openingTable, setOpeningTable] = useState<Table | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [floorFilter, setFloorFilter] = useState<FloorFilter>('ALL');
  const [detailTab, setDetailTab] = useState<'overview' | 'tab' | 'games'>('overview');
  const [showCloseChoices, setShowCloseChoices] = useState(false);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const closeChoicesRef = useRef<HTMLDivElement | null>(null);
  const addParticipantRef = useRef<HTMLDivElement | null>(null);
  const [guestLink, setGuestLink] = useState('');
  const [guestLinkOpen, setGuestLinkOpen] = useState(false);
  const [guestQrImage, setGuestQrImage] = useState('');
  const [guestLinkCopyState, setGuestLinkCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [queuePartySize, setQueuePartySize] = useState('2');
  const [queueGuestName, setQueueGuestName] = useState('');
  const [queueGuestPhone, setQueueGuestPhone] = useState('');
  const [seatingQueueId, setSeatingQueueId] = useState('');
  const [reservationPartySize, setReservationPartySize] = useState('2');
  const [reservationGuestName, setReservationGuestName] = useState('');
  const [reservationGuestPhone, setReservationGuestPhone] = useState('');
  const [reservationTime, setReservationTime] = useState('');
  const [reservationDuration, setReservationDuration] = useState('120');
  const [reservationTableId, setReservationTableId] = useState('');
  const [reservationEditingId, setReservationEditingId] = useState('');
  const [reservationEditorOpen, setReservationEditorOpen] = useState(false);
  const [reservationSearch, setReservationSearch] = useState('');
  const [reservationDate, setReservationDate] = useState('');
  const [reservationMonth, setReservationMonth] = useState('');
  const [reviewTableByEntry, setReviewTableByEntry] = useState<Record<string, string>>({});

  // ฟอร์มเปิดโต๊ะ
  const [billingMode, setBillingMode] = useState<'OPEN_ENDED' | 'FIXED_DURATION'>('OPEN_ENDED');
  const [duration, setDuration] = useState('120');
  const [alertBefore, setAlertBefore] = useState('15');
  const [note, setNote] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftName, setDraftName] = useState('');
  const [draftRateId, setDraftRateId] = useState('');
  const [draftGroup, setDraftGroup] = useState('1');
  const [draftTimeMode, setDraftTimeMode] = useState<'ACTUAL' | 'SESSION_END' | 'DURATION'>('ACTUAL');
  const [draftPersonalMinutes, setDraftPersonalMinutes] = useState('60');
  const [memberQuery, setMemberQuery] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [memberSearchStatus, setMemberSearchStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [memberSearchError, setMemberSearchError] = useState('');
  const [memberSearchAttempt, setMemberSearchAttempt] = useState(0);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  // ฟอร์มในหน้า session
  const [planMinutes, setPlanMinutes] = useState('');
  const [planAlert, setPlanAlert] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [copyId, setCopyId] = useState('');
  const [returnLoanId, setReturnLoanId] = useState('');
  const [returnNote, setReturnNote] = useState('');
  // สั่งของเข้าบิลระหว่างเล่น (`9.90`) — ต่อกลุ่ม เพราะแต่ละกลุ่มจ่ายคนละใบ
  const [tabGroupId, setTabGroupId] = useState('');
  const [tabSku, setTabSku] = useState('');
  const [tabQty, setTabQty] = useState('1');
  const [seatingTargetId, setSeatingTargetId] = useState('');
  const [detachGroupId, setDetachGroupId] = useState('');
  const [detachTargetId, setDetachTargetId] = useState('');
  const [detachLoanIds, setDetachLoanIds] = useState<string[]>([]);
  const [detachHoldIds, setDetachHoldIds] = useState<string[]>([]);
  const [idKind, setIdKind] = useState('NATIONAL_ID');
  const [idHolder, setIdHolder] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [idLoanId, setIdLoanId] = useState('');

  /**
   * คีย์กันรายการซ้ำ "ต่อเจตนา" ไม่ใช่ต่อการกด — เน็ตร้านหลุดกลางทางแล้วกดใหม่ต้องเป็น
   * คำสั่งเดิม · ทิ้งคีย์เมื่อ server ตัดสินไปแล้วเท่านั้น (4xx) เพราะครั้งหน้าคือเจตนาใหม่
   */
  const keys = useRef<Record<string, string>>({});
  const keyFor = (name: string) => (keys.current[name] ??= newKey());
  const dropKey = (name: string) => { delete keys.current[name]; };

  const pageVisible = usePageVisible();

  const selectTable = useCallback((sessionId: string) => {
    if (selectedIdRef.current !== sessionId) {
      // เปลี่ยน selection ต้องทำให้รายละเอียดเก่าหายจากจอทันที ไม่เช่นนั้นช่วงที่ request ใหม่
      // ยังไม่ตอบ ปุ่มยืมเกม/รับบัตรจะยังยิงด้วย session ของโต๊ะก่อนหน้าได้
      sessionRequestVersion.current += 1;
      sharedSessionsRequestVersion.current += 1;
      setSession(null);
      setSessionLoadingId(sessionId);
      setSharedSessionDetails({});
      setSharedSessionsLoading(false);
      setSharedSessionsError('');
      setCopyId('');
      setReturnLoanId('');
      setReturnNote('');
      setIdLoanId('');
      setSeatingTargetId('');
      setDetachGroupId('');
      setDetachTargetId('');
      setDetachLoanIds([]);
      setDetachHoldIds([]);
      // Guest access belongs to a session. Never leave the previous table's QR visible after the
      // operator selects another table, even though the old URL remains valid for that old session.
      setGuestLink('');
      setGuestQrImage('');
      setGuestLinkOpen(false);
      setGuestLinkCopyState('idle');
    }
    selectedIdRef.current = sessionId;
    setSelectedId(sessionId);
  }, []);

  useEffect(() => {
    if (!guestLink) {
      setGuestQrImage('');
      return;
    }
    let active = true;
    setGuestQrImage('');
    void QRCode.toDataURL(guestLink, {
      width: 520,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#111827ff', light: '#ffffffff' },
    }).then((dataUrl) => {
      if (active) setGuestQrImage(dataUrl);
    }).catch(() => {
      if (active) setGuestQrImage('');
    });
    return () => { active = false; };
  }, [guestLink]);

  useEffect(() => {
    if (!guestLinkOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGuestLinkOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [guestLinkOpen]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const today = localDateInput(new Date());
    setReservationDate((current) => current || today);
    setReservationMonth((current) => current || today.slice(0, 7));
  }, []);

  const call = useCallback(async (
    action: string,
    payload: Record<string, unknown> = {},
    signal?: AbortSignal,
  ) => {
    if (action === 'workspace' && Object.keys(payload).length === 0) {
      const prepared = takeBoardGameWorkspace(token, cashierUserId);
      if (prepared !== undefined) return prepared as Record<string, any>;
    }
    const response = await fetch('/api/pos/board-game', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pos-device-token': token },
      body: JSON.stringify({ action, cashierUserId, pin, ...payload }),
      cache: 'no-store',
      signal,
    });
    const data = await response.json().catch(() => ({} as Record<string, unknown>));
    if (!response.ok) {
      const message = typeof data?.error === 'string' && data.error ? data.error : posText("ทำรายการไม่สำเร็จ");
      // 4xx = server ตัดสินแล้ว · 5xx/เน็ตหลุด = ไม่รู้ผล ต้องถือคีย์เดิมไว้ยิงซ้ำ
      throw Object.assign(new Error(message), { decided: response.status < 500 });
    }
    return data as Record<string, any>;
  }, [posText, cashierUserId, pin, takeBoardGameWorkspace, token]);

  const loadWorkspace = useCallback(async (signal?: AbortSignal) => {
    const data = await call('workspace', {}, signal);
    const next = data as unknown as Workspace;
    setWorkspace(next);
    setWorkspaceLoadError('');
    onServiceCallsChange?.(next.serviceCalls.map((item) => ({ ...item, source: 'boardgame' })));
  }, [call, onServiceCallsChange]);

  const loadSession = useCallback(async (sessionId: string, signal?: AbortSignal) => {
    if (!sessionId) {
      sessionRequestVersion.current += 1;
      setSession(null);
      setSessionLoadingId('');
      return;
    }
    const requestVersion = ++sessionRequestVersion.current;
    if (selectedIdRef.current === sessionId) setSessionLoadingId(sessionId);
    try {
      const data = await call('session', { sessionId }, signal);
      const next = (data.session ?? null) as SessionDetail | null;
      if (next && next.id !== sessionId) throw new Error(posText("ข้อมูลโต๊ะที่ตอบกลับไม่ตรงกับโต๊ะที่เลือก"));
      // request ของโต๊ะก่อนหน้าอาจตอบช้ากว่าหลังผู้ใช้สลับโต๊ะแล้ว — ห้ามให้มันทับจอใหม่
      if (requestVersion !== sessionRequestVersion.current || selectedIdRef.current !== sessionId) return;
      setSession(next);
    } finally {
      if (requestVersion === sessionRequestVersion.current && selectedIdRef.current === sessionId) {
        setSessionLoadingId('');
      }
    }
  }, [posText, call]);

  const feed = useLiveRefresh({
    enabled: ready,
    intervalMs: pageVisible ? 10_000 : 60_000,
    onRefresh: async (signal) => {
      try {
        await loadWorkspace(signal);
      } catch (cause) {
        if (!signal.aborted) {
          setWorkspaceLoadError(cause instanceof Error ? cause.message : posText("โหลดผังโต๊ะไม่สำเร็จ"));
        }
        throw cause;
      }
      const open = selectedIdRef.current;
      if (open) await loadSession(open, signal);
    },
  });

  const handledRefreshSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === handledRefreshSignal.current) return;
    handledRefreshSignal.current = refreshSignal;
    feed.refreshNow();
  }, [feed.refreshNow, refreshSignal]);

  useEffect(() => {
    if (!ready || !selectedId) return;
    void loadSession(selectedId).catch((e) => setError(e instanceof Error ? e.message : posText("โหลดโต๊ะไม่สำเร็จ")));
  }, [ready, selectedId, loadSession]);

  useEffect(() => {
    setDetailTab('overview');
    setShowCloseChoices(false);
    setShowAddParticipant(false);
  }, [selectedId, openingTable?.id]);

  useEffect(() => {
    if (!showCloseChoices) return;
    closeChoicesRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [showCloseChoices]);

  useEffect(() => {
    if (!showAddParticipant) return;
    addParticipantRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [showAddParticipant]);

  // ฟอร์มเวลาเริ่มจากค่าที่ server ถืออยู่จริง · deps เป็น "ค่า" ไม่ใช่ object ของ session
  // รอบ poll ที่ได้ค่าเดิมจึงไม่ลบตัวเลขที่คนหน้าเครื่องกำลังพิมพ์ทิ้งกลางคัน
  useEffect(() => {
    if (!session) return;
    setPlanMinutes(String(plannedMinutes(session) || 120));
    setPlanAlert(String(session.alertBeforeMinutes ?? 15));
  }, [session?.id, session?.billingMode, session?.expectedEndAt, session?.alertBeforeMinutes]);

  // ค้นสมาชิกใช้ route เดิมของเครื่องขาย (ต้องพิมพ์อย่างน้อย 3 ตัวอักษรตามด่านของ route นั้น)
  useEffect(() => {
    const q = memberQuery.trim();
    setMembers([]);
    setMemberSearchError('');
    if (!ready || !openingTable || q.length < 3) { setMemberSearchStatus('idle'); return; }
    const controller = new AbortController();
    setMemberSearchStatus('loading');
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/pos/member?q=${encodeURIComponent(q)}`, {
            headers: { 'x-pos-device-token': token },
            cache: 'no-store',
            signal: controller.signal,
          });
          const data = await response.json().catch(() => null);
          if (!response.ok || !Array.isArray(data?.members)) {
            throw new Error(response.status === 401
              ? posText("การเชื่อมต่อเครื่องขายหมดอายุ กรุณาเชื่อมต่อเครื่องใหม่")
              : posText("ค้นหาสมาชิกไม่สำเร็จ กรุณาลองอีกครั้ง"));
          }
          // A superseded request must not restore a result from the previous query or table.
          if (controller.signal.aborted) return;
          setMembers(data.members);
          setMemberSearchStatus('success');
        } catch (cause) {
          if (controller.signal.aborted) return;
          setMemberSearchError(cause instanceof Error ? cause.message : posText("ค้นหาสมาชิกไม่สำเร็จ กรุณาลองอีกครั้ง"));
          setMemberSearchStatus('error');
        }
      })();
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [memberQuery, ready, token, openingTable?.id, memberSearchAttempt]);

  const rates = useMemo(
    () => (workspace?.rates ?? []).filter((rate) => rate.active),
    [workspace],
  );
  const areaName = useMemo(() => {
    const map = new Map<string, string>();
    for (const area of workspace?.floor.areas ?? []) map.set(area.id, area.name);
    return map;
  }, [workspace]);
  const tablesByArea = useMemo(() => {
    const groups = new Map<string, Table[]>();
    for (const table of workspace?.floor.tables ?? []) {
      const list = groups.get(table.areaId) ?? [];
      list.push(table);
      groups.set(table.areaId, list);
    }
    return groups;
  }, [workspace]);
  const attention = useMemo(
    () => (workspace?.floor.tables ?? [])
      .filter((table) => table.openSession && table.openSession.alertStatus !== 'NORMAL')
      .sort((left, right) => {
        const leftStatus = left.openSession?.alertStatus === 'OVERDUE' ? 0 : 1;
        const rightStatus = right.openSession?.alertStatus === 'OVERDUE' ? 0 : 1;
        if (leftStatus !== rightStatus) return leftStatus - rightStatus;
        return new Date(left.openSession?.nextAlertAt ?? 0).getTime()
          - new Date(right.openSession?.nextAlertAt ?? 0).getTime();
      }),
    [workspace],
  );
  const overdueCount = attention.filter((table) => table.openSession?.alertStatus === 'OVERDUE').length;
  const endingSoonCount = attention.length - overdueCount;
  const activeTable = session
    ? (workspace?.floor.tables ?? []).find((table) => table.id === session.tableId) ?? null
    : null;
  const activeSeating = activeTable?.openSession ?? null;
  const sharedSessionKey = (activeSeating?.sessionIds ?? (session ? [session.id] : [])).join('|');

  // หลังรวมโต๊ะ loan ยังเป็นของ session เดิม จึงต้องอ่านรายละเอียดของทุก session ที่แชร์
  // seating เดียวกัน ไม่ใช่ตีความรายละเอียดของ session แรกว่าเป็นทรัพย์สินทั้งโต๊ะ
  useEffect(() => {
    const ids = sharedSessionKey ? sharedSessionKey.split('|') : [];
    if (!session || ids.length <= 1) {
      sharedSessionsRequestVersion.current += 1;
      setSharedSessionDetails(session ? { [session.id]: session } : {});
      setSharedSessionsLoading(false);
      setSharedSessionsError('');
      return;
    }

    const requestVersion = ++sharedSessionsRequestVersion.current;
    let cancelled = false;
    setSharedSessionDetails((current) => ({ ...current, [session.id]: session }));
    setSharedSessionsLoading(true);
    setSharedSessionsError('');
    void Promise.all(ids.map(async (id) => {
      if (id === session.id) return session;
      const data = await call('session', { sessionId: id });
      const detail = (data.session ?? null) as SessionDetail | null;
      if (!detail || detail.id !== id) throw new Error(posText("โหลดข้อมูลชุดลูกค้าที่รวมโต๊ะไม่ครบ"));
      return detail;
    })).then((details) => {
      if (cancelled || requestVersion !== sharedSessionsRequestVersion.current) return;
      setSharedSessionDetails(Object.fromEntries(details.map((detail) => [detail.id, detail])));
    }).catch((cause) => {
      if (cancelled || requestVersion !== sharedSessionsRequestVersion.current) return;
      setSharedSessionsError(cause instanceof Error ? cause.message : posText("โหลดเกมของโต๊ะที่รวมกันไม่ครบ"));
    }).finally(() => {
      if (!cancelled && requestVersion === sharedSessionsRequestVersion.current) {
        setSharedSessionsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [call, session, sharedSessionKey]);

  async function run(
    name: string,
    action: string,
    payload: Record<string, unknown>,
    after?: (data: Record<string, any>) => void,
  ) {
    if (busy) return;
    setBusy(name); setError(''); setNotice('');
    try {
      const data = await call(action, { idempotencyKey: keyFor(name), ...payload });
      dropKey(name);
      // `after` อาจเปลี่ยนโต๊ะที่กำลังดู (ยกเลิกโต๊ะ = เลิกดู · เปิดโต๊ะ = ไปดูโต๊ะใหม่)
      // จึงอ่าน ref **หลัง** มันทำงาน ไม่ใช่ค่าที่ปิดทับไว้ตั้งแต่ตอน render
      after?.(data);
      await loadWorkspace();
      const open = selectedIdRef.current;
      if (open) await loadSession(open);
      return data;
    } catch (e: any) {
      if (e?.decided) dropKey(name);
      setError(e instanceof Error ? e.message : posText("ทำรายการไม่สำเร็จ"));
      return null;
    } finally {
      setBusy('');
    }
  }

  /**
   * เพิ่มของเข้าบิล — ปุ่มกับ Enter ของเครื่องสแกนต้องเดินทางเดียวกัน
   * สองทางที่ตัดสินเองจะ drift แล้ววันหนึ่งการยิงบาร์โค้ดกับการกดปุ่มส่งค่าคนละชุด
   */
  function addTabItem(billingGroupId: string) {
    if (busy) return;
    if (tabGroupId !== billingGroupId) { setTabGroupId(billingGroupId); return; }
    const sku = tabSku.trim();
    if (!sku) { setError(posText("ยิงบาร์โค้ดหรือพิมพ์รหัสสินค้าก่อน")); return; }
    const qty = Number(tabQty);
    if (!Number.isFinite(qty) || qty < 1) { setError(posText("ใส่จำนวนอย่างน้อย 1")); return; }
    void run('tab-add', 'tab.add', {
      billingGroupId,
      sku,
      packQty: Math.round(qty),
    }, () => { setTabSku(''); setTabQty('1'); setNotice(posText("เพิ่มเข้าบิลแล้ว")); });
  }

  function resetOpenForm() {
    setOpeningTable(null);
    setSeatingQueueId('');
    setDrafts([]); setNote(''); setDraftName(''); setDraftGroup('1');
    setDraftTimeMode('ACTUAL'); setDraftPersonalMinutes('60');
    setMemberQuery(''); setMembers([]); setSelectedMember(null);
    setBillingMode('OPEN_ENDED'); setDuration('120'); setAlertBefore('15');
  }

  function addDraft() {
    const rateId = draftRateId || rates[0]?.id || '';
    if (!rateId) { setError(posText("ร้านยังไม่ได้ตั้งอัตราค่าเวลาเล่น — ตั้งที่หลังบ้านก่อน")); return; }
    const name = selectedMember?.name?.trim() || draftName.trim();
    if (!name) { setError(posText("ใส่ชื่อผู้เล่น หรือเลือกสมาชิกก่อน")); return; }
    const rate = rates.find((item) => item.id === rateId);
    const timeMode = draftTimeMode === 'SESSION_END' && billingMode !== 'FIXED_DURATION'
      ? 'ACTUAL'
      : draftTimeMode;
    const requestedMinutes = Number(draftPersonalMinutes);
    const personalMinutes = timeMode === 'DURATION' && Number.isInteger(requestedMinutes)
      ? requestedMinutes
      : null;
    if (timeMode === 'DURATION' && (!personalMinutes || personalMinutes < 1 || personalMinutes > 1440)) {
      setError(posText("ใส่เวลาที่ผู้เล่นซื้อ 1–1,440 นาที")); return;
    }
    setDrafts((rows) => [...rows, {
      key: newKey(),
      customerId: selectedMember?.customerId ?? null,
      memberNo: selectedMember?.memberNo ?? null,
      displayName: name,
      rateId,
      billingGroupNo: Math.max(1, Number(draftGroup) || 1),
      timeMode,
      purchasedDurationMinutes: personalMinutes,
    }]);
    setDraftName(''); setSelectedMember(null); setMemberQuery(''); setMembers([]);
    if (rate) setDraftRateId(rate.id);
    setError('');
  }

  function closeSessionAndContinue(sessionId: string) {
    void run('close', 'close', { sessionId }, undefined).then((data) => {
      if (!data) return;
      const billed = ((data as any)?.result?.groups ?? []) as BillingGroup[];
      if (billed.length === 1) {
        setNotice(posText("ปิดเวลาแล้ว — ไปเก็บเงินที่แท็บขาย"));
        onCheckout(billed[0].id);
        return;
      }
      setShowCloseChoices(false);
      setNotice(posText("ปิดเวลาแล้ว · โต๊ะนี้แยกเป็น {v0} บิล — เลือกเก็บทีละใบ", { v0: billed.length }));
    });
  }

  function requestSessionClose(activeSession: SessionDetail) {
    if (activeSession.billingGroups.length > 1) {
      setShowCloseChoices((current) => !current);
      return;
    }
    closeSessionAndContinue(activeSession.id);
  }

  if (!ready) {
    return (
      <div className="pos-card" style={{ padding: 16 }}>
        <div className="pos-block-title">{posText("โต๊ะ / เวลาเล่น")}</div>
        <div className="pos-block-hint">{posText("เลือกผู้ปฏิบัติงานและใส่ PIN ที่แถบด้านบนก่อน จึงจะเปิดโต๊ะได้")}</div>
      </div>
    );
  }

  const pollMs = pageVisible ? 10_000 : 60_000;
  const health = feedHealth(feed.lastOkAt, now, pollMs);
  const ago = describeAgo(feed.lastOkAt, now);
  const agoText = ago
    ? ago.unit === 'seconds' ? posText("{v0} วินาทีที่แล้ว", { v0: ago.value }) : posText("{v0} นาทีที่แล้ว", { v0: ago.value })
    : posText("ยังไม่เคยโหลดสำเร็จ");
  const initialLoadFailed = !workspace && (Boolean(workspaceLoadError) || feed.lastErrorAt !== null);
  const initialLoadPending = !workspace && !initialLoadFailed;
  const feedText = initialLoadPending
    ? posText("กำลังโหลดข้อมูลล่าสุด…")
    : initialLoadFailed
      ? posText("ยังโหลดข้อมูลไม่ได้ — กดโหลดใหม่เพื่อลองอีกครั้ง")
    : health === 'LIVE'
    ? posText("อัปเดตล่าสุด {v0}", { v0: agoText })
    : health === 'SLOW'
      ? posText("ข้อมูลช้ากว่าปกติ · {v0}", { v0: agoText })
      : posText("ยังไม่ได้ข้อมูลใหม่ — ตัวเลขบนจอนี้อาจไม่ตรงกับหน้าร้าน");

  const openForm = openingTable && !openingTable.openSession;
  const seatingTargets = (workspace?.floor.tables ?? []).filter(
    (table) => !table.blocked && table.id !== session?.tableId,
  );
  // `9.91`: โต๊ะที่ถูกรวมไว้ ย้ายไปโต๊ะว่างจะแยกเฉพาะชุดที่เลือก ส่วนรวมโต๊ะพาไปทั้งโต๊ะ —
  // ปุ่มเดียวทำสองความหมาย จอจึงต้องบอกก่อนกด ไม่ใช่ให้รู้ตอนอีกชุดหายไปจากโต๊ะ
  const sharedSeating = (activeSeating?.sessionCount ?? 1) > 1;
  const seatingSessionIds = activeSeating?.sessionIds ?? (session ? [session.id] : []);
  const seatingSessions = seatingSessionIds
    .map((id) => sharedSessionDetails[id] ?? (id === session?.id ? session : null))
    .filter((detail): detail is SessionDetail => Boolean(detail));
  const seatingLoans = seatingSessions.flatMap((detail) =>
    detail.games.map((loan) => ({ detail, loan })),
  );
  const seatingHolds = seatingSessions.flatMap((detail) =>
    detail.identityHolds.map((hold) => ({ detail, hold })),
  );
  const sharedSessionsReady = !sharedSeating
    || (!sharedSessionsLoading && !sharedSessionsError && seatingSessions.length === seatingSessionIds.length);
  const money = moneySoFar(session?.billingGroups ?? []);
  const sessionCalls = (workspace?.serviceCalls ?? []).filter(
    (item) => item.sessionId === session?.id,
  );
  const floorTables = workspace?.floor.tables ?? [];
  const availableCount = floorTables.filter((table) => !table.blocked && !table.openSession).length;
  const playingCount = floorTables.filter((table) => table.openSession?.status === 'OPEN').length;
  const awaitingPaymentCount = floorTables.filter((table) =>
    table.openSession?.status === 'CLOSING' || (table.openSession?.awaitingPaymentCount ?? 0) > 0,
  ).length;
  const participantGroups = (session?.billingGroups ?? [])
    .map((group) => ({
      group,
      participants: (session?.participants ?? []).filter(
        (participant) => participant.billingGroupId === group.id,
      ),
    }))
    .filter(({ participants }) => participants.length > 0);
  const openQueue = (workspace?.waitlist.entries ?? []).filter(
    (entry) => entry.status === 'WAITING' || entry.status === 'CALLED',
  );
  const allReservations = (workspace?.waitlist.entries ?? []).filter(
    (entry) => entry.kind === 'RESERVATION'
      && (entry.status === 'REQUESTED' || entry.status === 'CONFIRMED'),
  );
  const reservationNeedle = reservationSearch.trim().toLocaleLowerCase('th-TH');
  const reservationsByDate = new Map<string, WaitlistEntry[]>();
  for (const entry of allReservations) {
    const dateKey = reservationDateKey(entry);
    const list = reservationsByDate.get(dateKey) ?? [];
    list.push(entry);
    reservationsByDate.set(dateKey, list);
  }
  const reservationCalendarDays = calendarDays(reservationMonth);
  const todayKey = localDateInput(new Date());
  const reservations = allReservations.filter((entry) => {
    const matchesDate = !reservationDate || reservationDateKey(entry) === reservationDate;
    const haystack = `${entry.guestName ?? ''} ${entry.guestPhone ?? ''} ${entry.guestEmail ?? ''} ${entry.reservedTableCode ?? ''}`
      .toLocaleLowerCase('th-TH');
    return matchesDate && (!reservationNeedle || haystack.includes(reservationNeedle));
  });

  const resetReservationForm = () => {
    setReservationEditingId(''); setReservationPartySize('2'); setReservationGuestName('');
    setReservationGuestPhone(''); setReservationTime(''); setReservationDuration('120');
    setReservationTableId(''); setReservationEditorOpen(false);
  };

  const copyGuestLink = async () => {
    setError('');
    const copied = await copyTextToClipboard(guestLink);
    setGuestLinkCopyState(copied ? 'copied' : 'error');
  };

  return (
    <div className="pos-bg-workspace">
      {error && <PosDismissibleAlert key={error} className="pos-card" style={{ padding: 10, borderColor: '#e8bdb8', color: 'var(--pos-danger)' }} onClose={() => setError('')}>{error}</PosDismissibleAlert>}
      {notice && <PosDismissibleAlert key={notice} className="pos-card" style={{ padding: 10, color: 'var(--pos-money)' }} role="status" onClose={() => setNotice('')}>{notice}</PosDismissibleAlert>}

      {guestLinkOpen && guestLink && (
        <div className="pos-bg-guest-link-backdrop" onPointerDown={(event) => {
          if (event.target === event.currentTarget) setGuestLinkOpen(false);
        }}>
          <section className="pos-bg-guest-link-dialog" role="dialog" aria-modal="true" aria-labelledby="pos-bg-guest-link-title">
            <header className="pos-bg-guest-link-head">
              <div>
                <h2 id="pos-bg-guest-link-title">{posText("QR เรียกพนักงาน")}</h2>
                <p>{activeTable?.name || activeTable?.code || posText("โต๊ะนี้")} {" " + posText("· ให้ลูกค้าสแกนด้วยกล้องโทรศัพท์")}</p>
              </div>
              <button type="button" aria-label={posText("ปิด")} onClick={() => setGuestLinkOpen(false)}>×</button>
            </header>
            <div className="pos-bg-guest-link-body">
              <div className="pos-bg-guest-qr">
                {guestQrImage
                  ? <img src={guestQrImage} alt={posText("QR เรียกพนักงานสำหรับ {v0}", { v0: activeTable?.name || activeTable?.code || posText("โต๊ะนี้") })} />
                  : <span>{posText("กำลังสร้าง QR…")}</span>}
              </div>
              <div className="pos-bg-guest-link-copy">
                <label htmlFor="pos-bg-guest-link-value">{posText("ลิงก์ลูกค้า")}</label>
                <div>
                  <input id="pos-bg-guest-link-value" readOnly value={guestLink} onFocus={(event) => event.currentTarget.select()} />
                  <button type="button" className="pos-ret-btn pos-ret-btn--open" onClick={() => void copyGuestLink()}>
                    {guestLinkCopyState === 'copied' ? posText("คัดลอกแล้ว ✓") : posText("คัดลอกลิงก์")}
                  </button>
                </div>
                {guestLinkCopyState === 'error' && <p role="alert">{posText("คัดลอกอัตโนมัติไม่ได้ — แตะลิงก์แล้วคัดลอกด้วยตนเอง")}</p>}
              </div>
            </div>
            <footer className="pos-bg-guest-link-actions">
              <a href={guestLink} target="_blank" rel="noreferrer">{posText("เปิดหน้าลูกค้า")}</a>
              <button type="button" onClick={() => setGuestLinkOpen(false)}>{posText("ปิด")}</button>
            </footer>
          </section>
        </div>
      )}

      <div className={`pos-bg-master-detail${openForm || session ? ' pos-bg-master-detail--selected' : ''}`}>
        <section className="pos-card pos-bg-master-pane" aria-label={posText("ผังโต๊ะ")} aria-busy={initialLoadPending}>
          <div className="pos-bg-floor-head">
            <div>
              <div className="pos-block-title">{posText("ผังโต๊ะ")}</div>
              <div className="pos-block-hint">{posText("ดูสถานะและเลือกโต๊ะเพื่อจัดการ")}</div>
            </div>
            <div className="pos-bg-floor-refresh">
              {/* ⚠️ จอที่ค้างเงียบ ๆ อ่านไม่ต่างจากจอที่ข้อมูลถูกต้อง — ป้ายนี้อ่านจาก
                  เวลาที่โหลดสำเร็จครั้งล่าสุด ไม่ใช่จากนาฬิกาที่เดินต่อแม้เน็ตขาด */}
              <span className={`pos-bg-feed ${feedTone(health)}`.trim()}>{feedText}</span>
              <button type="button" className="pos-ret-btn" disabled={Boolean(busy)}
                onClick={feed.refreshNow}>
                {posText("โหลดใหม่") + " "}</button>
            </div>
          </div>

          {!workspace && (
            <div className={`pos-bg-floor-loading${initialLoadFailed ? ' pos-bg-floor-loading--error' : ''}`} role="status">
              {!initialLoadFailed && <span className="pos-bg-loading-spinner" aria-hidden="true" />}
              <strong>{initialLoadFailed ? posText("ยังโหลดผังโต๊ะไม่ได้") : posText("กำลังโหลดผังโต๊ะ…")}</strong>
              <span>{workspaceLoadError || (initialLoadFailed
                ? posText("เซิร์ฟเวอร์ตอบช้าหรือเชื่อมต่อไม่สำเร็จ — กดโหลดใหม่เพื่อลองอีกครั้ง")
                : posText("กำลังตรวจสถานะโต๊ะ คิว และคำเรียกล่าสุดจากเซิร์ฟเวอร์"))}</span>
            </div>
          )}

          {workspace && <div className="pos-bg-floor-stats" aria-label={posText("สรุปสถานะผังโต๊ะ")}>
            {([
              ['ALL', posText("ทั้งหมด"), floorTables.length, ''],
              ['AVAILABLE', posText("ว่าง"), availableCount, ''],
              ['PLAYING', posText("กำลังเล่น"), playingCount, 'pos-bg-stat-pill--playing'],
              ['ATTENTION', posText("ต้องดู"), attention.length, 'pos-bg-stat-pill--danger'],
              ['PAYING', posText("รอเก็บเงิน"), awaitingPaymentCount, 'pos-bg-stat-pill--warn'],
            ] as const).map(([value, label, count, tone]) => (
              <button key={value} type="button" aria-pressed={floorFilter === value}
                className={`pos-bg-stat-pill ${tone} ${floorFilter === value ? 'pos-bg-stat-pill--on' : ''}`.trim()}
                onClick={() => setFloorFilter(value)}>
                {label} {count}
              </button>
            ))}
          </div>}

          {attention.length > 0 && (
            <div className={`pos-bg-attention ${overdueCount > 0 ? 'pos-bg-attention--critical' : ''}`.trim()} aria-label={posText("โต๊ะที่ต้องดูตอนนี้")}>
              <div className="pos-bg-attention-head">
                <span className="pos-bg-attention-icon" aria-hidden="true">!</span>
                <div>
                  <strong>{posText("ต้องดูตอนนี้") + " "}{attention.length} {" " + posText("โต๊ะ")}</strong>
                  <span>{posText("เกินเวลา") + " "}{overdueCount} {" " + posText("· ใกล้หมดเวลา") + " "}{endingSoonCount}</span>
                </div>
                <button type="button" className="pos-ret-btn pos-bg-attention-filter"
                  aria-pressed={floorFilter === 'ATTENTION'}
                  onClick={() => setFloorFilter(floorFilter === 'ATTENTION' ? 'ALL' : 'ATTENTION')}>
                  {floorFilter === 'ATTENTION' ? posText("แสดงทุกโต๊ะ") : posText("เฉพาะโต๊ะเร่งด่วน →")}
                </button>
              </div>
            </div>
          )}

          {/* `pos-bg-reservation-section` = คอนเทนเนอร์ที่การ์ดการจองใช้วัดตัวเอง — แผงนี้กว้าง
              ราว 62% ของจอ การวัดจากความกว้าง *จอ* จึงตัดปุ่ม "เช็กอิน" หายที่หน้าต่าง 1240px
              (เหตุผลเต็มอยู่ข้าง `.pos-bg-reservation-section` ใน pos.css) */}
          {workspace && <details className="pos-bg-section pos-bg-section--advanced pos-bg-reservation-section"
            open={allReservations.length > 0}>
            <summary>{posText("การจองล่วงหน้า ·") + " "}{allReservations.length} {" " + posText("รายการ")}</summary>
            <div className="pos-bg-reservation-tools">
              <label className="pos-bg-field">
                {posText("ค้นหารายการ") + " "}<input value={reservationSearch} placeholder={posText("ชื่อ เบอร์โทร หรือโต๊ะ")}
                  onChange={(e) => setReservationSearch(e.target.value)} />
              </label>
              <div className="pos-bg-reservation-month-actions">
                <button type="button" className="pos-ret-btn" aria-label={posText("เดือนก่อนหน้า")}
                  onClick={() => setReservationMonth((current) => shiftCalendarMonth(current, -1))}>‹</button>
                <strong>{calendarMonthLabel(reservationMonth, posText)}</strong>
                <button type="button" className="pos-ret-btn" aria-label={posText("เดือนถัดไป")}
                  onClick={() => setReservationMonth((current) => shiftCalendarMonth(current, 1))}>›</button>
                <button type="button" className="pos-ret-btn" onClick={() => {
                  const today = localDateInput(new Date());
                  setReservationDate(today); setReservationMonth(today.slice(0, 7));
                }}>{posText("วันนี้")}</button>
              </div>
            </div>

            <div className="pos-bg-reservation-calendar" role="grid" aria-label={posText("ปฏิทินการจอง")}>
              {[posText("จ."), posText("อ."), posText("พ."), posText("พฤ."), posText("ศ."), posText("ส."), posText("อา.")].map((label) => (
                <span key={label} className="pos-bg-reservation-weekday" role="columnheader">{label}</span>
              ))}
              {reservationCalendarDays.map((day) => {
                const dayReservations = reservationsByDate.get(day.key) ?? [];
                const requested = dayReservations.filter((entry) => entry.status === 'REQUESTED').length;
                const confirmed = dayReservations.length - requested;
                return (
                  <button key={day.key} type="button" role="gridcell"
                    aria-selected={reservationDate === day.key}
                    aria-label={posText("{v0} · {v1} รายการ", { v0: calendarDateLabel(day.key, posText), v1: dayReservations.length })}
                    className={`pos-bg-reservation-day ${!day.inMonth ? 'pos-bg-reservation-day--outside' : ''} ${reservationDate === day.key ? 'pos-bg-reservation-day--selected' : ''} ${todayKey === day.key ? 'pos-bg-reservation-day--today' : ''}`.trim()}
                    onClick={() => { setReservationDate(day.key); setReservationMonth(day.key.slice(0, 7)); }}>
                    <span className="pos-bg-reservation-day-number">{day.day}</span>
                    <span className="pos-bg-reservation-day-events">
                      {confirmed > 0 && <span className="pos-bg-reservation-count">{posText("▣ จองแล้ว") + " "}{confirmed}</span>}
                      {requested > 0 && <span className="pos-bg-reservation-count pos-bg-reservation-count--request">{posText("◷ รอยืนยัน") + " "}{requested}</span>}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="pos-bg-reservation-list-head">
              <strong>{posText("รายการจอง ·") + " "}{calendarDateLabel(reservationDate, posText)}</strong>
              <span className="pos-bg-reservation-total">{reservations.length} {" " + posText("รายการ")}</span>
            </div>
            {allReservations.length > 0 && reservations.length === 0 && (
              <div className="pos-block-hint">{posText("ไม่พบรายการที่ตรงกับตัวกรอง")}</div>
            )}
            {reservations.map((entry) => {
              const reviewTableId = reviewTableByEntry[entry.id] ?? '';
              const table = floorTables.find((item) => item.id === entry.reservedTableId) ?? null;
              const reservedAt = entry.reservedFor ? Date.parse(entry.reservedFor) : Number.NaN;
              const now = Date.now();
              const canArrive = Number.isFinite(reservedAt)
                && now >= reservedAt - 2 * 60 * 60_000 && now <= reservedAt + 6 * 60 * 60_000;
              const depositReady = entry.depositStatus === 'NOT_REQUIRED' || entry.depositStatus === 'PAID';
              const canMarkNoShow = Number.isFinite(reservedAt) && now >= reservedAt;
              return (
                <div key={entry.id}
                  className={`pos-bg-reservation-card ${entry.status === 'REQUESTED' ? 'pos-bg-reservation-card--requested' : ''}`}>
                  <div className="pos-bg-reservation-card-status">
                    <span className={`pos-bg-reservation-status ${entry.status === 'REQUESTED' ? 'pos-bg-reservation-status--requested' : ''}`}>
                      {entry.status === 'REQUESTED' ? posText("◷ รอยืนยัน") : posText("✓ ยืนยันแล้ว")}
                    </span>
                    <strong>{timeLabel(entry.reservedFor)}</strong>
                  </div>
                  <div className="pos-bg-reservation-card-person">
                    {entry.source === 'CHAT' && <span>{t('admin_board_game.source_chat')}</span>}
                    <strong>{entry.guestName || posText("ไม่ระบุชื่อ")}</strong>
                    <span>{posText("โทร.") + " "}{entry.guestPhone || '-'}</span>
                    {entry.guestEmail && <span>{entry.guestEmail}</span>}
                  </div>
                  <div className="pos-bg-reservation-card-fact">
                    <span aria-hidden="true">♙</span>
                    <strong>{entry.partySize} {" " + posText("คน")}</strong>
                  </div>
                  <div className="pos-bg-reservation-card-fact pos-bg-reservation-card-table">
                    <span aria-hidden="true">▱</span>
                    <span>{posText("โต๊ะ")}<br /><strong>{entry.reservedTableCode || posText("รอจัดโต๊ะ")}</strong></span>
                  </div>
                  <div className="pos-bg-reservation-card-fact">
                    <span aria-hidden="true">◷</span>
                    <strong>{entry.reservedDurationMinutes ?? 0} {" " + posText("นาที")}</strong>
                  </div>
                  {entry.source === 'CHAT' && <div className="pos-bg-reservation-card-note">{t('admin_board_game.chat_contact_staff')}</div>}
                  {(entry.depositAmount > 0 || entry.source === 'PUBLIC') && (
                    <div className="pos-bg-reservation-card-note">
                      {entry.depositAmount > 0 ? posText("มัดจำ ฿{v0} ({v1})", { v0: entry.depositAmount.toFixed(2), v1: entry.depositStatus }) : ''}
                      {entry.source === 'PUBLIC' ? posText(" · แจ้งผล {v0}", { v0: entry.decisionNotificationStatus }) : ''}
                    </div>
                  )}
                  <div className="pos-bg-row-actions pos-bg-reservation-card-actions">
                    {entry.status === 'REQUESTED' && <>
                      <select aria-label={posText("โต๊ะสำหรับยืนยันคำขอ")} value={reviewTableId}
                        onChange={(event) => setReviewTableByEntry(current => ({
                          ...current, [entry.id]: event.target.value,
                        }))}>
                        <option value="">{posText("เลือกโต๊ะ")}</option>
                        {floorTables.filter((item) => !item.blocked && item.seats >= entry.partySize).map((item) => (
                          <option key={item.id} value={item.id}>{item.code} · {item.name} ({item.seats} {" " + posText("ที่)")}</option>
                        ))}
                      </select>
                      <button type="button" className="pos-ret-btn pos-ret-btn--open"
                        disabled={!reviewTableId || busy === `reservation-confirm-${entry.id}`}
                        onClick={() => void run(`reservation-confirm-${entry.id}`, 'reservation.review', {
                          entryId: entry.id, decision: 'CONFIRM', tableId: reviewTableId,
                        }, () => {
                          setReviewTableByEntry(current => ({ ...current, [entry.id]: '' }));
                          setNotice(posText("ยืนยันคำขอจองแล้ว"));
                        })}>
                        {posText("ยืนยันคำขอ") + " "}</button>
                      <button type="button" className="pos-ret-btn pos-ret-btn--danger"
                        disabled={busy === `reservation-reject-${entry.id}`}
                        onClick={() => void run(`reservation-reject-${entry.id}`, 'reservation.review', {
                          entryId: entry.id, decision: 'REJECT', reason: posText("ร้านไม่สามารถรับคำขอนี้ได้"),
                        }, () => setNotice(posText("ปฏิเสธคำขอแล้ว")))}>
                        {posText("ปฏิเสธ") + " "}</button>
                    </>}
                    {entry.status === 'CONFIRMED' && <>
                    <button type="button" className="pos-ret-btn" onClick={() => {
                      setReservationEditingId(entry.id);
                      setReservationPartySize(String(entry.partySize));
                      setReservationGuestName(entry.guestName ?? '');
                      setReservationGuestPhone(entry.guestPhone ?? '');
                      const date = reservationDateKey(entry);
                      setReservationDate(date);
                      setReservationMonth(date.slice(0, 7));
                      setReservationTime(localTimeInput(entry.reservedFor));
                      setReservationDuration(String(entry.reservedDurationMinutes ?? 120));
                      setReservationTableId(entry.reservedTableId ?? '');
                      setReservationEditorOpen(true);
                    }}>
                      {posText("แก้ไข/เลื่อน") + " "}</button>
                    <button type="button" className="pos-ret-btn"
                      disabled={!canArrive || !depositReady || busy === `reservation-checkin-${entry.id}`}
                      onClick={() => void run(`reservation-checkin-${entry.id}`, 'reservation.check_in',
                        { entryId: entry.id }, () => setNotice(posText("เช็กอินและออกเลขคิวแล้ว")))}>
                      {posText("เช็กอิน") + " "}</button>
                    {canArrive && table && !table.openSession && !table.blocked && table.seats >= entry.partySize && (
                      <button type="button" className="pos-ret-btn pos-ret-btn--open" onClick={() => {
                        setSeatingQueueId(entry.id); setOpeningTable(table); selectTable(''); setSession(null);
                        setDrafts([]); setNotice(posText("เตรียมเปิด {v0} ให้รายการจอง — ระบุผู้เล่นจริงก่อนเริ่มเวลา", { v0: table.code }));
                      }}>
                        {posText("นั่งโต๊ะ") + " "}</button>
                    )}
                    <button type="button" className="pos-ret-btn pos-ret-btn--danger"
                      disabled={busy === `reservation-cancel-${entry.id}`}
                      onClick={() => void run(`reservation-cancel-${entry.id}`, 'waitlist.close', {
                        entryId: entry.id, status: 'CANCELLED',
                      }, () => setNotice(posText("ยกเลิกการจองแล้ว")))}>
                      {posText("ยกเลิก") + " "}</button>
                    {canMarkNoShow && (
                      <button type="button" className="pos-ret-btn pos-ret-btn--danger"
                        disabled={busy === `reservation-noshow-${entry.id}`}
                        onClick={() => void run(`reservation-noshow-${entry.id}`, 'waitlist.close', {
                          entryId: entry.id, status: 'NO_SHOW',
                        }, () => setNotice(posText("บันทึกว่าลูกค้าไม่มาแล้ว")))}>
                        {posText("ไม่มา") + " "}</button>
                    )}
                    </>}
                  </div>
                </div>
              );
            })}
            <button type="button" className="pos-bg-reservation-add-toggle"
              aria-expanded={reservationEditorOpen}
              onClick={() => {
                if (reservationEditorOpen) resetReservationForm();
                else setReservationEditorOpen(true);
              }}>
              <span>＋ {reservationEditingId ? posText("แก้ไขการจอง") : posText("เพิ่มการจองใหม่")}</span>
              <span aria-hidden="true">{reservationEditorOpen ? '⌃' : '⌄'}</span>
            </button>
            {reservationEditorOpen && <div className="pos-bg-reservation-editor">
              <div className="pos-bg-reservation-editor-head">
                <div>
                  <strong>{reservationEditingId ? posText("แก้ไขการจอง") : posText("เพิ่มการจอง")}</strong>
                  <span>{calendarDateLabel(reservationDate, posText)}</span>
                </div>
                {reservationEditingId && (
                  <button type="button" className="pos-ret-btn" onClick={resetReservationForm}>{posText("เลิกแก้ไข")}</button>
                )}
              </div>
              <div className="pos-bg-form">
                <label className="pos-bg-field pos-bg-field--num">
                  {posText("เวลาเริ่ม") + " "}<input type="time" value={reservationTime}
                    onChange={(e) => setReservationTime(e.target.value)} />
                </label>
                <label className="pos-bg-field pos-bg-field--num">
                  {posText("ระยะเวลา (นาที)") + " "}<input value={reservationDuration} inputMode="numeric"
                    onChange={(e) => setReservationDuration(e.target.value)} />
                </label>
                <label className="pos-bg-field pos-bg-field--num">
                  {posText("จำนวนคน") + " "}<input value={reservationPartySize} inputMode="numeric"
                    onChange={(e) => setReservationPartySize(e.target.value)} />
                </label>
                <label className="pos-bg-field">
                  {posText("โต๊ะ") + " "}<select value={reservationTableId} onChange={(e) => setReservationTableId(e.target.value)}>
                    <option value="">{posText("เลือกโต๊ะ")}</option>
                    {floorTables.filter((table) => !table.blocked).map((table) => (
                      <option key={table.id} value={table.id}>{table.code} · {table.name} ({table.seats} {" " + posText("ที่)")}</option>
                    ))}
                  </select>
                </label>
                <label className="pos-bg-field">
                  {posText("ชื่อลูกค้า") + " "}<input value={reservationGuestName} onChange={(e) => setReservationGuestName(e.target.value)} />
                </label>
                <label className="pos-bg-field">
                  {posText("เบอร์โทร") + " "}<input value={reservationGuestPhone} onChange={(e) => setReservationGuestPhone(e.target.value)} />
                </label>
                <button type="button" className="pos-ret-btn pos-ret-btn--open"
                  disabled={busy === 'reservation-add' || busy === 'reservation-update'}
                  onClick={() => {
                    const partySize = Number(reservationPartySize);
                    const durationMinutes = Number(reservationDuration);
                    const instant = new Date(`${reservationDate}T${reservationTime}`);
                    if (!reservationTableId || !reservationGuestName.trim() || !reservationGuestPhone.trim()
                      || !Number.isInteger(partySize) || partySize < 1
                      || !Number.isInteger(durationMinutes) || durationMinutes < 30
                      || !Number.isFinite(instant.getTime())) {
                      setError(posText("เลือกวันและเวลา โต๊ะ ชื่อ เบอร์โทร จำนวนคน และระยะเวลาอย่างน้อย 30 นาทีให้ครบ")); return;
                    }
                    const updating = Boolean(reservationEditingId);
                    void run(updating ? 'reservation-update' : 'reservation-add',
                      updating ? 'reservation.update' : 'reservation.add', {
                      ...(updating ? { entryId: reservationEditingId } : {}),
                      tableId: reservationTableId, reservedFor: instant.toISOString(),
                      durationMinutes, partySize, guestName: reservationGuestName,
                      guestPhone: reservationGuestPhone,
                    }, () => {
                      resetReservationForm();
                      setNotice(updating ? posText("แก้ไขการจองแล้ว") : posText("ยืนยันการจองแล้ว"));
                    });
                  }}>
                  {reservationEditingId ? posText("บันทึกการแก้ไข") : posText("ยืนยันจอง")}
                </button>
              </div>
            </div>}
          </details>}

          {workspace && <details className="pos-bg-section pos-bg-section--advanced" open={openQueue.length > 0}>
            <summary>
              {posText("คิวรอโต๊ะ") + " "}{openQueue.length > 0
                ? posText("· {v0} กลุ่ม · รอนานสุด {v1} นาที", { v0: openQueue.length, v1: workspace?.waitlist.longestWaitMinutes ?? 0 })
                : posText("· ยังไม่มีคนรอ")}
            </summary>
            <div className="pos-bg-form" style={{ marginTop: 10 }}>
              <label className="pos-bg-field pos-bg-field--num">
                {posText("จำนวนคน") + " "}<input value={queuePartySize} inputMode="numeric"
                  onChange={(e) => setQueuePartySize(e.target.value)} />
              </label>
              <label className="pos-bg-field">
                {posText("ชื่อเรียก") + " "}<input value={queueGuestName} onChange={(e) => setQueueGuestName(e.target.value)} />
              </label>
              <label className="pos-bg-field">
                {posText("เบอร์โทร (ไม่บังคับ)") + " "}<input value={queueGuestPhone} onChange={(e) => setQueueGuestPhone(e.target.value)} />
              </label>
              <button type="button" className="pos-ret-btn pos-ret-btn--open"
                disabled={busy === 'waitlist-add'}
                onClick={() => {
                  const partySize = Number(queuePartySize);
                  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 500) {
                    setError(posText("จำนวนคนต้องอยู่ระหว่าง 1–500")); return;
                  }
                  void run('waitlist-add', 'waitlist.add', {
                    partySize, guestName: queueGuestName, guestPhone: queueGuestPhone,
                  }, () => {
                    setQueuePartySize('2'); setQueueGuestName(''); setQueueGuestPhone('');
                    setNotice(posText("เพิ่มคิวแล้ว"));
                  });
                }}>
                {posText("รับคิว") + " "}</button>
            </div>

            {openQueue.map((entry) => {
              const fitting = floorTables.filter((table) =>
                !table.blocked && !table.openSession && table.seats >= entry.partySize,
              );
              return (
                <div key={entry.id} className="pos-bg-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                  <div className="pos-bg-row-main">
                    {posText("คิว") + " "}{entry.queueNo} · {entry.guestName || posText("ไม่ระบุชื่อ")} · {entry.partySize} {" " + posText("คน") + " "}<span style={{ color: 'var(--pos-muted)' }}>
                      {posText(" · รอ ")}{elapsedLabel(entry.createdAt, now, posText)}
                      {entry.status === 'CALLED' ? posText(" · เรียกแล้ว") : ''}
                    </span>
                    <div className="pos-chips" style={{ marginTop: 6 }}>
                      {fitting.slice(0, 4).map((table) => (
                        <button key={table.id} type="button" className="pos-chip"
                          style={{ border: 'none', cursor: 'pointer' }}
                          onClick={() => {
                            setSeatingQueueId(entry.id); setOpeningTable(table); selectTable(''); setSession(null);
                            setDrafts([]); setNotice(posText("เลือกโต๊ะ {v0} ให้คิว {v1} — ตรวจจำนวนจริงแล้วระบุผู้เล่น", { v0: table.code, v1: entry.queueNo }));
                          }}>
                          {posText("นั่ง") + " "}{table.code} ({table.seats})
                        </button>
                      ))}
                      {fitting.length === 0 && <span className="pos-block-hint">{posText("ยังไม่มีโต๊ะที่รองรับ")}</span>}
                    </div>
                  </div>
                  <div className="pos-bg-row-actions">
                    {entry.status === 'WAITING' && (
                      <button type="button" className="pos-ret-btn"
                        disabled={busy === `waitlist-call-${entry.id}`}
                        onClick={() => void run(`waitlist-call-${entry.id}`, 'waitlist.call', { entryId: entry.id },
                          () => setNotice(posText("เรียกคิว {v0} แล้ว", { v0: entry.queueNo })))}>
                        {posText("เรียก") + " "}</button>
                    )}
                    <button type="button" className="pos-ret-btn pos-ret-btn--danger"
                      disabled={busy === `waitlist-cancel-${entry.id}`}
                      onClick={() => void run(`waitlist-cancel-${entry.id}`, 'waitlist.close', {
                        entryId: entry.id, status: entry.status === 'CALLED' ? 'NO_SHOW' : 'CANCELLED',
                      }, () => setNotice(entry.status === 'CALLED' ? posText("บันทึกไม่มาตามเรียกแล้ว") : posText("ยกเลิกคิวแล้ว")))}>
                      {entry.status === 'CALLED' ? posText("ไม่มา") : posText("ยกเลิก")}
                    </button>
                  </div>
                </div>
              );
            })}
          </details>}
      {/* ---------------- ผังโต๊ะ ---------------- */}
      {(workspace?.floor.areas ?? []).map((area) => {
        const areaTables = (tablesByArea.get(area.id) ?? []).filter(
          (table) => matchesFloorFilter(table, floorFilter),
        );
        if (areaTables.length === 0) return null;
        return (
        <div key={area.id} className="pos-bg-area">
          <div className="pos-bg-area-head">
            <div className="pos-bg-zone-title">
              <strong>{area.name}</strong>
              <span>{posText("ว่าง") + " "}{(tablesByArea.get(area.id) ?? []).filter((table) => !table.openSession && !table.blocked).length}</span>
            </div>
          </div>
          <div className="pos-bg-floor">
            {areaTables.map((table) => {
              const open = table.openSession;
              const selected = open
                ? (open.sessionIds ?? [open.id]).includes(selectedId)
                : openingTable?.id === table.id;
              const tableTone = open?.status === 'CLOSING' || (open?.awaitingPaymentCount ?? 0) > 0
                ? 'pos-bg-table--paying'
                : open?.alertStatus === 'OVERDUE'
                  ? 'pos-bg-table--overdue'
                  : open?.alertStatus === 'ENDING_SOON'
                    ? 'pos-bg-table--ending'
                    : open ? 'pos-bg-table--playing' : '';
              return (
                <button key={table.id} type="button" disabled={table.blocked}
                  aria-pressed={selected}
                  className={`pos-bg-table ${tableTone} ${selected ? 'pos-bg-table--on' : ''}`.replace(/\s+/g, ' ').trim()}
                  onClick={() => {
                    setError(''); setNotice('');
                    setSeatingQueueId('');
                    if (open) { selectTable(open.id); setOpeningTable(null); }
                    else { setOpeningTable(table); selectTable(''); setSession(null); }
                  }}
                >
                  <div className="pos-bg-table-head">
                    <div className="pos-bg-table-code">{table.name}</div>
                    <span className={`pos-bg-table-badge ${open?.status === 'CLOSING' || (open?.awaitingPaymentCount ?? 0) > 0
                      ? 'pos-bg-table-badge--paying'
                      : open?.alertStatus === 'OVERDUE'
                        ? 'pos-bg-table-badge--overdue'
                        : open?.alertStatus === 'ENDING_SOON'
                          ? 'pos-bg-table-badge--ending'
                          : open ? 'pos-bg-table-badge--playing'
                            : table.blocked ? 'pos-bg-table-badge--blocked' : 'pos-bg-table-badge--available'}`.trim()}>
                      {table.blocked ? posText("ปิดใช้งาน") : tableStateLabel(open, posText)}
                    </span>
                  </div>
                  <div className="pos-bg-table-id">{table.code}</div>
                  {open ? (
                    <div className="pos-bg-table-body">
                      <div className={`pos-bg-table-state ${open.alertStatus === 'OVERDUE' ? 'pos-bg-table-state--danger' : ''}`.trim()}>
                        <span aria-hidden="true">◷</span>
                        {open.billingMode === 'FIXED_DURATION' && open.expectedEndAt
                          ? posText("ซื้อ {v0} นาที · {v1}–{v2}", { v0: plannedMinutes(open), v1: timeLabel(open.startedAt), v2: timeLabel(open.expectedEndAt) })
                          : posText("เปิดยาว · เริ่ม {v0}", { v0: timeLabel(open.startedAt) })}
                      </div>
                      <div className={`pos-bg-table-clock ${open.alertStatus === 'OVERDUE' ? 'pos-bg-table-clock--danger' : ''}`.trim()}>
                        {posText("เล่นมา") + " "}{elapsedLabel(open.startedAt, now, posText)}
                        {open.nextAlertAt ? ` · ${attentionLabel(open, now, posText)}` : ''}
                      </div>
                      {/* ⚠️ ยอดขึ้นเฉพาะตอนมีบิลที่ปิดเวลาแล้วรอเก็บจริง — `amountDue` ของโต๊ะที่
                          ยังเล่นอยู่คือค่าเล่นที่ "ยังไม่ถูกแช่" ซึ่งเป็น 0 เสมอ ไม่ใช่ 0 เพราะไม่ติดเงิน */}
                      {open.awaitingPaymentCount > 0
                        ? <div className="pos-bg-table-money">฿{baht(open.amountDue)}</div>
                        : null}
                      <div className="pos-bg-table-meta">
                        <span style={open.guestCount > table.seats ? { color: 'var(--pos-danger)', fontWeight: 700 } : undefined}>
                          ♟ {open.guestCount}/{table.seats} {" " + posText("คน")}{open.guestCount > table.seats ? posText(" · เกิน {v0}", { v0: open.guestCount - table.seats }) : ''}
                        </span>
                        <span>▤ {open.billingGroupCount} {" " + posText("กลุ่มบิล")}</span>
                        {open.awaitingPaymentCount > 0 ? posText(" · รอเก็บ {v0}", { v0: open.awaitingPaymentCount }) : ''}
                      </div>
                      {(open.sessionCount ?? 1) > 1 && (
                        <div className="pos-bg-table-sub">
                          {posText("รวมจาก") + " "}{open.sessionCount} {" " + posText("โต๊ะ · บิลยังแยกเดิม") + " "}</div>
                      )}
                    </div>
                  ) : (
                    <div className="pos-bg-table-body">
                      <div className="pos-bg-table-meta"><span>♟ {table.seats} {" " + posText("ที่นั่ง")}</span></div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      );})}
      {floorTables.length > 0 && floorTables.every((table) => !matchesFloorFilter(table, floorFilter)) && (
        <div className="pos-bg-floor-empty">{posText("ไม่มีโต๊ะในสถานะที่เลือก")}</div>
      )}
        </section>

        <section className="pos-card pos-bg-detail-pane" aria-label={posText("รายละเอียดโต๊ะ")}>
      {!workspace ? (
        <div className="pos-bg-detail-empty" role="status">
          {!initialLoadFailed && <span className="pos-bg-loading-spinner" aria-hidden="true" />}
          <div className="pos-block-title">{initialLoadFailed ? posText("รอเชื่อมต่อผังโต๊ะ") : posText("กำลังเตรียมข้อมูลโต๊ะ")}</div>
          <div className="pos-block-hint">{initialLoadFailed
            ? posText("ใช้ปุ่มโหลดใหม่ด้านซ้ายเพื่อเชื่อมต่ออีกครั้ง")
            : posText("รายละเอียดจะพร้อมทันทีที่ผังโต๊ะโหลดสำเร็จ")}</div>
        </div>
      ) : !openForm && !session && selectedId && sessionLoadingId === selectedId ? (
        <div className="pos-bg-detail-empty" role="status">
          <span className="pos-bg-loading-spinner" aria-hidden="true" />
          <div className="pos-block-title">{posText("กำลังโหลดรายละเอียดโต๊ะ")}</div>
          <div className="pos-block-hint">{posText("ระหว่างนี้ระบบพักคำสั่งยืมเกมและรับบัตร เพื่อไม่ให้ลงผิดชุดลูกค้า")}</div>
        </div>
      ) : !openForm && !session && (
        <div className="pos-bg-detail-empty">
          <div className="pos-bg-detail-empty-icon" aria-hidden="true">↖</div>
          <div className="pos-block-title">{posText("เลือกโต๊ะจากผัง")}</div>
          <div className="pos-block-hint">{posText("โต๊ะว่างจะเปิดฟอร์มเริ่มเวลา · โต๊ะที่มีลูกค้าจะแสดงงานของโต๊ะนี้ตรงนี้")}</div>
        </div>
      )}

      {/* ---------------- เปิดโต๊ะ ---------------- */}
      {openForm && (
        <div className="pos-bg-open-card">
          <div className="pos-shift-head">
            <div className="pos-block-title">
              {seatingQueueId ? posText("พาคิวไปนั่ง") : posText("เปิดโต๊ะ")} {openingTable.code} · {openingTable.name}
            </div>
            <button type="button" className="pos-ret-btn" onClick={resetOpenForm}>{posText("ปิด")}</button>
          </div>

          <div className="pos-chips" style={{ marginTop: 8 }}>
            {(['OPEN_ENDED', 'FIXED_DURATION'] as const).map((mode) => (
              <button key={mode} type="button"
                className={`pos-ret-btn ${billingMode === mode ? 'pos-ret-btn--primary' : ''}`}
                onClick={() => { setBillingMode(mode); setDraftTimeMode(mode === 'FIXED_DURATION' ? 'SESSION_END' : 'ACTUAL'); }}>
                {mode === 'OPEN_ENDED' ? posText("เปิดยาว (คิดตามจริง)") : posText("ซื้อเวลาไว้ล่วงหน้า")}
              </button>
            ))}
          </div>

          <div className="pos-bg-form">
            {billingMode === 'FIXED_DURATION' && (
              <label className="pos-bg-field pos-bg-field--num">
                {posText("เวลาที่ซื้อ (นาที)") + " "}<input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" />
              </label>
            )}
            <label className="pos-bg-field pos-bg-field--num">
              {posText("เตือนก่อนหมดเวลา (นาที)") + " "}<input value={alertBefore} onChange={(e) => setAlertBefore(e.target.value)} inputMode="numeric" />
            </label>
            <label className="pos-bg-field">
              {posText("โน้ต") + " "}<input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>

          <div className="pos-block" style={{ marginTop: 12 }}>
            <div className="pos-block-title">{posText("ผู้เล่น")}</div>
            <div className="pos-bg-form" style={{ marginTop: 0 }}>
              <label className="pos-bg-field" style={{ alignSelf: 'flex-start' }}>
                {posText("ชื่อผู้เล่น") + " "}<input value={selectedMember?.name || draftName} disabled={Boolean(selectedMember?.name)}
                  onChange={(e) => setDraftName(e.target.value)} />
              </label>
              <div className="pos-bg-field pos-bg-member-search">
                <label>
                  {posText("ค้นสมาชิก (ไม่บังคับ)") + " "}<input value={memberQuery} autoComplete="off"
                    onChange={(e) => {
                      setMemberQuery(e.target.value); setSelectedMember(null); setMembers([]);
                      setMemberSearchStatus('idle'); setMemberSearchError('');
                    }}
                    placeholder={posText("เบอร์โทร / ชื่อ / เลขสมาชิก")} />
                </label>
                {selectedMember ? <div className="pos-bg-member-selected">
                  <span><b>{selectedMember.name || posText("สมาชิกไม่มีชื่อ")}</b><small>{[selectedMember.phone, selectedMember.memberNo].filter(Boolean).join(' · ')}</small></span>
                  <button type="button" className="pos-ret-btn" aria-label={posText("ยกเลิกการเลือกสมาชิก")} title={posText("ยกเลิกการเลือกสมาชิก")}
                    onClick={() => { setSelectedMember(null); setDraftName(''); }}><CloseOutlined /></button>
                </div> : <>
                  <div role="status" aria-live="polite" className="pos-bg-member-status">
                    {!ready ? posText("กรุณาเลือกพนักงานและใส่ PIN ก่อนค้นสมาชิก")
                      : memberQuery.trim().length > 0 && memberQuery.trim().length < 3 ? posText("กรอกอย่างน้อย 3 ตัวอักษร")
                      : memberSearchStatus === 'loading' ? posText("กำลังค้นหาสมาชิก…")
                      : memberSearchStatus === 'success' && members.length === 0 ? posText("ไม่พบสมาชิกที่ตรงกับคำค้น")
                      : ''}
                  </div>
                  {memberSearchStatus === 'error' && <div className="pos-bg-member-error" role="alert">
                    <span>{memberSearchError}</span>
                    <button type="button" className="pos-ret-btn" onClick={() => setMemberSearchAttempt((value) => value + 1)}><ReloadOutlined /> {" " + posText("ลองอีกครั้ง")}</button>
                  </div>}
                  {members.length > 0 && <div className="pos-bg-member-results" aria-label={posText("ผลค้นหาสมาชิก")}>
                    {members.map((member) => <button key={member.customerId} type="button" className="pos-ret-btn pos-bg-member-option"
                      onClick={() => { setSelectedMember(member); setDraftName(''); setMemberQuery(''); setMembers([]); }}>
                      <b>{member.name || posText("สมาชิกไม่มีชื่อ")}</b>
                      <small>{[member.phone, member.memberNo].filter(Boolean).join(' · ')}</small>
                    </button>)}
                  </div>}
                </>}
              </div>
              <label className="pos-bg-field">
                {posText("อัตรา") + " "}<select value={draftRateId} onChange={(e) => setDraftRateId(e.target.value)}>
                  <option value="">{rates[0] ? posText("{v0} (฿{v1}/ชม.)", { v0: rates[0].name, v1: baht(rates[0].pricePerHour) }) : posText("ยังไม่มีอัตรา")}</option>
                  {rates.map((rate) => (
                    <option key={rate.id} value={rate.id}>{rate.name} · ฿{baht(rate.pricePerHour)}{posText("/ชม.")}</option>
                  ))}
                </select>
              </label>
              <label className="pos-bg-field pos-bg-field--num">
                {posText("กลุ่มบิล") + " "}<input value={draftGroup} onChange={(e) => setDraftGroup(e.target.value)} inputMode="numeric" />
              </label>
              <label className="pos-bg-field">
                {posText("เวลาของผู้เล่น") + " "}<select value={draftTimeMode} onChange={(e) => setDraftTimeMode(e.target.value as typeof draftTimeMode)}>
                  <option value="ACTUAL">{posText("คิดตามเวลาจริง")}</option>
                  {billingMode === 'FIXED_DURATION' && <option value="SESSION_END">{posText("เล่นถึงเวลาของโต๊ะ")}</option>}
                  <option value="DURATION">{posText("ซื้อเวลาจากตอนเข้า")}</option>
                </select>
              </label>
              {draftTimeMode === 'DURATION' && <label className="pos-bg-field pos-bg-field--num">
                {posText("นาทีที่ซื้อ") + " "}<input value={draftPersonalMinutes} onChange={(e) => setDraftPersonalMinutes(e.target.value)} inputMode="numeric" />
              </label>}
              <button type="button" className="pos-ret-btn pos-ret-btn--open" onClick={addDraft}>{posText("เพิ่มผู้เล่น")}</button>
            </div>

            {drafts.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {drafts.map((draft) => {
                  const rate = rates.find((item) => item.id === draft.rateId);
                  return (
                    <div key={draft.key} className="pos-bg-row">
                      <div className="pos-bg-row-main">
                        {draft.displayName}
                        <span style={{ color: 'var(--pos-muted)' }}>
                          {' · '}{rate?.name ?? posText("อัตราเริ่มต้น")}{posText(" · กลุ่ม ")}{draft.billingGroupNo}
                          {' · '}{draft.timeMode === 'ACTUAL' ? posText("คิดตามจริง") : draft.timeMode === 'SESSION_END' ? posText("ถึงเวลาโต๊ะ") : posText("{v0} นาที", { v0: draft.purchasedDurationMinutes })}
                          {draft.memberNo ? posText(" · สมาชิก {v0}", { v0: draft.memberNo }) : ''}
                        </span>
                      </div>
                      <button type="button" className="pos-ret-btn pos-ret-btn--danger"
                        onClick={() => setDrafts((rows) => rows.filter((row) => row.key !== draft.key))}>{posText("ลบ")}</button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pos-block-hint">
              {posText("ค่าเล่นคิดต่อคน — คนที่ไม่ถูกคิดเงิน (ผู้ชม/ผู้ปกครอง) ให้เลือกอัตราของประเภทนั้น") + " "}</div>
          </div>

          <button type="button" className="pos-ret-btn pos-ret-btn--solid pos-bg-action" style={{ marginTop: 12 }}
            disabled={(busy === 'open' || busy === 'waitlist-seat') || drafts.length === 0}
            onClick={() => {
              const overCapacity = drafts.length > openingTable.seats;
              if (overCapacity && !window.confirm(posText("โต๊ะนี้มี {v0} ที่นั่ง แต่กำลังเปิดให้ {v1} คน ยืนยันใช้โต๊ะเกินความจุหรือไม่?", { v0: openingTable.seats, v1: drafts.length }))) return;
              void run(seatingQueueId ? 'waitlist-seat' : 'open', seatingQueueId ? 'waitlist.seat' : 'open', {
              ...(seatingQueueId ? { entryId: seatingQueueId } : {}),
              tableId: openingTable.id,
              billingMode,
              expectedDurationMinutes: billingMode === 'FIXED_DURATION' ? Number(duration) || null : null,
              alertBeforeMinutes: Number(alertBefore) || 0,
              note,
              allowOverCapacity: overCapacity,
              participants: drafts.map((draft) => ({
                rateId: draft.rateId || null,
                customerId: draft.customerId,
                displayName: draft.displayName,
                billingGroupNo: draft.billingGroupNo,
                timeMode: draft.timeMode,
                purchasedDurationMinutes: draft.purchasedDurationMinutes,
              })),
            }, (data) => {
              resetOpenForm();
              setNotice(seatingQueueId ? posText("พาคิวไปนั่งและเปิดเวลาแล้ว") : posText("เปิดโต๊ะแล้ว"));
              // ไปยืนที่โต๊ะที่เพิ่งเปิดทันที — ขั้นถัดไปของคนหน้าเคาน์เตอร์คือยื่นกล่องเกม
              // และรับบัตร ซึ่งทั้งคู่ทำได้จากการ์ดของโต๊ะนั้นเท่านั้น
              const openedId = typeof data?.result?.id === 'string'
                ? data.result.id
                : typeof data?.result?.session?.id === 'string' ? data.result.session.id : '';
              if (openedId) selectTable(openedId);
            }); }}>
            {busy === 'open' || busy === 'waitlist-seat'
              ? posText("กำลังเปิด…")
              : seatingQueueId ? posText("พาคิวไปนั่ง ({v0} คน)", { v0: drafts.length }) : posText("เปิดโต๊ะ ({v0} คน)", { v0: drafts.length })}
          </button>
        </div>
      )}

      {/* โต๊ะที่จบไปแล้วระหว่างที่การ์ดเปิดอยู่ (อีกเครื่องเก็บเงิน/ยกเลิก) — การ์ดเต็มของโต๊ะที่
          จบแล้วมีแต่ปุ่มที่กดแล้วล้ม จึงเหลือแค่บอกว่าเกิดอะไรขึ้นและทางกลับไปที่ผัง */}
      {session && isTerminalSession(session.status) && (
        <div className="pos-bg-session-card">
          <div className="pos-block-title" style={{ marginBottom: 2 }}>
            {activeTable ? `${activeTable.code} · ${activeTable.name}` : posText("โต๊ะนี้")} · {tableStateLabel(session, posText)}
          </div>
          <div className="pos-block-hint">
            {session.status === 'PAID'
              ? posText("บิลของโต๊ะนี้ถูกเก็บเงินครบแล้ว")
              : posText("โต๊ะนี้ถูกยกเลิกแล้ว — ไม่มีการเก็บค่าเล่นของรอบนี้")}
          </div>
          <button type="button" className="pos-ret-btn pos-bg-action" style={{ marginTop: 10 }}
            onClick={() => { selectTable(''); setSession(null); setNotice(''); setError(''); }}>
            {posText("กลับไปที่ผังโต๊ะ") + " "}</button>
        </div>
      )}

      {/* ---------------- โต๊ะที่เปิดอยู่ ---------------- */}
      {session && !isTerminalSession(session.status) && (
        <div className="pos-bg-session-card">
          <div className="pos-bg-session-head pos-bg-session-hero">
            <div className="pos-bg-session-hero-top">
              <div className="pos-bg-session-heading">
                <div className="pos-block-title pos-bg-session-title">
                  {activeTable?.name ?? posText("โต๊ะที่เปิดอยู่")}
                </div>
                {activeTable && (
                  <span className="pos-bg-zone-badge">{areaName.get(activeTable.areaId) ?? posText("ไม่ระบุโซน")}</span>
                )}
              </div>
              <div className="pos-bg-session-badges">
                {session.alertStatus !== 'NORMAL' && (
                  <span className={`pos-bg-session-status pos-bg-session-status--${session.alertStatus.toLowerCase()}`}>
                    {detailStatusLabel(session, now, posText)}
                  </span>
                )}
                <span className="pos-bg-session-status pos-bg-session-status--playing">
                  {session.status === 'OPEN' ? posText("กำลังเล่น") : tableStateLabel(session, posText)}
                </span>
              </div>
            </div>
            <div className="pos-bg-session-meta">
              {activeTable?.code ? `${activeTable.code} · ` : ''}
              {session.billingMode === 'FIXED_DURATION' && session.expectedEndAt
                ? posText("ซื้อไว้ {v0} นาที · {v1}–{v2}", { v0: plannedMinutes(session), v1: timeLabel(session.startedAt), v2: timeLabel(session.expectedEndAt) })
                : posText("เปิดยาว · คิดตามจริง · เริ่ม {v0}", { v0: timeLabel(session.startedAt) })}
              {posText(" · เล่นมาแล้ว ")}{elapsedLabel(session.startedAt, now, posText)}
            </div>

            {/* ค่าเล่นของกลุ่ม OPEN ยังไม่ถูกแช่ จึงห้ามแสดง 0 เป็นยอดที่ต้องจ่าย */}
            <div className="pos-bg-session-money-note">
              <span className="pos-bg-session-money-icon" aria-hidden="true">▤</span>
              <div>
                <strong>{money.settled > 0 ? posText("ยอดที่ปิดแล้ว ฿{v0}", { v0: baht(money.settled) }) : posText("ยอดจะคำนวณเมื่อหยุดเวลา")}</strong>
                <span>
                  {money.openTab > 0
                    ? posText("ของที่สั่งในกลุ่มที่ยังเล่น ฿{v0} · ค่าเล่นจะคิดตอนปิดเวลา", { v0: baht(money.openTab) })
                    : money.stillPlaying
                      ? posText("ค่าเล่นของกลุ่มที่ยังเล่นอยู่จะคิดตอนปิดเวลา")
                      : posText("ค่าเล่นและของที่สั่งถูกปิดยอดแล้ว")}
                </span>
                {money.stillPlaying && <span>{t('admin_board_game.running_offer_hint')}</span>}
              </div>
            </div>
          </div>

          <div className="pos-bg-session-summary" aria-label={posText("สรุปโต๊ะ")}>
            <div><b>{activeSeating?.guestCount ?? session.participants.filter((participant) => !participant.leftAt).length}{activeTable ? `/${activeTable.seats}` : ''}</b><span>{activeTable && (activeSeating?.guestCount ?? session.guestCount) > activeTable.seats ? posText("คน · เกินความจุ") : posText("คน")}</span></div>
            <div><b>{activeSeating?.billingGroupCount ?? session.billingGroups.length}</b><span>{posText("กลุ่มบิล")}</span></div>
            <div>
              <b>{sharedSessionsReady ? seatingLoans.filter(({ loan }) => !loan.returnedAt).length : '…'}</b>
              <span>{posText("เกมยืม")}{sharedSeating ? posText("รวม") : ''}</span>
            </div>
            <div>
              <b>{sharedSessionsReady ? seatingHolds.filter(({ hold }) => hold.status === 'HELD').length : '…'}</b>
              <span>{posText("บัตรที่ถือ")}{sharedSeating ? posText("รวม") : ''}</span>
            </div>
          </div>

          {detailTab === 'overview' && (
          <div className="pos-bg-section pos-bg-section--service">
            <div className="pos-shift-head">
              <div>
                <div className="pos-block-title">{posText("🔔 เรียกพนักงาน")}</div>
                <div className="pos-block-hint">{posText("ออกลิงก์ให้ลูกค้าสแกน และรับงานของโต๊ะนี้")}</div>
              </div>
              <button type="button" className="pos-ret-btn"
                disabled={busy === 'service-access'}
                onClick={() => {
                  if (guestLink) {
                    setGuestLinkCopyState('idle');
                    setGuestLinkOpen(true);
                    return;
                  }
                  void run('service-access', 'service.access', {
                    sessionId: session.id,
                  }, (data) => {
                    const publicToken = data?.result?.token;
                    if (typeof publicToken !== 'string') return;
                    setGuestLink(new URL(`/bg/${publicToken}`, window.location.origin).toString());
                    setGuestLinkCopyState('idle');
                    setGuestLinkOpen(true);
                  });
                }}>
                {busy === 'service-access' ? posText("กำลังสร้าง…") : guestLink ? posText("เปิด QR / ลิงก์") : posText("สร้าง QR / ลิงก์")}
              </button>
            </div>
            {sessionCalls.map((item) => (
              <div key={item.id} className="pos-bg-row" style={{ marginTop: 8 }}>
                <div className="pos-bg-row-main">
                  {serviceCallLabel(item.requestCode, posText)}{item.requestNote ? ` · ${item.requestNote}` : ''}
                </div>
                <button type="button" className="pos-ret-btn pos-ret-btn--open"
                  disabled={busy === `service-${item.id}`}
                  onClick={() => void run(
                    `service-${item.id}`,
                    item.status === 'PENDING' ? 'service.acknowledge' : 'service.complete',
                    { callId: item.id },
                    () => setNotice(item.status === 'PENDING' ? posText("รับทราบคำเรียกแล้ว") : posText("ปิดงานแล้ว")),
                  )}>
                  {item.status === 'PENDING' ? posText("รับทราบ") : posText("เสร็จสิ้น")}
                </button>
              </div>
            ))}
          </div>
          )}

          <div className="pos-bg-detail-tabs" role="tablist" aria-label={posText("งานของโต๊ะนี้")}>
            {([
              ['overview', posText("ภาพรวม")],
              ['tab', posText("ของในบิล{v0}", { v0: session.billingGroups.some((group) => group.tabItems.length > 0) ? ` (${session.billingGroups.reduce((sum, group) => sum + group.tabItems.length, 0)})` : '' })],
              ['games', posText("เกมและบัตร{v0}", { v0: seatingLoans.some(({ loan }) => !loan.returnedAt) || seatingHolds.some(({ hold }) => hold.status === 'HELD') ? ' •' : '' })],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={detailTab === value}
                className={detailTab === value ? 'pos-bg-detail-tab pos-bg-detail-tab--on' : 'pos-bg-detail-tab'}
                onClick={() => setDetailTab(value)}>
                {label}
              </button>
            ))}
          </div>

          {/* `9.91`: หลาย session แชร์ seating เดียวกันหลังรวมโต๊ะ แต่เวลาและบิลยังเป็นของเดิม */}
          {(activeSeating?.sessionIds?.length ?? 0) > 1 && (
            <div className="pos-chips pos-bg-session-parties">
              <span className="pos-block-hint">{posText("ชุดลูกค้าที่โต๊ะนี้:")}</span>
              {activeSeating!.sessionIds!.map((id, index) => {
                const detail = sharedSessionDetails[id] ?? (id === session.id ? session : null);
                const origin = detail?.originTableCode ? posText("เดิม {v0}", { v0: detail.originTableCode }) : posText("ชุด {v0}", { v0: index + 1 });
                const people = detail?.participants.filter((participant) => !participant.leftAt).length;
                const games = detail?.games.filter((loan) => !loan.returnedAt).length;
                return (
                  <button key={id} type="button"
                    className={`pos-chip ${id === session.id ? 'pos-chip--personal' : ''}`}
                    style={{ border: 'none', cursor: 'pointer' }}
                    onClick={() => selectTable(id)}>
                    {origin}{detail ? posText(" · {v0} คน · {v1} เกม", { v0: people, v1: games }) : posText(" · กำลังโหลด")}
                    {id === session.id ? posText(" · กำลังดู") : ''}
                  </button>
                );
              })}
              {sharedSessionsError && (
                <span className="pos-block-hint" role="alert">{posText("โหลดทรัพย์สินรวมไม่ครบ ·") + " "}{sharedSessionsError}</span>
              )}
            </div>
          )}

          {detailTab === 'overview' && <>
          <details className="pos-bg-section pos-bg-section--advanced pos-bg-advanced-menu">
            <summary>{posText("งานเพิ่มเติม · ย้ายโต๊ะ / แก้เวลา / ยกเลิก")}</summary>
            <div className="pos-bg-advanced-group">
            <div className="pos-block-title">{posText("ย้าย / รวมโต๊ะ")}</div>
            <div className="pos-block-hint">
              {sharedSeating
                ? posText("โต๊ะนี้มีหลายชุดนั่งร่วมกัน — ย้ายไปโต๊ะว่างจะแยกเฉพาะชุดที่กำลังดูอยู่ออกไป ส่วนรวมโต๊ะจะพาไปทั้งโต๊ะ")
                : posText("ย้ายไปโต๊ะว่าง หรือรวมเข้ากับโต๊ะที่มีลูกค้าอยู่ได้ โดยเวลา บิล และของบน tab ของทุกกลุ่มยังแยกเหมือนเดิม")}
            </div>
            <div className="pos-bg-form">
              <label className="pos-bg-field">
                {posText("โต๊ะปลายทาง") + " "}<select value={seatingTargetId} onChange={(e) => setSeatingTargetId(e.target.value)}
                  style={{ display: 'block', width: '100%' }}>
                  <option value="">{posText("เลือกโต๊ะ")}</option>
                  {seatingTargets.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.code} · {table.name} · {table.openSession ? posText("มีลูกค้า — รวมโต๊ะ") : posText("ว่าง — ย้ายโต๊ะ")}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="pos-ret-btn pos-ret-btn--open"
                disabled={!seatingTargetId || busy === 'seating-relocate'}
                onClick={() => {
                  const target = seatingTargets.find((table) => table.id === seatingTargetId);
                  if (!target) { setError(posText("เลือกโต๊ะปลายทางก่อน")); return; }
                  const merging = Boolean(target.openSession);
                  const movingGuests = sharedSeating && !merging
                    ? session.guestCount
                    : (activeSeating?.guestCount ?? session.guestCount);
                  const resultingGuests = movingGuests + (merging ? Number(target.openSession?.guestCount ?? 0) : 0);
                  const overCapacity = resultingGuests > target.seats;
                  if (overCapacity && !window.confirm(posText("โต๊ะ {v0} มี {v1} ที่นั่ง หลังทำรายการจะมี {v2} คน ยืนยันใช้โต๊ะเกินความจุหรือไม่?", { v0: target.code, v1: target.seats, v2: resultingGuests }))) return;
                  void run('seating-relocate', merging ? 'seating.merge' : 'seating.move', {
                    sessionId: session.id,
                    targetTableId: target.id,
                    allowOverCapacity: overCapacity,
                  }, () => {
                    setSeatingTargetId('');
                    setNotice(merging
                      ? posText("รวมเข้ากับโต๊ะ {v0} แล้ว — เวลาและบิลทุกใบยังแยกเดิม", { v0: target.code })
                      : sharedSeating
                        ? posText("แยกชุดนี้ไปโต๊ะ {v0} แล้ว — ชุดอื่นยังอยู่โต๊ะเดิม", { v0: target.code })
                        : posText("ย้ายไปโต๊ะ {v0} แล้ว", { v0: target.code }));
                  });
                }}>
                {busy === 'seating-relocate'
                  ? posText("กำลังย้าย…")
                  : sharedSeating ? posText("ยืนยันแยกชุดนี้ / รวมโต๊ะ") : posText("ยืนยันย้าย / รวมโต๊ะ")}
              </button>
            </div>
            </div>

            {session.billingGroups.filter((group) => group.status === 'OPEN').length > 1 && (
              <div className="pos-bg-advanced-group">
                <div className="pos-block-title">{posText("แยกกลุ่มไปโต๊ะใหม่")}</div>
                <div className="pos-block-hint">{posText("ย้ายเฉพาะผู้เล่น เวลา และ tab ของกลุ่มที่เลือกไปโต๊ะว่าง · เลือกเกมและบัตรที่ต้องตามกลุ่มไปให้ชัดเจน")}</div>
                <div className="pos-bg-form">
                  <label className="pos-bg-field">{posText("กลุ่มบิล") + " "}<select value={detachGroupId} onChange={(e) => setDetachGroupId(e.target.value)}>
                      <option value="">{posText("เลือกกลุ่ม")}</option>
                      {session.billingGroups.filter((group) => group.status === 'OPEN').map((group) =>
                        <option key={group.id} value={group.id}>{posText("กลุ่ม") + " "}{group.groupNo}</option>)}
                    </select>
                  </label>
                  <label className="pos-bg-field">{posText("โต๊ะว่างปลายทาง") + " "}<select value={detachTargetId} onChange={(e) => setDetachTargetId(e.target.value)}>
                      <option value="">{posText("เลือกโต๊ะ")}</option>
                      {seatingTargets.filter((table) => !table.openSession).map((table) =>
                        <option key={table.id} value={table.id}>{table.code} · {table.name} · {table.seats} {" " + posText("ที่")}</option>)}
                    </select>
                  </label>
                </div>
                {session.games.some((loan) => loan.status === 'CHECKED_OUT') && <div className="pos-bg-split-list">
                  <div className="pos-block-hint">{posText("เกมที่ย้ายตามไป")}</div>
                  {session.games.filter((loan) => loan.status === 'CHECKED_OUT').map((loan) => <label key={loan.id}>
                    <input type="checkbox" checked={detachLoanIds.includes(loan.id)} onChange={(e) => {
                      setDetachLoanIds((ids) => e.target.checked ? [...new Set([...ids, loan.id])] : ids.filter((id) => id !== loan.id));
                      if (!e.target.checked) {
                        setDetachHoldIds((ids) => ids.filter((id) => session.identityHolds.find((hold) => hold.id === id)?.loanId !== loan.id));
                      }
                    }} />
                    {' '}{loan.title} · {loan.copyCode}
                  </label>)}
                </div>}
                {session.identityHolds.some((hold) => hold.status === 'HELD') && <div className="pos-bg-split-list">
                  <div className="pos-block-hint">{posText("บัตรที่ย้ายตามไป")}</div>
                  {session.identityHolds.filter((hold) => hold.status === 'HELD').map((hold) => <label key={hold.id}>
                    <input type="checkbox" checked={detachHoldIds.includes(hold.id)} onChange={(e) => {
                      setDetachHoldIds((ids) => e.target.checked ? [...new Set([...ids, hold.id])] : ids.filter((id) => id !== hold.id));
                      if (e.target.checked && hold.loanId) {
                        setDetachLoanIds((ids) => [...new Set([...ids, hold.loanId!])]);
                      }
                    }} />
                    {' '}{hold.holderName ?? IDENTITY_KIND_LABEL(posText)[hold.documentKind] ?? hold.documentKind}
                  </label>)}
                </div>}
                <button type="button" className="pos-ret-btn pos-ret-btn--open"
                  disabled={!detachGroupId || !detachTargetId || busy === 'group-detach'}
                  onClick={() => {
                    const target = seatingTargets.find((table) => table.id === detachTargetId && !table.openSession);
                    const group = session.billingGroups.find((item) => item.id === detachGroupId);
                    if (!target || !group) { setError(posText("เลือกกลุ่มและโต๊ะว่างปลายทางก่อน")); return; }
                    const groupGuests = session.participants.filter((participant) => participant.billingGroupId === group.id && !participant.leftAt).length;
                    const overCapacity = groupGuests > target.seats;
                    if (overCapacity && !window.confirm(posText("โต๊ะ {v0} มี {v1} ที่นั่ง แต่กลุ่มนี้มี {v2} คน ยืนยันหรือไม่?", { v0: target.code, v1: target.seats, v2: groupGuests }))) return;
                    if (!window.confirm(posText("แยกกลุ่ม {v0} ไปโต๊ะ {v1} หรือไม่?", { v0: group.groupNo, v1: target.code }))) return;
                    void run('group-detach', 'group.detach', {
                      billingGroupId: group.id, targetTableId: target.id,
                      loanIds: detachLoanIds, identityHoldIds: detachHoldIds,
                      allowOverCapacity: overCapacity,
                    }, (data) => {
                      setDetachGroupId(''); setDetachTargetId(''); setDetachLoanIds([]); setDetachHoldIds([]);
                      const newSessionId = typeof data?.result?.sessionId === 'string' ? data.result.sessionId : '';
                      if (newSessionId) selectTable(newSessionId);
                      setNotice(posText("แยกกลุ่ม {v0} ไปโต๊ะ {v1} แล้ว", { v0: group.groupNo, v1: target.code }));
                    });
                  }}>{posText("ยืนยันแยกกลุ่มไปโต๊ะใหม่")}</button>
              </div>
            )}

            {session.status === 'OPEN' && (
              <div className="pos-bg-advanced-group">
                <div className="pos-block-title">{posText("แก้เวลา")}</div>
                <div className="pos-block-hint">
                  {session.billingMode === 'FIXED_DURATION'
                    ? posText("ซื้อไว้ {v0} นาที", { v0: plannedMinutes(session) })
                    : posText("เปิดยาว — คิดตามเวลาที่เล่นจริง ยังไม่ได้ซื้อเวลาไว้ล่วงหน้า")}
                </div>
                <div className="pos-bg-form">
                  <label className="pos-bg-field pos-bg-field--num">
                    {posText("เวลาที่ซื้อ (นาที)") + " "}<input value={planMinutes} onChange={(e) => setPlanMinutes(e.target.value)} inputMode="numeric" />
                  </label>
                  <label className="pos-bg-field pos-bg-field--num">
                    {posText("เตือนก่อนหมดเวลา (นาที)") + " "}<input value={planAlert} onChange={(e) => setPlanAlert(e.target.value)} inputMode="numeric" />
                  </label>
                  <button type="button" className="pos-ret-btn pos-ret-btn--open" disabled={busy === 'timing'}
                    onClick={() => {
                      const minutes = Number(planMinutes);
                      if (!Number.isFinite(minutes) || minutes < 1) { setError(posText("ใส่เวลาที่ซื้อเป็นนาทีก่อน")); return; }
                      void run('timing', 'timing', {
                        sessionId: session.id,
                        billingMode: 'FIXED_DURATION',
                        expectedDurationMinutes: Math.round(minutes),
                        alertBeforeMinutes: Number(planAlert) || 0,
                      }, () => setNotice(posText("บันทึกเวลาที่ซื้อแล้ว")));
                    }}>
                    {busy === 'timing' ? posText("กำลังบันทึก…") : posText("บันทึกเวลาที่ซื้อ")}
                  </button>
                  {session.billingMode === 'FIXED_DURATION' && (
                    <button type="button" className="pos-ret-btn" disabled={busy === 'timing'}
                      onClick={() => void run('timing', 'timing', {
                        sessionId: session.id,
                        billingMode: 'OPEN_ENDED',
                        expectedDurationMinutes: null,
                        alertBeforeMinutes: Number(planAlert) || 0,
                      }, () => setNotice(posText("เปลี่ยนเป็นเปิดยาวแล้ว")))}>
                      {posText("เปลี่ยนเป็นเปิดยาว") + " "}</button>
                  )}
                </div>
              </div>
            )}

            {session.status !== 'PAID' && (
              <div className="pos-bg-advanced-group pos-bg-advanced-group--danger">
                <div className="pos-block-title">{posText("ยกเลิกโต๊ะ")}</div>
                <div className="pos-block-hint">
                  {posText("ใช้เมื่อไม่เก็บเงินเวลารอบนี้ — ต้องระบุเหตุผลเพื่อเก็บหลักฐาน") + " "}</div>
                <div className="pos-bg-form">
                  <label className="pos-bg-field">
                    {posText("เหตุผลที่ยกเลิกโต๊ะ") + " "}<input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                      placeholder={posText("เช่น ลูกค้าเปลี่ยนใจก่อนเริ่มเล่น")} />
                  </label>
                  <button type="button" className="pos-ret-btn pos-ret-btn--danger"
                    disabled={!cancelReason.trim() || busy === 'cancel'}
                    onClick={() => void run('cancel', 'cancel', {
                      sessionId: session.id, reason: cancelReason.trim(),
                    }, () => { setCancelReason(''); selectTable(''); setSession(null); setNotice(posText("ยกเลิกโต๊ะแล้ว")); })}>
                    {posText("ยืนยันยกเลิกโต๊ะ") + " "}</button>
                </div>
              </div>
            )}
          </details>

          {/* ผู้เล่น */}
          <div className="pos-block pos-bg-section pos-bg-section--players">
            <div className="pos-bg-section-head">
              <div className="pos-block-title">{posText("รายชื่อผู้เล่น")}</div>
              <span>{session.participants.filter((p) => !p.leftAt).length} {" " + posText("คนในโต๊ะ")}</span>
            </div>
            <div className="pos-bg-player-groups">
              {participantGroups.map(({ group, participants }) => {
                const activeParticipants = participants.filter((participant) => !participant.leftAt);
                const billableRates = [...new Set(activeParticipants
                  .filter((participant) => participant.billable)
                  .map((participant) => participant.hourlyRate))];
                return (
                  <div key={group.id} className="pos-bg-player-group">
                    <div className="pos-bg-player-group-head">
                      <strong>{posText("› กลุ่มบิล") + " "}{group.groupNo}</strong>
                      <span>{activeParticipants.length} {" " + posText("คน")}</span>
                      <span className="pos-bg-player-rate">
                        {billableRates.length === 1
                          ? posText("฿{v0}/ชม.", { v0: baht(billableRates[0]) })
                          : billableRates.length > 1 ? posText("หลายอัตรา") : posText("ไม่คิดเงิน")}
                      </span>
                    </div>
                    {participants.map((participant, index) => (
                      <div key={participant.id} className={`pos-bg-player-row ${participant.leftAt ? 'pos-bg-player-row--past' : ''}`.trim()}>
                        <span className="pos-bg-player-index">{index + 1}</span>
                        <div className="pos-bg-player-name">
                          <strong>{participant.displayName ?? posText("ไม่ระบุชื่อ")}</strong>
                          <span className="pos-bg-player-rate-line">
                            {rateLabel(participant, posText)}
                            {participant.billingGroupStatus === 'PAID' ? posText(" · จ่ายแล้ว")
                              : participant.billingGroupStatus === 'CLOSING' ? posText(" · รอเก็บเงิน") : ''}
                            {participant.leftAt ? posText(" · ออกแล้ว") : ''}
                          </span>
                          <span className="pos-bg-player-time-line">
                            {timeLabel(participant.joinedAt)}–{participant.leftAt ? timeLabel(participant.leftAt) : posText("ตอนนี้")}
                            {' · '}{durationBetweenLabel(participant.joinedAt, participant.leftAt, now, posText)}
                            {participant.plannedEndAt ? posText(" · ถึง {v0}", { v0: timeLabel(participant.plannedEndAt) }) : posText(" · คิดตามจริง")}
                            {(() => {
                              const frozen = group.chargeSnapshot.find((line) => line.participantId === participant.id);
                              return frozen && frozen.billableMinutes !== frozen.actualMinutes
                                ? posText(" · คิดเงิน {v0}", { v0: minutesLabel(frozen.billableMinutes, posText) }) : '';
                            })()}
                          </span>
                        </div>
                        {!participant.leftAt && participant.billingGroupStatus === 'OPEN' && (
                          <details className="pos-bg-player-menu">
                            <summary aria-label={posText("จัดการ {v0}", { v0: participant.displayName ?? posText("ผู้เล่น") })}>⋮</summary>
                            <div>
                              <button type="button" disabled={busy === `leave-${participant.id}`}
                                onClick={() => void run(`leave-${participant.id}`, 'participant.leave', {
                                  sessionId: session.id, participantId: participant.id,
                                }, () => setNotice(posText("บันทึกคนออกจากโต๊ะแล้ว")))}>
                                {posText("ออกจากโต๊ะ") + " "}</button>
                            </div>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {session.status === 'OPEN' && showAddParticipant && (
              <div className="pos-bg-add-player-form" ref={addParticipantRef}>
                <div className="pos-bg-form">
                <label className="pos-bg-field">
                  {posText("เพิ่มผู้เล่น") + " "}<input value={draftName} onChange={(e) => setDraftName(e.target.value)}
                    placeholder={posText("ชื่อผู้เล่น")} />
                </label>
                <label className="pos-bg-field">
                  {posText("อัตรา") + " "}<select value={draftRateId} onChange={(e) => setDraftRateId(e.target.value)}>
                    <option value="">{posText("อัตราเริ่มต้น")}</option>
                    {rates.map((rate) => (
                      <option key={rate.id} value={rate.id}>{rate.name} · ฿{baht(rate.pricePerHour)}{posText("/ชม.")}</option>
                    ))}
                  </select>
                </label>
                <label className="pos-bg-field pos-bg-field--num">
                  {posText("กลุ่มบิล") + " "}<input value={draftGroup} onChange={(e) => setDraftGroup(e.target.value)} inputMode="numeric" />
                </label>
                <label className="pos-bg-field">
                  {posText("เวลา") + " "}<select value={draftTimeMode} onChange={(e) => setDraftTimeMode(e.target.value as typeof draftTimeMode)}>
                    <option value="ACTUAL">{posText("คิดตามจริง")}</option>
                    {session.billingMode === 'FIXED_DURATION' && <option value="SESSION_END">{posText("ถึงเวลาของโต๊ะ")}</option>}
                    <option value="DURATION">{posText("ซื้อเวลาจากตอนนี้")}</option>
                  </select>
                </label>
                {draftTimeMode === 'DURATION' && <label className="pos-bg-field pos-bg-field--num">
                  {posText("นาทีที่ซื้อ") + " "}<input value={draftPersonalMinutes} onChange={(e) => setDraftPersonalMinutes(e.target.value)} inputMode="numeric" />
                </label>}
                <button type="button" className="pos-ret-btn pos-ret-btn--open" disabled={busy === 'add-participant'}
                  onClick={() => {
                    if (!draftName.trim()) { setError(posText("ใส่ชื่อผู้เล่นก่อน")); return; }
                    const nextGuestCount = (activeSeating?.guestCount ?? session.guestCount) + 1;
                    const overCapacity = Boolean(activeTable && nextGuestCount > activeTable.seats);
                    if (overCapacity && !window.confirm(posText("โต๊ะนี้มี {v0} ที่นั่ง การเพิ่มคนนี้จะเป็น {v1} คน ยืนยันหรือไม่?", { v0: activeTable?.seats ?? 0, v1: nextGuestCount }))) return;
                    const requestedMinutes = Number(draftPersonalMinutes);
                    const personalMinutes = draftTimeMode === 'DURATION' && Number.isInteger(requestedMinutes) ? requestedMinutes : null;
                    if (draftTimeMode === 'DURATION' && (!personalMinutes || personalMinutes < 1 || personalMinutes > 1440)) { setError(posText("ใส่เวลาที่ซื้อ 1–1,440 นาที")); return; }
                    void run('add-participant', 'participant.add', {
                      sessionId: session.id,
                      displayName: draftName.trim(),
                      rateId: draftRateId || null,
                      billingGroupNo: Math.max(1, Number(draftGroup) || 1),
                      timeMode: draftTimeMode,
                      purchasedDurationMinutes: personalMinutes,
                      allowOverCapacity: overCapacity,
                    }, () => { setDraftName(''); setNotice(posText("เพิ่มผู้เล่นแล้ว")); });
                  }}>
                  {posText("เพิ่ม") + " "}</button>
                </div>
              </div>
            )}
          </div>

          <div className="pos-block pos-bg-section pos-bg-section--preclose">
            <div className="pos-bg-section-head">
              <div className="pos-block-title">{posText("สถานะก่อนปิดบิล")}</div>
              <span>{posText("ตรวจเกมและบัตรค้ำ")}</span>
            </div>
            {session.games.filter((loan) => !loan.returnedAt).map((loan) => (
              <div key={`preview-game-${loan.id}`} className="pos-bg-row">
                <div className="pos-bg-row-main">{loan.title ?? posText("เกม")} · {loan.copyCode ?? '-'}</div>
                <span className="pos-bg-row-state pos-bg-row-state--warn">{posText("ยังไม่คืน")}</span>
              </div>
            ))}
            {session.identityHolds.filter((hold) => hold.status === 'HELD').map((hold) => (
              <div key={`preview-hold-${hold.id}`} className="pos-bg-row">
                <div className="pos-bg-row-main">
                  {IDENTITY_KIND_LABEL(posText)[hold.documentKind] ?? hold.documentKind}
                  {hold.documentNumberTail ? posText(" · ลงท้าย {v0}", { v0: hold.documentNumberTail }) : ''}
                </div>
                <span className="pos-bg-row-state pos-bg-row-state--warn">{posText("ร้านถือไว้")}</span>
              </div>
            ))}
            {!session.games.some((loan) => !loan.returnedAt)
              && !session.identityHolds.some((hold) => hold.status === 'HELD') && (
                <div className="pos-block-hint">{posText("พร้อมปิดบิล — ไม่มีเกมหรือบัตรค้ำค้างอยู่")}</div>
            )}
          </div>
          </>}

          {/* ของที่สั่งเข้าบิลระหว่างเล่น (`9.90`) — ต่อกลุ่ม เพราะแต่ละกลุ่มจ่ายคนละใบ */}
          {detailTab === 'tab' && (
          <div className="pos-block pos-bg-section pos-bg-section--tab">
            <div className="pos-block-title">{posText("ของที่สั่งเข้าบิล")}</div>
            <div className="pos-block-hint">
              {posText("ของออกจากตู้ตอนนี้ ระบบจึงจองสต็อกทันที — ยอดจะไปรวมกับค่าเล่นในบิลใบเดียวกันตอนเก็บเงิน") + " "}</div>
            {session.billingGroups.map((group) => (
              <div key={group.id} style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {session.billingGroups.length > 1 ? posText("กลุ่ม {v0}", { v0: group.groupNo }) : posText("บิลของโต๊ะนี้")}
                  <span style={{ color: 'var(--pos-muted)', fontWeight: 400 }}>
                    {posText(" · ของบนบิล ฿")}{baht(group.tabAmount)}
                    {group.status === 'CLOSING' ? posText(" · ค่าเล่นที่ปิดแล้ว ฿{v0}", { v0: baht(group.amountDue) }) : ''}
                  </span>
                </div>
                {group.tabItems.length === 0 && (
                  <div className="pos-block-hint">{posText("ยังไม่มีของบนบิลนี้")}</div>
                )}
                {group.tabItems.map((item) => (
                  <div key={item.id} className="pos-bg-row">
                    <div className="pos-bg-row-main">
                      {item.productName} × {item.packQty}
                      <span style={{ color: 'var(--pos-muted)' }}>
                        {item.unitName ? ` ${item.unitName}` : ''}
                        {item.modifierNames.length ? ` · ${item.modifierNames.join(', ')}` : ''}
                      </span>
                    </div>
                    {group.status === 'OPEN' && (
                      <button type="button" className="pos-ret-btn pos-ret-btn--danger"
                        disabled={busy === `tab-remove-${item.id}`}
                        onClick={() => void run(`tab-remove-${item.id}`, 'tab.remove', {
                          billingGroupId: group.id, itemId: item.id,
                        }, () => setNotice(posText("เอาออกจากบิลแล้ว")))}>
                        {posText("เอาออก") + " "}</button>
                    )}
                  </div>
                ))}
                {group.status === 'OPEN' && (
                  <div className="pos-bg-form">
                    <label className="pos-bg-field">
                      {posText("บาร์โค้ด / รหัสสินค้า") + " "}{/* ⚠️ แท็บนี้ปิดตัวจับบาร์โค้ดรวมของเครื่องขายไว้โดยตั้งใจ
                          (`resolveScanContext` คืน DISABLED) เครื่องสแกนจึงพิมพ์รหัสลงช่องนี้
                          ตรง ๆ แล้วจบด้วย Enter · ช่องนี้ไม่ได้อยู่ใน <form> การไม่รับ Enter
                          แปลว่ายิงบาร์โค้ดแล้ว "ไม่มีอะไรเกิดขึ้น" ทั้งที่ placeholder สัญญาไว้ */}
                      <input
                        value={tabGroupId === group.id ? tabSku : ''}
                        onChange={(e) => { setTabGroupId(group.id); setTabSku(e.target.value); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTabItem(group.id); } }}
                        placeholder={posText("ยิงบาร์โค้ดหรือพิมพ์รหัส")} />
                    </label>
                    <label className="pos-bg-field pos-bg-field--num">
                      {posText("จำนวน") + " "}<input value={tabGroupId === group.id ? tabQty : '1'} inputMode="numeric"
                        onChange={(e) => { setTabGroupId(group.id); setTabQty(e.target.value); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTabItem(group.id); } }} />
                    </label>
                    <button type="button" className="pos-ret-btn pos-ret-btn--open"
                      disabled={busy === 'tab-add' || tabGroupId !== group.id || !tabSku.trim()}
                      onClick={() => addTabItem(group.id)}>
                      {posText("เพิ่มเข้าบิล") + " "}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          )}

          {/* เกมที่ยืมอยู่ */}
          {detailTab === 'games' && <>
          <div className="pos-block pos-bg-section pos-bg-section--games">
            <div className="pos-block-title">{posText("เกมที่ยืม")}{sharedSeating ? posText("ทั้งหมดบนโต๊ะนี้") : ''}</div>
            {sharedSessionsLoading && sharedSeating && (
              <div className="pos-block-hint">{posText("กำลังตรวจเกมของทุกชุดลูกค้า…")}</div>
            )}
            {!sharedSessionsLoading && seatingLoans.length === 0 && (
              <div className="pos-block-hint">{posText("ยังไม่ได้ยืมกล่องเกม")}</div>
            )}
            {seatingLoans.some(({ loan }) => !loan.returnedAt) && <>
            <BoardGameCopyPicker
              key={`return-${session.id}`} value={returnLoanId} onChange={setReturnLoanId}
              disabled={Boolean(busy) || sharedSessionsLoading} selectableStatus="CHECKED_OUT"
              titles={seatingLoans.filter(({ loan }) => !loan.returnedAt).map(({ loan }) => ({
                id: loan.id, title: loan.title ?? '',
                imageUrl: workspace?.library.find((title) => title.copies.some((copy) => copy.id === loan.copyId))?.imageUrl,
                copies: [{ id: loan.id, copyCode: loan.copyCode ?? '', status: 'CHECKED_OUT' }],
              }))}
              placeholder={t('admin_board_game.return_scan')} emptyText={t('admin_board_game.return_scan_empty')}
              statusLabel={() => t('admin_board_game.return_scan_status')} />
            <div className="pos-bg-form">
              <label className="pos-bg-field">
                {posText("โน้ตตอนคืน") + " "}<input value={returnNote} disabled={Boolean(busy)} onChange={(e) => setReturnNote(e.target.value)} />
              </label>
            </div>
            </>}
            {seatingLoans.filter(({ loan }) => !returnLoanId || loan.id === returnLoanId).map(({ detail, loan }) => (
              <div key={loan.id} className="pos-bg-row">
                <div className="pos-bg-row-main">
                  {loan.title ?? posText("เกม")}
                  <span style={{ color: 'var(--pos-muted)' }}>{' · '}{loan.copyCode ?? '-'}{' · '}{loan.status}</span>
                  {sharedSeating && (
                    <span style={{ color: 'var(--pos-muted)' }}>
                      {' · '}{detail.originTableCode ? posText("เดิม {v0}", { v0: detail.originTableCode }) : posText("ชุดลูกค้าเดิม")}
                    </span>
                  )}
                </div>
                {!loan.returnedAt && (
                  <div className="pos-bg-row-actions">
                    <button type="button" className="pos-ret-btn" disabled={Boolean(busy)}
                      onClick={() => void run(`return-${loan.id}`, 'copy.return', {
                        loanId: loan.id, status: 'RETURNED', copyStatus: 'AVAILABLE', returnNote,
                      }, () => { setReturnNote(''); setReturnLoanId(''); setNotice(posText("รับเกมคืนแล้ว")); })}>
                      {posText("รับคืน") + " "}</button>
                    <button type="button" className="pos-ret-btn pos-ret-btn--warn" disabled={Boolean(busy)}
                      onClick={() => void run(`issue-${loan.id}`, 'copy.return', {
                        loanId: loan.id, status: 'ISSUE', copyStatus: 'NEEDS_CHECK', returnNote,
                      }, () => { setReturnNote(''); setReturnLoanId(''); setNotice(posText("บันทึกว่าต้องตรวจกล่องนี้แล้ว")); })}>
                      {posText("คืนแบบมีปัญหา") + " "}</button>
                  </div>
                )}
              </div>
            ))}

            {session.status === 'OPEN' && (
              <div className="pos-bg-form pos-bg-loan-form">
                <label className="pos-bg-field">
                  {posText("ให้ยืมกล่องเกม")}{sharedSeating ? posText("แก่ชุดเดิม {v0}", { v0: session.originTableCode }) : ''}
                  <BoardGameCopyPicker key={session.id} titles={workspace?.library ?? []}
                    value={copyId} onChange={setCopyId} disabled={Boolean(busy)}
                    placeholder={posText("ค้นหาชื่อเกม / รหัสกล่อง / สแกนบาร์โค้ด")}
                    emptyText={posText("ไม่พบเกมหรือรหัสกล่องนี้")}
                    statusLabel={(status) => ({ AVAILABLE: posText("พร้อมให้ยืม"), IN_USE: posText("กำลังยืม"), NEEDS_CHECK: posText("รอตรวจ"), DAMAGED: posText("เสียหาย"), MISSING_PARTS: posText("อุปกรณ์ไม่ครบ"), REPAIRING: posText("กำลังซ่อม"), LOST: posText("สูญหาย"), RETIRED: posText("เลิกใช้งาน") }[status] ?? status)} />
                </label>
                <button type="button" className="pos-ret-btn pos-ret-btn--open" disabled={Boolean(busy) || !(workspace?.library ?? []).some((title) => title.copies.some((copy) => copy.id === copyId && copy.status === 'AVAILABLE'))}
                  onClick={() => void run('checkout-copy', 'copy.checkout', {
                    sessionId: session.id, copyId,
                  }, () => { setCopyId(''); setNotice(posText("ให้ยืมกล่องเกมแล้ว")); })}>
                  {posText("ให้ยืม") + " "}</button>
              </div>
            )}
          </div>

          {/* บัตรที่รับไว้ค้ำกล่องเกม (`9.93`)
              อยู่ติดกับกล่องเกมเพราะเป็นการกระทำเดียวกันที่เคาน์เตอร์: ยื่นกล่อง รับบัตร ·
              **จอนี้ไม่มีทางอ่านเลขเต็ม** — จอเครื่องขายหันออกทางลูกค้าและแชร์กันทั้งกะ
              การอ่านเลขกลับออกมาอยู่ที่ /admin/board-game ซึ่งมีสิทธิ์ของตัวเอง */}
          <div className="pos-block pos-bg-section pos-bg-section--identity">
            <div className="pos-block-title">{posText("บัตรที่รับไว้")}{sharedSeating ? posText("ทั้งหมดบนโต๊ะนี้") : ''}</div>
            {sharedSessionsLoading && sharedSeating && (
              <div className="pos-block-hint">{posText("กำลังตรวจบัตรของทุกชุดลูกค้า…")}</div>
            )}
            {!sharedSessionsLoading && seatingHolds.filter(({ hold }) => hold.status === 'HELD').length === 0 && (
              <div className="pos-block-hint">{posText("ไม่ได้ถือบัตรของโต๊ะนี้ไว้")}</div>
            )}
            {seatingHolds.map(({ detail, hold }) => (
              <div key={hold.id} className="pos-bg-row">
                <div className="pos-bg-row-main">
                  {hold.status === 'RETURNED'
                    ? <span style={{ color: 'var(--pos-muted)' }}>{posText("คืนบัตรแล้ว ·") + " "}{IDENTITY_KIND_LABEL(posText)[hold.documentKind] ?? hold.documentKind}</span>
                    : <>
                        {hold.holderName ?? '-'}
                        <span style={{ color: 'var(--pos-muted)' }}>
                          {' · '}{IDENTITY_KIND_LABEL(posText)[hold.documentKind] ?? hold.documentKind}
                          {hold.documentNumberTail ? posText(" · ลงท้าย {v0}", { v0: hold.documentNumberTail }) : posText(" · ไม่ได้บันทึกเลข")}
                        </span>
                      </>}
                  {sharedSeating && (
                    <span style={{ color: 'var(--pos-muted)' }}>
                      {' · '}{detail.originTableCode ? posText("เดิม {v0}", { v0: detail.originTableCode }) : posText("ชุดลูกค้าเดิม")}
                    </span>
                  )}
                </div>
                {hold.status === 'HELD' && (
                  <button type="button" className="pos-ret-btn" disabled={busy === `id-release-${hold.id}`}
                    onClick={() => void run(`id-release-${hold.id}`, 'identity.release', {
                      holdId: hold.id,
                    }, () => setNotice(posText("คืนบัตรให้ลูกค้าแล้ว — ลบเลขที่เก็บไว้ทิ้งด้วย")))}>
                    {posText("คืนบัตร") + " "}</button>
                )}
              </div>
            ))}

            {session.status === 'OPEN' && (
              <div className="pos-bg-form">
                <label className="pos-bg-field">
                  {posText("ชนิดบัตร")}{sharedSeating ? posText(" · ชุดเดิม {v0}", { v0: session.originTableCode }) : ''}
                  <select value={idKind} onChange={(e) => setIdKind(e.target.value)}>
                    {Object.entries(IDENTITY_KIND_LABEL(posText)).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="pos-bg-field">
                  {posText("ชื่อบนบัตร") + " "}<input value={idHolder} onChange={(e) => setIdHolder(e.target.value)} />
                </label>
                {/* เลขไม่บังคับ — ร้านที่เก็บบัตรจริงไว้โดยไม่พิมพ์เลขก็ยังได้ด่านตอนปิดบิล
                    การบังคับพิมพ์จะไล่ร้านกลับไปใช้กระดาษ ซึ่งแย่กว่าทุกทาง */}
                <label className="pos-bg-field">
                  {posText("เลขบัตร (ไม่บังคับ)") + " "}<input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
                </label>
                <label className="pos-bg-field">
                  {posText("ค้ำกล่องเกม (ไม่บังคับ)") + " "}<select value={idLoanId} onChange={(e) => setIdLoanId(e.target.value)}>
                    <option value="">{posText("ไม่ระบุกล่อง")}</option>
                    {session.games.filter((loan) => !loan.returnedAt).map((loan) => (
                      <option key={loan.id} value={loan.id}>{loan.title ?? posText("เกม")} · {loan.copyCode ?? '-'}</option>
                    ))}
                  </select>
                </label>
                <button type="button" className="pos-ret-btn pos-ret-btn--open"
                  disabled={!idHolder.trim() || busy === 'identity-hold'}
                  onClick={() => void run('identity-hold', 'identity.hold', {
                    sessionId: session.id,
                    documentKind: idKind,
                    holderName: idHolder.trim(),
                    documentNumber: idNumber.trim(),
                    loanId: idLoanId,
                  }, () => { setIdHolder(''); setIdNumber(''); setIdLoanId(''); setNotice(posText("รับบัตรไว้แล้ว")); })}>
                  {posText("รับบัตรไว้") + " "}</button>
              </div>
            )}
          </div>
          </>}

          {/* ปิดโต๊ะ / เก็บเงิน */}
          <div className="pos-block pos-bg-section pos-bg-section--checkout">
            <div className="pos-block-title">{posText("หยุดเวลา / เก็บเงิน")}</div>
            {session.billingGroups.filter((group) => group.status === 'OPEN').length > 1 && (() => {
              const openGroups = session.billingGroups.filter((group) => group.status === 'OPEN');
              const target = openGroups[0];
              return <div className="pos-bg-actions-stack" style={{ marginTop: 8 }}>
                <div className="pos-block-hint">{posText("ลูกค้าต้องการใบเสร็จเดียว ให้รวมกลุ่มก่อนหยุดเวลา · ผู้เล่นและของบน tab จะไปอยู่บิลปลายทาง")}</div>
                {openGroups.slice(1).map((source) => <button key={source.id} type="button"
                  className="pos-ret-btn pos-bg-secondary-action pos-bg-action"
                  disabled={busy === `group-merge-${source.id}`}
                  onClick={() => {
                    if (!window.confirm(posText("รวมกลุ่ม {v0} เข้ากลุ่ม {v1} เป็นบิลเดียวหรือไม่?", { v0: source.groupNo, v1: target.groupNo }))) return;
                    void run(`group-merge-${source.id}`, 'group.merge', {
                      sourceBillingGroupId: source.id,
                      targetBillingGroupId: target.id,
                    }, () => setNotice(posText("รวมกลุ่ม {v0} เข้ากลุ่ม {v1} แล้ว", { v0: source.groupNo, v1: target.groupNo })));
                  }}>
                  {posText("รวมกลุ่ม") + " "}{source.groupNo} {" " + posText("→ กลุ่ม") + " "}{target.groupNo}
                </button>)}
              </div>;
            })()}
            {showCloseChoices && session.billingGroups.length > 1 && session.billingGroups.some((group) => group.status === 'OPEN') && (
              <div className="pos-bg-actions-stack pos-bg-close-choices" ref={closeChoicesRef}>
                <div className="pos-block-hint">
                  {posText("เลือกบิลที่ต้องการหยุดเวลาและเก็บเงิน · กลุ่มอื่นยังเล่นต่อได้") + " "}</div>
                {session.billingGroups
                  .filter((group) => group.status === 'OPEN')
                  .map((group) => (
                    <button key={group.id} type="button" className="pos-ret-btn pos-bg-secondary-action pos-bg-action"
                      disabled={busy === `group-close-${group.id}`}
                      onClick={() => void run(`group-close-${group.id}`, 'group.close', {
                        billingGroupId: group.id,
                      }).then((data) => {
                        if (!data) return;
                        setNotice(posText("หยุดเวลากลุ่ม {v0} แล้ว — กลุ่มอื่นยังเล่นต่อ", { v0: group.groupNo }));
                        onCheckout(group.id);
                      })}>
                      {busy === `group-close-${group.id}`
                        ? posText("กำลังปิดบิลกลุ่ม {v0}…", { v0: group.groupNo })
                        : posText("ปิดบิลกลุ่ม {v0} แล้วเก็บเงิน", { v0: group.groupNo })}
                    </button>
                  ))}
                <button type="button" className="pos-ret-btn pos-bg-secondary-action pos-bg-action"
                  disabled={busy === 'close'} onClick={() => {
                    const openCount = session.billingGroups.filter((group) => group.status === 'OPEN').length;
                    if (openCount > 1 && !window.confirm(
                      posText("ปิดเวลาตอนนี้จะได้ {v0} บิลแยกกัน หากต้องการใบเสร็จเดียวให้ยกเลิกแล้วกดรวมกลุ่มก่อน ยืนยันปิดเป็นบิลแยกหรือไม่?", { v0: openCount }),
                    )) return;
                    closeSessionAndContinue(session.id);
                  }}>
                  {posText("ปิดเวลาทุกกลุ่ม") + " "}</button>
              </div>
            )}
            <div className="pos-bg-actions-stack pos-bg-actions-stack--primary">
              {session.status === 'OPEN' && (
                <button type="button" className="pos-ret-btn pos-ret-btn--solid pos-bg-primary-action pos-bg-action" disabled={busy === 'close'}
                  aria-expanded={session.billingGroups.length > 1 ? showCloseChoices : undefined}
                  onClick={() => requestSessionClose(session)}>
                  {busy === 'close'
                    ? posText("กำลังปิด…")
                    : session.billingGroups.length > 1
                      ? posText("หยุดเวลาและเลือกบิล")
                      : posText("หยุดเวลาและตรวจบิล")}
                </button>
              )}
            </div>

            {/* บิลที่ปิดเวลาแล้วแต่ยังไม่ได้เก็บเงิน — หนึ่งปุ่มต่อหนึ่งบิล */}
            {session.billingGroups.some((group) => group.status === 'CLOSING') && (
              <div className="pos-bg-actions-stack" style={{ marginTop: 8 }}>
                {session.billingGroups.length > 1 && (
                  <div className="pos-block-hint">
                    {posText("โต๊ะนี้แยกเป็น") + " "}{session.billingGroups.length} {" " + posText("บิล — เก็บเงินทีละใบ ใบที่จ่ายแล้วจะหายไปเอง") + " "}</div>
                )}
                {session.billingGroups
                  .filter((group) => group.status === 'CLOSING')
                  .map((group) => (
                    <button key={group.id} type="button" className="pos-ret-btn pos-ret-btn--solid pos-bg-primary-action pos-bg-action"
                      onClick={() => { setNotice(posText("ส่งบิลไปแท็บขายแล้ว")); onCheckout(group.id); }}>
                      {session.billingGroups.length > 1
                        ? posText("ไปเก็บเงินกลุ่ม {v0} (฿{v1})", { v0: group.groupNo, v1: baht(group.amountDue + group.tabAmount) })
                        : posText("ไปเก็บเงินบิลนี้ (฿{v0})", { v0: baht(group.amountDue + group.tabAmount) })}
                    </button>
                  ))}
              </div>
            )}

            {session.billingGroups.some((group) => group.status === 'PAID') && (
              <div className="pos-block-hint" style={{ marginTop: 6 }}>
                {posText("จ่ายแล้ว") + " "}{session.billingGroups.filter((group) => group.status === 'PAID').length} {" " + posText("บิล") + " "}{session.billingGroups.some((group) => group.status === 'OPEN')
                  ? posText(" · ยังมีกลุ่มที่เล่นอยู่ โต๊ะจึงยังไม่ว่าง")
                  : ''}
              </div>
            )}

          </div>

          {session.status === 'OPEN' && (
            <div className="pos-bg-session-sticky pos-bg-quick-actions" aria-label={posText("คำสั่งด่วนของโต๊ะ")}>
              <button type="button" className="pos-ret-btn pos-bg-secondary-action"
                aria-expanded={showAddParticipant}
                onClick={() => {
                  setDetailTab('overview');
                  setDraftTimeMode(session.billingMode === 'FIXED_DURATION' ? 'SESSION_END' : 'ACTUAL');
                  setShowAddParticipant((current) => !current);
                }}>
                {posText("+ เพิ่มผู้เล่น") + " "}</button>
              <button type="button" className="pos-ret-btn pos-bg-secondary-action"
                disabled={session.billingMode !== 'FIXED_DURATION' || busy === 'timing'}
                title={session.billingMode === 'FIXED_DURATION' ? posText("เพิ่มเวลาที่ซื้อไว้อีก 30 นาที") : posText("โต๊ะเปิดยาวไม่จำเป็นต้องเพิ่มเวลา")}
                onClick={() => void run('timing', 'timing', {
                  sessionId: session.id,
                  billingMode: 'FIXED_DURATION',
                  expectedDurationMinutes: plannedMinutes(session) + 30,
                  alertBeforeMinutes: Number(planAlert) || 0,
                }, () => setNotice(posText("เพิ่มเวลาให้อีก 30 นาทีแล้ว")))}>
                {posText("+30 นาที") + " "}</button>
              <button type="button" className="pos-ret-btn pos-ret-btn--solid pos-bg-primary-action"
                disabled={busy === 'close'} onClick={() => requestSessionClose(session)}>
                {posText("หยุดเวลาและตรวจบิล") + " "}</button>
            </div>
          )}
        </div>
      )}
        </section>
      </div>
    </div>
  );
}

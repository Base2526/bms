'use client';
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
import { useLiveRefresh, usePageVisible } from '@/app/hooks/useLiveRefresh';
import { describeAgo, feedHealth } from '@/lib/pos/orderAlertSound';

type Props = {
  token: string;
  cashierUserId: string;
  pin: string;
  /**
   * ส่งบิลเวลาเล่นที่ปิดแล้วไปให้แท็บขายเก็บเงิน — เส้นเดียวกับที่ `/admin/board-game` ใช้
   *
   * ส่ง **id ของกลุ่มบิล** ไม่ใช่ของโต๊ะ (`9.89`): โต๊ะที่แยกกลุ่มมีบิลรออยู่หลายใบพร้อมกัน
   * การส่ง id ของโต๊ะไปจึงตอบไม่ได้ว่าแท็บขายต้องเก็บเงินใบไหน
   */
  onCheckout: (billingGroupId: string) => void;
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
  chargeSnapshot: Array<{ amount: number }>;
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
type Title = { id: string; title: string; copies: Copy[] };
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
  source: 'STAFF' | 'PUBLIC'; reviewedAt: string | null; rejectionReason: string | null;
  reminderStatus: string; reminderSentAt: string | null;
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
  hourlyRate: number; billingGroupNo: number; billingGroupId: string;
  billingGroupStatus: string; joinedAt: string | null; leftAt: string | null;
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
  startedAt: string | null; expectedEndAt: string | null; endedAt: string | null;
  alertBeforeMinutes: number; alertStatus: string; amountDue: number;
  tableId: string;
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
};

/**
 * ป้ายชนิดเอกสาร — ลิสต์เดียวกับ `BOARD_GAME_IDENTITY_KINDS` ของ service · ชนิดที่ server
 * ไม่รู้จักถูกแสดงเป็นรหัสดิบแทนการซ่อน เพราะบัตรที่ไม่มีป้ายคือบัตรที่หาไม่เจอในลิ้นชัก
 */
const IDENTITY_KIND_LABEL: Record<string, string> = {
  NATIONAL_ID: 'บัตรประชาชน',
  STUDENT_ID: 'บัตรนักเรียน/นักศึกษา',
  DRIVER_LICENSE: 'ใบขับขี่',
  PASSPORT: 'พาสปอร์ต',
  OTHER: 'อื่น ๆ',
};

function baht(value: number) {
  return (Math.round((Number(value) || 0) * 100) / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function elapsedLabel(startedAt: string | null | undefined, now: number) {
  if (!startedAt) return '-';
  const minutes = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} ชม. ${minutes % 60} น.` : `${minutes} นาที`;
}

function timeLabel(value: string | null | undefined) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '-';
  return parsed.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function localDateTimeInput(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function detailStatusLabel(session: SessionDetail, now: number) {
  if (session.status !== 'OPEN' || !session.expectedEndAt) return tableStateLabel(session);
  const remaining = Math.ceil((new Date(session.expectedEndAt).getTime() - now) / 60_000);
  if (!Number.isFinite(remaining)) return tableStateLabel(session);
  if (remaining < 0) return `เกินเวลา · ${Math.abs(remaining)} นาที`;
  if (session.alertStatus === 'ENDING_SOON') return `ใกล้หมดเวลา · เหลือ ${remaining} นาที`;
  return `กำลังเล่น · เหลือ ${remaining} นาที`;
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

function alertLabel(status: string | null | undefined) {
  if (status === 'OVERDUE') return 'เกินเวลา';
  if (status === 'ENDING_SOON') return 'ใกล้หมดเวลา';
  return 'กำลังเล่น';
}

function serviceCallLabel(code: string) {
  return ({
    GAME_HELP: 'ช่วยสอนเกม',
    GAME_ISSUE: 'ชิ้นส่วนขาด / เกมชำรุด',
    FOOD_DRINK: 'อาหารหรือเครื่องดื่ม',
    BILL: 'ขอคิดเงิน',
    EXTEND_TIME: 'ขอต่อเวลา',
    CLEANUP: 'น้ำหก / ทำความสะอาด',
    OTHER: 'อื่น ๆ',
  } as Record<string, string>)[code] ?? code;
}

/**
 * โต๊ะที่ปิดเวลาแล้วยังไม่ได้เก็บเงินคือโต๊ะที่ยังว่างไม่ได้ แต่ก็ไม่ได้เล่นอยู่ — ป้าย
 * "กำลังเล่น" บนโต๊ะที่ครัวเรียกเก็บเงินไปแล้วคือสิ่งที่ทำให้พนักงานเดินไปถามลูกค้าผิดเรื่อง
 */
function tableStateLabel(session: { status: string; alertStatus: string } | null) {
  if (!session) return 'ว่าง';
  if (session.status === 'CLOSING') return 'รอเก็บเงิน';
  // โต๊ะที่จบไปแล้วยังค้างบนจอได้ — อีกเครื่องเก็บเงิน/ยกเลิกระหว่างที่การ์ดเปิดอยู่ ·
  // ถ้าปล่อยตกไป alertLabel() มันจะอ่านว่า "กำลังเล่น" ซึ่งเป็นคำตอบที่ผิดที่สุดที่จะให้
  if (session.status === 'PAID') return 'เก็บเงินแล้ว';
  if (session.status === 'CANCELLED') return 'ยกเลิกแล้ว';
  return alertLabel(session.alertStatus);
}

/** โต๊ะที่จบแล้ว — ไม่มีอะไรให้สั่งต่อ มีแต่ให้ปิดการ์ดทิ้ง */
function isTerminalSession(status: string) {
  return status === 'PAID' || status === 'CANCELLED';
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
    } else {
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

export default function BoardGamePanel({ token, cashierUserId, pin, onCheckout }: Props) {
  const ready = Boolean(token && cashierUserId && pin);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [selectedId, setSelectedId] = useState('');
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
  const [detailTab, setDetailTab] = useState<'overview' | 'tab' | 'games'>('overview');
  const [showCloseChoices, setShowCloseChoices] = useState(false);
  const [guestLink, setGuestLink] = useState('');
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
  const [reservationSearch, setReservationSearch] = useState('');
  const [reservationDate, setReservationDate] = useState('');
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
  const [memberQuery, setMemberQuery] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  // ฟอร์มในหน้า session
  const [planMinutes, setPlanMinutes] = useState('');
  const [planAlert, setPlanAlert] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [copyId, setCopyId] = useState('');
  const [returnNote, setReturnNote] = useState('');
  // สั่งของเข้าบิลระหว่างเล่น (`9.90`) — ต่อกลุ่ม เพราะแต่ละกลุ่มจ่ายคนละใบ
  const [tabGroupId, setTabGroupId] = useState('');
  const [tabSku, setTabSku] = useState('');
  const [tabQty, setTabQty] = useState('1');
  const [seatingTargetId, setSeatingTargetId] = useState('');
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
    selectedIdRef.current = sessionId;
    setSelectedId(sessionId);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const call = useCallback(async (
    action: string,
    payload: Record<string, unknown> = {},
    signal?: AbortSignal,
  ) => {
    const response = await fetch('/api/pos/board-game', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pos-device-token': token },
      body: JSON.stringify({ action, cashierUserId, pin, ...payload }),
      cache: 'no-store',
      signal,
    });
    const data = await response.json().catch(() => ({} as Record<string, unknown>));
    if (!response.ok) {
      const message = typeof data?.error === 'string' && data.error ? data.error : 'ทำรายการไม่สำเร็จ';
      // 4xx = server ตัดสินแล้ว · 5xx/เน็ตหลุด = ไม่รู้ผล ต้องถือคีย์เดิมไว้ยิงซ้ำ
      throw Object.assign(new Error(message), { decided: response.status < 500 });
    }
    return data as Record<string, any>;
  }, [cashierUserId, pin, token]);

  const loadWorkspace = useCallback(async (signal?: AbortSignal) => {
    const data = await call('workspace', {}, signal);
    setWorkspace(data as unknown as Workspace);
  }, [call]);

  const loadSession = useCallback(async (sessionId: string, signal?: AbortSignal) => {
    if (!sessionId) { setSession(null); return; }
    const data = await call('session', { sessionId }, signal);
    setSession((data.session ?? null) as SessionDetail | null);
  }, [call]);

  const feed = useLiveRefresh({
    enabled: ready,
    intervalMs: pageVisible ? 10_000 : 60_000,
    onRefresh: async (signal) => {
      await loadWorkspace(signal);
      const open = selectedIdRef.current;
      if (open) await loadSession(open, signal);
    },
  });

  useEffect(() => {
    if (!ready) return;
    void loadWorkspace().catch((e) => setError(e instanceof Error ? e.message : 'โหลดผังโต๊ะไม่สำเร็จ'));
  }, [ready, loadWorkspace]);

  useEffect(() => {
    if (!ready || !selectedId) return;
    void loadSession(selectedId).catch((e) => setError(e instanceof Error ? e.message : 'โหลดโต๊ะไม่สำเร็จ'));
  }, [ready, selectedId, loadSession]);

  useEffect(() => {
    setDetailTab('overview');
    setShowCloseChoices(false);
  }, [selectedId, openingTable?.id]);

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
    if (!ready || q.length < 3) { setMembers([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/pos/member?q=${encodeURIComponent(q)}`, {
        headers: { 'x-pos-device-token': token },
        cache: 'no-store',
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((d) => setMembers(Array.isArray(d?.members) ? d.members : []))
        .catch(() => { /* ค้นไม่เจอไม่ใช่ความล้มของทั้งจอ */ });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [memberQuery, ready, token]);

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
    () => (workspace?.floor.tables ?? []).filter(
      (table) => table.openSession && table.openSession.alertStatus !== 'NORMAL',
    ),
    [workspace],
  );

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
      setError(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ');
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
    if (!sku) { setError('ยิงบาร์โค้ดหรือพิมพ์รหัสสินค้าก่อน'); return; }
    const qty = Number(tabQty);
    if (!Number.isFinite(qty) || qty < 1) { setError('ใส่จำนวนอย่างน้อย 1'); return; }
    void run('tab-add', 'tab.add', {
      billingGroupId,
      sku,
      packQty: Math.round(qty),
    }, () => { setTabSku(''); setTabQty('1'); setNotice('เพิ่มเข้าบิลแล้ว'); });
  }

  function resetOpenForm() {
    setOpeningTable(null);
    setSeatingQueueId('');
    setDrafts([]); setNote(''); setDraftName(''); setDraftGroup('1');
    setMemberQuery(''); setMembers([]); setSelectedMember(null);
    setBillingMode('OPEN_ENDED'); setDuration('120'); setAlertBefore('15');
  }

  function addDraft() {
    const rateId = draftRateId || rates[0]?.id || '';
    if (!rateId) { setError('ร้านยังไม่ได้ตั้งอัตราค่าเวลาเล่น — ตั้งที่หลังบ้านก่อน'); return; }
    const name = selectedMember?.name?.trim() || draftName.trim();
    if (!name) { setError('ใส่ชื่อผู้เล่น หรือเลือกสมาชิกก่อน'); return; }
    const rate = rates.find((item) => item.id === rateId);
    setDrafts((rows) => [...rows, {
      key: newKey(),
      customerId: selectedMember?.customerId ?? null,
      memberNo: selectedMember?.memberNo ?? null,
      displayName: name,
      rateId,
      billingGroupNo: Math.max(1, Number(draftGroup) || 1),
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
        setNotice('ปิดเวลาแล้ว — ไปเก็บเงินที่แท็บขาย');
        onCheckout(billed[0].id);
        return;
      }
      setShowCloseChoices(false);
      setNotice(`ปิดเวลาแล้ว · โต๊ะนี้แยกเป็น ${billed.length} บิล — เลือกเก็บทีละใบ`);
    });
  }

  if (!ready) {
    return (
      <div className="pos-card" style={{ padding: 16 }}>
        <div className="pos-block-title">โต๊ะ / เวลาเล่น</div>
        <div className="pos-block-hint">เลือกผู้ปฏิบัติงานและใส่ PIN ที่แถบด้านบนก่อน จึงจะเปิดโต๊ะได้</div>
      </div>
    );
  }

  const pollMs = pageVisible ? 10_000 : 60_000;
  const health = feedHealth(feed.lastOkAt, now, pollMs);
  const ago = describeAgo(feed.lastOkAt, now);
  const agoText = ago
    ? ago.unit === 'seconds' ? `${ago.value} วินาทีที่แล้ว` : `${ago.value} นาทีที่แล้ว`
    : 'ยังไม่เคยโหลดสำเร็จ';
  const feedText = health === 'LIVE'
    ? `อัปเดตล่าสุด ${agoText}`
    : health === 'SLOW'
      ? `ข้อมูลช้ากว่าปกติ · ${agoText}`
      : 'ยังไม่ได้ข้อมูลใหม่ — ตัวเลขบนจอนี้อาจไม่ตรงกับหน้าร้าน';

  const openForm = openingTable && !openingTable.openSession;
  const activeTable = session
    ? (workspace?.floor.tables ?? []).find((table) => table.id === session.tableId) ?? null
    : null;
  const activeSeating = activeTable?.openSession ?? null;
  const seatingTargets = (workspace?.floor.tables ?? []).filter(
    (table) => !table.blocked && table.id !== session?.tableId,
  );
  // `9.91`: โต๊ะที่ถูกรวมไว้ ย้ายไปโต๊ะว่างจะแยกเฉพาะชุดที่เลือก ส่วนรวมโต๊ะพาไปทั้งโต๊ะ —
  // ปุ่มเดียวทำสองความหมาย จอจึงต้องบอกก่อนกด ไม่ใช่ให้รู้ตอนอีกชุดหายไปจากโต๊ะ
  const sharedSeating = (activeSeating?.sessionCount ?? 1) > 1;
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
  const openQueue = (workspace?.waitlist.entries ?? []).filter(
    (entry) => entry.status === 'WAITING' || entry.status === 'CALLED',
  );
  const allReservations = (workspace?.waitlist.entries ?? []).filter(
    (entry) => entry.kind === 'RESERVATION'
      && (entry.status === 'REQUESTED' || entry.status === 'CONFIRMED'),
  );
  const reservationNeedle = reservationSearch.trim().toLocaleLowerCase('th-TH');
  const reservations = allReservations.filter((entry) => {
    const matchesDate = !reservationDate || entry.serviceDate === reservationDate;
    const haystack = `${entry.guestName ?? ''} ${entry.guestPhone ?? ''} ${entry.guestEmail ?? ''} ${entry.reservedTableCode ?? ''}`
      .toLocaleLowerCase('th-TH');
    return matchesDate && (!reservationNeedle || haystack.includes(reservationNeedle));
  });

  const resetReservationForm = () => {
    setReservationEditingId(''); setReservationPartySize('2'); setReservationGuestName('');
    setReservationGuestPhone(''); setReservationTime(''); setReservationDuration('120');
    setReservationTableId('');
  };

  return (
    <div className="pos-bg-workspace">
      {error && <div className="pos-card" style={{ padding: 10, borderColor: '#e8bdb8', color: 'var(--pos-danger)' }}>{error}</div>}
      {notice && <div className="pos-card" style={{ padding: 10, color: 'var(--pos-money)' }}>{notice}</div>}

      <div className={`pos-bg-master-detail${openForm || session ? ' pos-bg-master-detail--selected' : ''}`}>
        <section className="pos-card pos-bg-master-pane" aria-label="ผังโต๊ะ">
          <div className="pos-bg-floor-head">
            <div>
              <div className="pos-block-title">ผังโต๊ะ</div>
              <div className="pos-block-hint">แตะโต๊ะเพื่อดูหรือเริ่มเวลาเล่น</div>
            </div>
            <div className="pos-bg-floor-refresh">
              {/* ⚠️ จอที่ค้างเงียบ ๆ อ่านไม่ต่างจากจอที่ข้อมูลถูกต้อง — ป้ายนี้อ่านจาก
                  เวลาที่โหลดสำเร็จครั้งล่าสุด ไม่ใช่จากนาฬิกาที่เดินต่อแม้เน็ตขาด */}
              <span className={`pos-bg-feed ${feedTone(health)}`.trim()}>{feedText}</span>
              <button type="button" className="pos-ret-btn" disabled={Boolean(busy)}
                onClick={() => void loadWorkspace().catch((e) => setError(e?.message ?? 'โหลดไม่สำเร็จ'))}>
                โหลดใหม่
              </button>
            </div>
          </div>

          <div className="pos-bg-floor-stats" aria-label="สรุปสถานะผังโต๊ะ">
            <span className="pos-bg-stat-pill">ว่าง {availableCount}</span>
            <span className="pos-bg-stat-pill">กำลังเล่น {playingCount}</span>
            <span className="pos-bg-stat-pill pos-bg-stat-pill--warn">ต้องดู {attention.length}</span>
            <span className="pos-bg-stat-pill pos-bg-stat-pill--warn">รอเก็บเงิน {awaitingPaymentCount}</span>
            <span className="pos-bg-stat-pill pos-bg-stat-pill--warn">
              คิว {workspace?.waitlist.waitingCount ?? 0} · {(workspace?.waitlist.waitingGuests ?? 0)} คน
            </span>
            <span className="pos-bg-stat-pill">
              จองล่วงหน้า {workspace?.waitlist.confirmedReservationCount ?? 0}
            </span>
            {(workspace?.waitlist.requestedReservationCount ?? 0) > 0 && <span className="pos-bg-stat-pill pos-bg-stat-pill--warn">
              คำขอออนไลน์ {workspace?.waitlist.requestedReservationCount ?? 0}
            </span>}
          </div>

          <details className="pos-bg-section pos-bg-section--advanced" open={allReservations.length > 0}>
            <summary>การจองล่วงหน้า · {allReservations.length} รายการ</summary>
            <div className="pos-bg-form" style={{ marginTop: 10 }}>
              <label className="pos-bg-field">
                ค้นหารายการ
                <input value={reservationSearch} placeholder="ชื่อ เบอร์โทร หรือโต๊ะ"
                  onChange={(e) => setReservationSearch(e.target.value)} />
              </label>
              <label className="pos-bg-field">
                วันที่แสดง
                <input type="date" value={reservationDate}
                  onChange={(e) => setReservationDate(e.target.value)} />
              </label>
              <label className="pos-bg-field">
                วันและเวลา
                <input type="datetime-local" value={reservationTime}
                  onChange={(e) => setReservationTime(e.target.value)} />
              </label>
              <label className="pos-bg-field pos-bg-field--num">
                ระยะเวลา (นาที)
                <input value={reservationDuration} inputMode="numeric"
                  onChange={(e) => setReservationDuration(e.target.value)} />
              </label>
              <label className="pos-bg-field pos-bg-field--num">
                จำนวนคน
                <input value={reservationPartySize} inputMode="numeric"
                  onChange={(e) => setReservationPartySize(e.target.value)} />
              </label>
              <label className="pos-bg-field">
                โต๊ะ
                <select value={reservationTableId} onChange={(e) => setReservationTableId(e.target.value)}>
                  <option value="">เลือกโต๊ะ</option>
                  {floorTables.filter((table) => !table.blocked).map((table) => (
                    <option key={table.id} value={table.id}>{table.code} · {table.name} ({table.seats} ที่)</option>
                  ))}
                </select>
              </label>
              <label className="pos-bg-field">
                ชื่อลูกค้า
                <input value={reservationGuestName} onChange={(e) => setReservationGuestName(e.target.value)} />
              </label>
              <label className="pos-bg-field">
                เบอร์โทร
                <input value={reservationGuestPhone} onChange={(e) => setReservationGuestPhone(e.target.value)} />
              </label>
              <button type="button" className="pos-ret-btn pos-ret-btn--open"
                disabled={busy === 'reservation-add' || busy === 'reservation-update'}
                onClick={() => {
                  const partySize = Number(reservationPartySize);
                  const durationMinutes = Number(reservationDuration);
                  const instant = new Date(reservationTime);
                  if (!reservationTableId || !reservationGuestName.trim() || !reservationGuestPhone.trim()
                    || !Number.isInteger(partySize) || partySize < 1
                    || !Number.isInteger(durationMinutes) || durationMinutes < 30
                    || !Number.isFinite(instant.getTime())) {
                    setError('ระบุเวลา โต๊ะ ชื่อ เบอร์โทร จำนวนคน และระยะเวลาอย่างน้อย 30 นาทีให้ครบ'); return;
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
                    setNotice(updating ? 'แก้ไขการจองแล้ว' : 'ยืนยันการจองแล้ว');
                  });
                }}>
                {reservationEditingId ? 'บันทึกการแก้ไข' : 'ยืนยันจอง'}
              </button>
              {reservationEditingId && (
                <button type="button" className="pos-ret-btn" onClick={resetReservationForm}>
                  เลิกแก้ไข
                </button>
              )}
            </div>
            {allReservations.length > 0 && reservations.length === 0 && (
              <div className="pos-block-hint">ไม่พบรายการที่ตรงกับตัวกรอง</div>
            )}
            {reservations.map((entry) => {
              const reviewTableId = reviewTableByEntry[entry.id] ?? '';
              const table = floorTables.find((item) => item.id === entry.reservedTableId) ?? null;
              const reservedAt = entry.reservedFor ? Date.parse(entry.reservedFor) : Number.NaN;
              const now = Date.now();
              const canArrive = Number.isFinite(reservedAt)
                && now >= reservedAt - 2 * 60 * 60_000 && now <= reservedAt + 6 * 60 * 60_000;
              const canMarkNoShow = Number.isFinite(reservedAt) && now >= reservedAt;
              return (
                <div key={entry.id} className="pos-bg-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                  <div className="pos-bg-row-main">
                    {entry.status === 'REQUESTED' ? 'คำขอออนไลน์ · ' : ''}
                    {entry.guestName || 'ไม่ระบุชื่อ'} · {entry.partySize} คน · โต๊ะ {entry.reservedTableCode || 'รอจัดโต๊ะ'}
                    <span style={{ color: 'var(--pos-muted)' }}>
                      {' · '}{entry.reservedFor ? new Date(entry.reservedFor).toLocaleString('th-TH') : '-'}
                      {' · '}{entry.reservedDurationMinutes ?? 0} นาที
                      {entry.guestEmail ? ` · ${entry.guestEmail}` : ''}
                    </span>
                  </div>
                  <div className="pos-bg-row-actions">
                    {entry.status === 'REQUESTED' && <>
                      <select aria-label="โต๊ะสำหรับยืนยันคำขอ" value={reviewTableId}
                        onChange={(event) => setReviewTableByEntry(current => ({
                          ...current, [entry.id]: event.target.value,
                        }))}>
                        <option value="">เลือกโต๊ะ</option>
                        {floorTables.filter((item) => !item.blocked && item.seats >= entry.partySize).map((item) => (
                          <option key={item.id} value={item.id}>{item.code} · {item.name} ({item.seats} ที่)</option>
                        ))}
                      </select>
                      <button type="button" className="pos-ret-btn pos-ret-btn--open"
                        disabled={!reviewTableId || busy === `reservation-confirm-${entry.id}`}
                        onClick={() => void run(`reservation-confirm-${entry.id}`, 'reservation.review', {
                          entryId: entry.id, decision: 'CONFIRM', tableId: reviewTableId,
                        }, () => {
                          setReviewTableByEntry(current => ({ ...current, [entry.id]: '' }));
                          setNotice('ยืนยันคำขอจองแล้ว');
                        })}>
                        ยืนยันคำขอ
                      </button>
                      <button type="button" className="pos-ret-btn pos-ret-btn--danger"
                        disabled={busy === `reservation-reject-${entry.id}`}
                        onClick={() => void run(`reservation-reject-${entry.id}`, 'reservation.review', {
                          entryId: entry.id, decision: 'REJECT', reason: 'ร้านไม่สามารถรับคำขอนี้ได้',
                        }, () => setNotice('ปฏิเสธคำขอแล้ว'))}>
                        ปฏิเสธ
                      </button>
                    </>}
                    {entry.status === 'CONFIRMED' && <>
                    <button type="button" className="pos-ret-btn" onClick={() => {
                      setReservationEditingId(entry.id);
                      setReservationPartySize(String(entry.partySize));
                      setReservationGuestName(entry.guestName ?? '');
                      setReservationGuestPhone(entry.guestPhone ?? '');
                      setReservationTime(localDateTimeInput(entry.reservedFor));
                      setReservationDuration(String(entry.reservedDurationMinutes ?? 120));
                      setReservationTableId(entry.reservedTableId ?? '');
                    }}>
                      แก้ไข/เลื่อน
                    </button>
                    <button type="button" className="pos-ret-btn"
                      disabled={!canArrive || busy === `reservation-checkin-${entry.id}`}
                      onClick={() => void run(`reservation-checkin-${entry.id}`, 'reservation.check_in',
                        { entryId: entry.id }, () => setNotice('เช็กอินและออกเลขคิวแล้ว'))}>
                      เช็กอิน
                    </button>
                    {canArrive && table && !table.openSession && !table.blocked && table.seats >= entry.partySize && (
                      <button type="button" className="pos-ret-btn pos-ret-btn--open" onClick={() => {
                        setSeatingQueueId(entry.id); setOpeningTable(table); selectTable(''); setSession(null);
                        setDrafts([]); setNotice(`เตรียมเปิด ${table.code} ให้รายการจอง — ระบุผู้เล่นจริงก่อนเริ่มเวลา`);
                      }}>
                        นั่งโต๊ะ
                      </button>
                    )}
                    <button type="button" className="pos-ret-btn pos-ret-btn--danger"
                      disabled={busy === `reservation-cancel-${entry.id}`}
                      onClick={() => void run(`reservation-cancel-${entry.id}`, 'waitlist.close', {
                        entryId: entry.id, status: 'CANCELLED',
                      }, () => setNotice('ยกเลิกการจองแล้ว'))}>
                      ยกเลิก
                    </button>
                    {canMarkNoShow && (
                      <button type="button" className="pos-ret-btn pos-ret-btn--danger"
                        disabled={busy === `reservation-noshow-${entry.id}`}
                        onClick={() => void run(`reservation-noshow-${entry.id}`, 'waitlist.close', {
                          entryId: entry.id, status: 'NO_SHOW',
                        }, () => setNotice('บันทึกว่าลูกค้าไม่มาแล้ว'))}>
                        ไม่มา
                      </button>
                    )}
                    </>}
                  </div>
                </div>
              );
            })}
          </details>

          <details className="pos-bg-section pos-bg-section--advanced" open={openQueue.length > 0}>
            <summary>
              คิวรอโต๊ะ {openQueue.length > 0
                ? `· ${openQueue.length} กลุ่ม · รอนานสุด ${workspace?.waitlist.longestWaitMinutes ?? 0} นาที`
                : '· ยังไม่มีคนรอ'}
            </summary>
            <div className="pos-bg-form" style={{ marginTop: 10 }}>
              <label className="pos-bg-field pos-bg-field--num">
                จำนวนคน
                <input value={queuePartySize} inputMode="numeric"
                  onChange={(e) => setQueuePartySize(e.target.value)} />
              </label>
              <label className="pos-bg-field">
                ชื่อเรียก
                <input value={queueGuestName} onChange={(e) => setQueueGuestName(e.target.value)} />
              </label>
              <label className="pos-bg-field">
                เบอร์โทร (ไม่บังคับ)
                <input value={queueGuestPhone} onChange={(e) => setQueueGuestPhone(e.target.value)} />
              </label>
              <button type="button" className="pos-ret-btn pos-ret-btn--open"
                disabled={busy === 'waitlist-add'}
                onClick={() => {
                  const partySize = Number(queuePartySize);
                  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 500) {
                    setError('จำนวนคนต้องอยู่ระหว่าง 1–500'); return;
                  }
                  void run('waitlist-add', 'waitlist.add', {
                    partySize, guestName: queueGuestName, guestPhone: queueGuestPhone,
                  }, () => {
                    setQueuePartySize('2'); setQueueGuestName(''); setQueueGuestPhone('');
                    setNotice('เพิ่มคิวแล้ว');
                  });
                }}>
                รับคิว
              </button>
            </div>

            {openQueue.map((entry) => {
              const fitting = floorTables.filter((table) =>
                !table.blocked && !table.openSession && table.seats >= entry.partySize,
              );
              return (
                <div key={entry.id} className="pos-bg-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                  <div className="pos-bg-row-main">
                    คิว {entry.queueNo} · {entry.guestName || 'ไม่ระบุชื่อ'} · {entry.partySize} คน
                    <span style={{ color: 'var(--pos-muted)' }}>
                      {' · รอ '}{elapsedLabel(entry.createdAt, now)}
                      {entry.status === 'CALLED' ? ' · เรียกแล้ว' : ''}
                    </span>
                    <div className="pos-chips" style={{ marginTop: 6 }}>
                      {fitting.slice(0, 4).map((table) => (
                        <button key={table.id} type="button" className="pos-chip"
                          style={{ border: 'none', cursor: 'pointer' }}
                          onClick={() => {
                            setSeatingQueueId(entry.id); setOpeningTable(table); selectTable(''); setSession(null);
                            setDrafts([]); setNotice(`เลือกโต๊ะ ${table.code} ให้คิว ${entry.queueNo} — ตรวจจำนวนจริงแล้วระบุผู้เล่น`);
                          }}>
                          นั่ง {table.code} ({table.seats})
                        </button>
                      ))}
                      {fitting.length === 0 && <span className="pos-block-hint">ยังไม่มีโต๊ะที่รองรับ</span>}
                    </div>
                  </div>
                  <div className="pos-bg-row-actions">
                    {entry.status === 'WAITING' && (
                      <button type="button" className="pos-ret-btn"
                        disabled={busy === `waitlist-call-${entry.id}`}
                        onClick={() => void run(`waitlist-call-${entry.id}`, 'waitlist.call', { entryId: entry.id },
                          () => setNotice(`เรียกคิว ${entry.queueNo} แล้ว`))}>
                        เรียก
                      </button>
                    )}
                    <button type="button" className="pos-ret-btn pos-ret-btn--danger"
                      disabled={busy === `waitlist-cancel-${entry.id}`}
                      onClick={() => void run(`waitlist-cancel-${entry.id}`, 'waitlist.close', {
                        entryId: entry.id, status: entry.status === 'CALLED' ? 'NO_SHOW' : 'CANCELLED',
                      }, () => setNotice(entry.status === 'CALLED' ? 'บันทึกไม่มาตามเรียกแล้ว' : 'ยกเลิกคิวแล้ว'))}>
                      {entry.status === 'CALLED' ? 'ไม่มา' : 'ยกเลิก'}
                    </button>
                  </div>
                </div>
              );
            })}
          </details>
      {/* ---------------- ผังโต๊ะ ---------------- */}
      {(workspace?.floor.areas ?? []).map((area) => (
        <div key={area.id} className="pos-bg-area">
          <div className="pos-bg-area-head">
            <div className="pos-bg-zone-title">
              {area.name} · ว่าง {(tablesByArea.get(area.id) ?? []).filter((table) => !table.openSession && !table.blocked).length}
            </div>
          </div>
          <div className="pos-bg-floor">
            {(tablesByArea.get(area.id) ?? []).map((table) => {
              const open = table.openSession;
              const selected = open
                ? (open.sessionIds ?? [open.id]).includes(selectedId)
                : openingTable?.id === table.id;
              const tableTone = open?.status === 'CLOSING' || (open?.awaitingPaymentCount ?? 0) > 0
                ? 'pos-bg-table--paying'
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
                  <div className="pos-bg-table-code">{table.code} · {table.name}</div>
                  {open ? (
                    <div className="pos-bg-table-body">
                      <div className="pos-bg-table-state">{tableStateLabel(open)} · {elapsedLabel(open.startedAt, now)}</div>
                      {/* ⚠️ ยอดขึ้นเฉพาะตอนมีบิลที่ปิดเวลาแล้วรอเก็บจริง — `amountDue` ของโต๊ะที่
                          ยังเล่นอยู่คือค่าเล่นที่ "ยังไม่ถูกแช่" ซึ่งเป็น 0 เสมอ ไม่ใช่ 0 เพราะไม่ติดเงิน */}
                      {open.awaitingPaymentCount > 0
                        ? <div className="pos-bg-table-money">฿{baht(open.amountDue)}</div>
                        : null}
                      <div className="pos-bg-table-sub">
                        {open.guestCount} คน · {open.billingGroupCount > 1 ? `แยก ${open.billingGroupCount} บิล` : 'บิลเดียว'}
                        {open.awaitingPaymentCount > 0 ? ` · รอเก็บ ${open.awaitingPaymentCount}` : ''}
                      </div>
                      {(open.sessionCount ?? 1) > 1 && (
                        <div className="pos-bg-table-sub">
                          รวมจาก {open.sessionCount} โต๊ะ · บิลยังแยกเดิม
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="pos-bg-table-body">
                      <div className="pos-bg-table-state">{table.blocked ? 'ปิดใช้งาน' : 'ว่าง'}</div>
                      <div className="pos-bg-table-sub">{table.seats} ที่นั่ง</div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
        </section>

        <section className="pos-card pos-bg-detail-pane" aria-label="รายละเอียดโต๊ะ">
      {!openForm && !session && (
        <div className="pos-bg-detail-empty">
          <div className="pos-bg-detail-empty-icon" aria-hidden="true">↖</div>
          <div className="pos-block-title">เลือกโต๊ะจากผัง</div>
          <div className="pos-block-hint">โต๊ะว่างจะเปิดฟอร์มเริ่มเวลา · โต๊ะที่มีลูกค้าจะแสดงงานของโต๊ะนี้ตรงนี้</div>
        </div>
      )}

      {/* ---------------- เปิดโต๊ะ ---------------- */}
      {openForm && (
        <div className="pos-bg-open-card">
          <div className="pos-shift-head">
            <div className="pos-block-title">
              {seatingQueueId ? 'พาคิวไปนั่ง' : 'เปิดโต๊ะ'} {openingTable.code} · {openingTable.name}
            </div>
            <button type="button" className="pos-ret-btn" onClick={resetOpenForm}>ปิด</button>
          </div>

          <div className="pos-chips" style={{ marginTop: 8 }}>
            {(['OPEN_ENDED', 'FIXED_DURATION'] as const).map((mode) => (
              <button key={mode} type="button"
                className={`pos-ret-btn ${billingMode === mode ? 'pos-ret-btn--primary' : ''}`}
                onClick={() => setBillingMode(mode)}>
                {mode === 'OPEN_ENDED' ? 'เปิดยาว (คิดตามจริง)' : 'ซื้อเวลาไว้ล่วงหน้า'}
              </button>
            ))}
          </div>

          <div className="pos-bg-form">
            {billingMode === 'FIXED_DURATION' && (
              <label className="pos-bg-field pos-bg-field--num">
                เวลาที่ซื้อ (นาที)
                <input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" />
              </label>
            )}
            <label className="pos-bg-field pos-bg-field--num">
              เตือนก่อนหมดเวลา (นาที)
              <input value={alertBefore} onChange={(e) => setAlertBefore(e.target.value)} inputMode="numeric" />
            </label>
            <label className="pos-bg-field">
              โน้ต
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>

          <div className="pos-block" style={{ marginTop: 12 }}>
            <div className="pos-block-title">ผู้เล่น</div>
            <div className="pos-bg-form" style={{ marginTop: 0 }}>
              <label className="pos-bg-field">
                ชื่อผู้เล่น
                <input value={selectedMember?.name ?? draftName} disabled={Boolean(selectedMember)}
                  onChange={(e) => setDraftName(e.target.value)} />
              </label>
              <label className="pos-bg-field">
                ค้นสมาชิก (ไม่บังคับ)
                <input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder="เบอร์โทร / ชื่อ" />
              </label>
              <label className="pos-bg-field">
                อัตรา
                <select value={draftRateId} onChange={(e) => setDraftRateId(e.target.value)}>
                  <option value="">{rates[0] ? `${rates[0].name} (฿${baht(rates[0].pricePerHour)}/ชม.)` : 'ยังไม่มีอัตรา'}</option>
                  {rates.map((rate) => (
                    <option key={rate.id} value={rate.id}>{rate.name} · ฿{baht(rate.pricePerHour)}/ชม.</option>
                  ))}
                </select>
              </label>
              <label className="pos-bg-field pos-bg-field--num">
                กลุ่มบิล
                <input value={draftGroup} onChange={(e) => setDraftGroup(e.target.value)} inputMode="numeric" />
              </label>
              <button type="button" className="pos-ret-btn pos-ret-btn--open" onClick={addDraft}>เพิ่มผู้เล่น</button>
            </div>

            {members.length > 0 && (
              <div className="pos-chips" style={{ marginTop: 8 }}>
                {members.map((member) => (
                  <button key={member.customerId} type="button" className="pos-chip"
                    style={{ border: 'none', cursor: 'pointer' }}
                    onClick={() => { setSelectedMember(member); setMembers([]); }}>
                    {member.name ?? 'ไม่มีชื่อ'} {member.memberNo ? `· ${member.memberNo}` : ''}
                  </button>
                ))}
              </div>
            )}

            {drafts.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {drafts.map((draft) => {
                  const rate = rates.find((item) => item.id === draft.rateId);
                  return (
                    <div key={draft.key} className="pos-bg-row">
                      <div className="pos-bg-row-main">
                        {draft.displayName}
                        <span style={{ color: 'var(--pos-muted)' }}>
                          {' · '}{rate?.name ?? 'อัตราเริ่มต้น'}{' · กลุ่ม '}{draft.billingGroupNo}
                          {draft.memberNo ? ` · สมาชิก ${draft.memberNo}` : ''}
                        </span>
                      </div>
                      <button type="button" className="pos-ret-btn pos-ret-btn--danger"
                        onClick={() => setDrafts((rows) => rows.filter((row) => row.key !== draft.key))}>ลบ</button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pos-block-hint">
              ค่าเล่นคิดต่อคน — คนที่ไม่ถูกคิดเงิน (ผู้ชม/ผู้ปกครอง) ให้เลือกอัตราของประเภทนั้น
            </div>
          </div>

          <button type="button" className="pos-ret-btn pos-ret-btn--solid pos-bg-action" style={{ marginTop: 12 }}
            disabled={(busy === 'open' || busy === 'waitlist-seat') || drafts.length === 0}
            onClick={() => void run(seatingQueueId ? 'waitlist-seat' : 'open', seatingQueueId ? 'waitlist.seat' : 'open', {
              ...(seatingQueueId ? { entryId: seatingQueueId } : {}),
              tableId: openingTable.id,
              billingMode,
              expectedDurationMinutes: billingMode === 'FIXED_DURATION' ? Number(duration) || null : null,
              alertBeforeMinutes: Number(alertBefore) || 0,
              note,
              participants: drafts.map((draft) => ({
                rateId: draft.rateId || null,
                customerId: draft.customerId,
                displayName: draft.displayName,
                billingGroupNo: draft.billingGroupNo,
              })),
            }, (data) => {
              resetOpenForm();
              setNotice(seatingQueueId ? 'พาคิวไปนั่งและเปิดเวลาแล้ว' : 'เปิดโต๊ะแล้ว');
              // ไปยืนที่โต๊ะที่เพิ่งเปิดทันที — ขั้นถัดไปของคนหน้าเคาน์เตอร์คือยื่นกล่องเกม
              // และรับบัตร ซึ่งทั้งคู่ทำได้จากการ์ดของโต๊ะนั้นเท่านั้น
              const openedId = typeof data?.result?.id === 'string'
                ? data.result.id
                : typeof data?.result?.session?.id === 'string' ? data.result.session.id : '';
              if (openedId) selectTable(openedId);
            })}>
            {busy === 'open' || busy === 'waitlist-seat'
              ? 'กำลังเปิด…'
              : seatingQueueId ? `พาคิวไปนั่ง (${drafts.length} คน)` : `เปิดโต๊ะ (${drafts.length} คน)`}
          </button>
        </div>
      )}

      {/* โต๊ะที่จบไปแล้วระหว่างที่การ์ดเปิดอยู่ (อีกเครื่องเก็บเงิน/ยกเลิก) — การ์ดเต็มของโต๊ะที่
          จบแล้วมีแต่ปุ่มที่กดแล้วล้ม จึงเหลือแค่บอกว่าเกิดอะไรขึ้นและทางกลับไปที่ผัง */}
      {session && isTerminalSession(session.status) && (
        <div className="pos-bg-session-card">
          <div className="pos-block-title" style={{ marginBottom: 2 }}>
            {activeTable ? `${activeTable.code} · ${activeTable.name}` : 'โต๊ะนี้'} · {tableStateLabel(session)}
          </div>
          <div className="pos-block-hint">
            {session.status === 'PAID'
              ? 'บิลของโต๊ะนี้ถูกเก็บเงินครบแล้ว'
              : 'โต๊ะนี้ถูกยกเลิกแล้ว — ไม่มีการเก็บค่าเล่นของรอบนี้'}
          </div>
          <button type="button" className="pos-ret-btn pos-bg-action" style={{ marginTop: 10 }}
            onClick={() => { selectTable(''); setSession(null); setNotice(''); setError(''); }}>
            กลับไปที่ผังโต๊ะ
          </button>
        </div>
      )}

      {/* ---------------- โต๊ะที่เปิดอยู่ ---------------- */}
      {session && !isTerminalSession(session.status) && (
        <div className="pos-bg-session-card">
          <div className="pos-shift-head pos-bg-session-head">
            <div>
              <div className={`pos-bg-session-state pos-bg-session-state--${session.alertStatus.toLowerCase()}`}>
                {detailStatusLabel(session, now)}
              </div>
              <div className="pos-block-title pos-bg-session-title">
                {activeTable ? `${activeTable.code} · ${activeTable.name}` : 'โต๊ะที่เปิดอยู่'}
              </div>
              <div className="pos-block-hint">
                เริ่ม {timeLabel(session.startedAt)}
                {session.expectedEndAt ? ` · ครบเวลา ${timeLabel(session.expectedEndAt)}` : ` · เล่นมาแล้ว ${elapsedLabel(session.startedAt, now)}`}
                {activeTable ? ` · ${areaName.get(activeTable.areaId) ?? ''}` : ''}
              </div>
            </div>
            {/* ⚠️ ห้ามพิมพ์ `session.amountDue` ก้อนเดียวแล้วเรียกมันว่า "ยอดถึงตอนนี้" —
                ค่าเล่นของกลุ่มที่ยังเล่นอยู่ยังไม่ถูกแช่ จึงเป็น 0 · เลขที่ออกมาคือ
                "เงินที่ตั้งไว้แล้ว" ไม่ใช่ "เงินที่ลูกค้าติดอยู่ตอนนี้" และสองอย่างนี้
                ต่างกันเท่าค่าเล่นทั้งโต๊ะ */}
            <div className="pos-bg-head-money">
              <div style={{ fontSize: 12, color: 'var(--pos-muted)' }}>
                {money.settled > 0 ? 'ยอดที่ปิดแล้ว รอเก็บเงิน' : 'ของที่สั่งไว้บนบิล'}
              </div>
              <div className="pos-bg-money">
                ฿{baht(money.settled > 0 ? money.settled : money.openTab)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--pos-muted)' }}>
                {money.settled > 0 && money.openTab > 0
                  ? `ของที่สั่งของกลุ่มที่ยังเล่น ฿${baht(money.openTab)}`
                  : money.stillPlaying
                    ? 'ค่าเล่นของกลุ่มที่ยังเล่นอยู่จะคิดตอนปิดเวลา'
                    : 'ค่าเล่น + ของที่สั่ง'}
              </div>
            </div>
          </div>

          <div className="pos-bg-session-summary" aria-label="สรุปโต๊ะ">
            <div><b>{session.participants.filter((participant) => !participant.leftAt).length}</b><span>คน</span></div>
            <div><b>{session.billingGroups.length}</b><span>กลุ่มบิล</span></div>
            <div><b>{session.games.filter((loan) => !loan.returnedAt).length}</b><span>เกมยืม</span></div>
            <div><b>{session.identityHolds.filter((hold) => hold.status === 'HELD').length}</b><span>บัตรที่ถือ</span></div>
          </div>

          <div className="pos-bg-section">
            <div className="pos-shift-head">
              <div>
                <div className="pos-block-title">🔔 เรียกพนักงาน</div>
                <div className="pos-block-hint">ออกลิงก์ให้ลูกค้าสแกน และรับงานของโต๊ะนี้</div>
              </div>
              <button type="button" className="pos-ret-btn"
                disabled={busy === 'service-access'}
                onClick={() => void run('service-access', 'service.access', {
                  sessionId: session.id,
                }, (data) => {
                  const publicToken = data?.result?.token;
                  if (typeof publicToken !== 'string') return;
                  setGuestLink(new URL(`/bg/${publicToken}`, window.location.origin).toString());
                  setNotice('สร้างลิงก์เรียกพนักงานแล้ว');
                })}>
                {busy === 'service-access' ? 'กำลังสร้าง…' : 'สร้างลิงก์ลูกค้า'}
              </button>
            </div>
            {guestLink && (
              <div className="pos-bg-row" style={{ marginTop: 8 }}>
                <a href={guestLink} target="_blank" rel="noreferrer" className="pos-bg-row-main">
                  เปิดหน้าลูกค้า / ใช้สร้าง QR
                </a>
                <button type="button" className="pos-ret-btn"
                  onClick={() => void navigator.clipboard?.writeText(guestLink)}>
                  คัดลอกลิงก์
                </button>
              </div>
            )}
            {sessionCalls.map((item) => (
              <div key={item.id} className="pos-bg-row" style={{ marginTop: 8 }}>
                <div className="pos-bg-row-main">
                  {serviceCallLabel(item.requestCode)}{item.requestNote ? ` · ${item.requestNote}` : ''}
                </div>
                <button type="button" className="pos-ret-btn pos-ret-btn--open"
                  disabled={busy === `service-${item.id}`}
                  onClick={() => void run(
                    `service-${item.id}`,
                    item.status === 'PENDING' ? 'service.acknowledge' : 'service.complete',
                    { callId: item.id },
                    () => setNotice(item.status === 'PENDING' ? 'รับทราบคำเรียกแล้ว' : 'ปิดงานแล้ว'),
                  )}>
                  {item.status === 'PENDING' ? 'รับทราบ' : 'เสร็จสิ้น'}
                </button>
              </div>
            ))}
          </div>

          <div className="pos-bg-detail-tabs" role="tablist" aria-label="งานของโต๊ะนี้">
            {([
              ['overview', 'ภาพรวม'],
              ['tab', `ของในบิล${session.billingGroups.some((group) => group.tabItems.length > 0) ? ` (${session.billingGroups.reduce((sum, group) => sum + group.tabItems.length, 0)})` : ''}`],
              ['games', `เกมและบัตร${session.games.some((loan) => !loan.returnedAt) || session.identityHolds.some((hold) => hold.status === 'HELD') ? ' •' : ''}`],
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
              <span className="pos-block-hint">ชุดลูกค้าที่โต๊ะนี้:</span>
              {activeSeating!.sessionIds!.map((id, index) => (
                <button key={id} type="button"
                  className={`pos-chip ${id === session.id ? 'pos-chip--personal' : ''}`}
                  style={{ border: 'none', cursor: 'pointer' }}
                  onClick={() => selectTable(id)}>
                  ชุด {index + 1}{id === session.id ? ' · กำลังดู' : ''}
                </button>
              ))}
            </div>
          )}

          {detailTab === 'overview' && <>
          <details className="pos-bg-section pos-bg-section--advanced pos-bg-advanced-menu">
            <summary>งานเพิ่มเติม · ย้ายโต๊ะ / แก้เวลา / ยกเลิก</summary>
            <div className="pos-bg-advanced-group">
            <div className="pos-block-title">ย้าย / รวมโต๊ะ</div>
            <div className="pos-block-hint">
              {sharedSeating
                ? 'โต๊ะนี้มีหลายชุดนั่งร่วมกัน — ย้ายไปโต๊ะว่างจะแยกเฉพาะชุดที่กำลังดูอยู่ออกไป ส่วนรวมโต๊ะจะพาไปทั้งโต๊ะ'
                : 'ย้ายไปโต๊ะว่าง หรือรวมเข้ากับโต๊ะที่มีลูกค้าอยู่ได้ โดยเวลา บิล และของบน tab ของทุกกลุ่มยังแยกเหมือนเดิม'}
            </div>
            <div className="pos-bg-form">
              <label className="pos-bg-field">
                โต๊ะปลายทาง
                <select value={seatingTargetId} onChange={(e) => setSeatingTargetId(e.target.value)}
                  style={{ display: 'block', width: '100%' }}>
                  <option value="">เลือกโต๊ะ</option>
                  {seatingTargets.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.code} · {table.name} · {table.openSession ? 'มีลูกค้า — รวมโต๊ะ' : 'ว่าง — ย้ายโต๊ะ'}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="pos-ret-btn pos-ret-btn--open"
                disabled={!seatingTargetId || busy === 'seating-relocate'}
                onClick={() => {
                  const target = seatingTargets.find((table) => table.id === seatingTargetId);
                  if (!target) { setError('เลือกโต๊ะปลายทางก่อน'); return; }
                  const merging = Boolean(target.openSession);
                  void run('seating-relocate', merging ? 'seating.merge' : 'seating.move', {
                    sessionId: session.id,
                    targetTableId: target.id,
                  }, () => {
                    setSeatingTargetId('');
                    setNotice(merging
                      ? `รวมเข้ากับโต๊ะ ${target.code} แล้ว — เวลาและบิลทุกใบยังแยกเดิม`
                      : sharedSeating
                        ? `แยกชุดนี้ไปโต๊ะ ${target.code} แล้ว — ชุดอื่นยังอยู่โต๊ะเดิม`
                        : `ย้ายไปโต๊ะ ${target.code} แล้ว`);
                  });
                }}>
                {busy === 'seating-relocate'
                  ? 'กำลังย้าย…'
                  : sharedSeating ? 'ยืนยันแยกชุดนี้ / รวมโต๊ะ' : 'ยืนยันย้าย / รวมโต๊ะ'}
              </button>
            </div>
            </div>

            {session.status === 'OPEN' && (
              <div className="pos-bg-advanced-group">
                <div className="pos-block-title">แก้เวลา</div>
                <div className="pos-block-hint">
                  {session.billingMode === 'FIXED_DURATION'
                    ? `ซื้อไว้ ${plannedMinutes(session)} นาที`
                    : 'เปิดยาว — คิดตามเวลาที่เล่นจริง ยังไม่ได้ซื้อเวลาไว้ล่วงหน้า'}
                </div>
                <div className="pos-bg-form">
                  <label className="pos-bg-field pos-bg-field--num">
                    เวลาที่ซื้อ (นาที)
                    <input value={planMinutes} onChange={(e) => setPlanMinutes(e.target.value)} inputMode="numeric" />
                  </label>
                  <label className="pos-bg-field pos-bg-field--num">
                    เตือนก่อนหมดเวลา (นาที)
                    <input value={planAlert} onChange={(e) => setPlanAlert(e.target.value)} inputMode="numeric" />
                  </label>
                  <button type="button" className="pos-ret-btn pos-ret-btn--open" disabled={busy === 'timing'}
                    onClick={() => {
                      const minutes = Number(planMinutes);
                      if (!Number.isFinite(minutes) || minutes < 1) { setError('ใส่เวลาที่ซื้อเป็นนาทีก่อน'); return; }
                      void run('timing', 'timing', {
                        sessionId: session.id,
                        billingMode: 'FIXED_DURATION',
                        expectedDurationMinutes: Math.round(minutes),
                        alertBeforeMinutes: Number(planAlert) || 0,
                      }, () => setNotice('บันทึกเวลาที่ซื้อแล้ว'));
                    }}>
                    {busy === 'timing' ? 'กำลังบันทึก…' : 'บันทึกเวลาที่ซื้อ'}
                  </button>
                  {session.billingMode === 'FIXED_DURATION' && (
                    <button type="button" className="pos-ret-btn" disabled={busy === 'timing'}
                      onClick={() => void run('timing', 'timing', {
                        sessionId: session.id,
                        billingMode: 'OPEN_ENDED',
                        expectedDurationMinutes: null,
                        alertBeforeMinutes: Number(planAlert) || 0,
                      }, () => setNotice('เปลี่ยนเป็นเปิดยาวแล้ว'))}>
                      เปลี่ยนเป็นเปิดยาว
                    </button>
                  )}
                </div>
              </div>
            )}

            {session.status !== 'PAID' && (
              <div className="pos-bg-advanced-group pos-bg-advanced-group--danger">
                <div className="pos-block-title">ยกเลิกโต๊ะ</div>
                <div className="pos-block-hint">
                  ใช้เมื่อไม่เก็บเงินเวลารอบนี้ — ต้องระบุเหตุผลเพื่อเก็บหลักฐาน
                </div>
                <div className="pos-bg-form">
                  <label className="pos-bg-field">
                    เหตุผลที่ยกเลิกโต๊ะ
                    <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="เช่น ลูกค้าเปลี่ยนใจก่อนเริ่มเล่น" />
                  </label>
                  <button type="button" className="pos-ret-btn pos-ret-btn--danger"
                    disabled={!cancelReason.trim() || busy === 'cancel'}
                    onClick={() => void run('cancel', 'cancel', {
                      sessionId: session.id, reason: cancelReason.trim(),
                    }, () => { setCancelReason(''); selectTable(''); setSession(null); setNotice('ยกเลิกโต๊ะแล้ว'); })}>
                    ยืนยันยกเลิกโต๊ะ
                  </button>
                </div>
              </div>
            )}
          </details>

          {/* ผู้เล่น */}
          <div className="pos-block pos-bg-section pos-bg-section--players">
            <div className="pos-bg-section-head">
              <div className="pos-block-title">ผู้เล่น</div>
              <span>{session.participants.filter((p) => !p.leftAt).length} คนในโต๊ะ</span>
            </div>
            {session.participants.map((participant) => (
              <div key={participant.id} className="pos-bg-row">
                <div className={`pos-bg-row-main ${participant.leftAt ? 'pos-bg-row-main--past' : ''}`.trim()}>
                  {participant.displayName ?? 'ไม่ระบุชื่อ'}
                  <span style={{ color: 'var(--pos-muted)' }}>
                    {' · กลุ่ม '}{participant.billingGroupNo}
                    {participant.billingGroupStatus === 'PAID' ? ' (จ่ายแล้ว)'
                      : participant.billingGroupStatus === 'CLOSING' ? ' (รอเก็บเงิน)' : ''}
                    {participant.billable ? ` · ฿${baht(participant.hourlyRate)}/ชม.` : ' · ไม่คิดเงิน'}
                    {participant.leftAt ? ' · ออกแล้ว' : ''}
                  </span>
                </div>
                {!participant.leftAt && participant.billingGroupStatus === 'OPEN' && (
                  <button type="button" className="pos-ret-btn"
                    disabled={busy === `leave-${participant.id}`}
                    onClick={() => void run(`leave-${participant.id}`, 'participant.leave', {
                      sessionId: session.id, participantId: participant.id,
                    }, () => setNotice('บันทึกคนออกจากโต๊ะแล้ว'))}>
                    ออกจากโต๊ะ
                  </button>
                )}
              </div>
            ))}

            {session.status === 'OPEN' && (
              <div className="pos-bg-quick-actions">
              <details className="pos-bg-inline-disclosure">
                <summary>+ เพิ่มผู้เล่น</summary>
                <div className="pos-bg-form">
                <label className="pos-bg-field">
                  เพิ่มผู้เล่น
                  <input value={draftName} onChange={(e) => setDraftName(e.target.value)}
                    placeholder="ชื่อผู้เล่น" />
                </label>
                <label className="pos-bg-field">
                  อัตรา
                  <select value={draftRateId} onChange={(e) => setDraftRateId(e.target.value)}>
                    <option value="">อัตราเริ่มต้น</option>
                    {rates.map((rate) => (
                      <option key={rate.id} value={rate.id}>{rate.name} · ฿{baht(rate.pricePerHour)}/ชม.</option>
                    ))}
                  </select>
                </label>
                <label className="pos-bg-field pos-bg-field--num">
                  กลุ่มบิล
                  <input value={draftGroup} onChange={(e) => setDraftGroup(e.target.value)} inputMode="numeric" />
                </label>
                <button type="button" className="pos-ret-btn pos-ret-btn--open" disabled={busy === 'add-participant'}
                  onClick={() => {
                    if (!draftName.trim()) { setError('ใส่ชื่อผู้เล่นก่อน'); return; }
                    void run('add-participant', 'participant.add', {
                      sessionId: session.id,
                      displayName: draftName.trim(),
                      rateId: draftRateId || null,
                      billingGroupNo: Math.max(1, Number(draftGroup) || 1),
                    }, () => { setDraftName(''); setNotice('เพิ่มผู้เล่นแล้ว'); });
                  }}>
                  เพิ่ม
                </button>
                </div>
              </details>
              <button type="button" className="pos-ret-btn pos-bg-secondary-action"
                disabled={session.billingMode !== 'FIXED_DURATION' || busy === 'timing'}
                title={session.billingMode === 'FIXED_DURATION' ? 'เพิ่มเวลาที่ซื้อไว้อีก 30 นาที' : 'โต๊ะเปิดยาวไม่จำเป็นต้องเพิ่มเวลา'}
                onClick={() => void run('timing', 'timing', {
                  sessionId: session.id,
                  billingMode: 'FIXED_DURATION',
                  expectedDurationMinutes: plannedMinutes(session) + 30,
                  alertBeforeMinutes: Number(planAlert) || 0,
                }, () => setNotice('เพิ่มเวลาให้อีก 30 นาทีแล้ว'))}>
                +30 นาที
              </button>
              </div>
            )}
          </div>

          <div className="pos-block pos-bg-section pos-bg-section--preclose">
            <div className="pos-bg-section-head">
              <div className="pos-block-title">สถานะก่อนปิดบิล</div>
              <span>ตรวจเกมและบัตรค้ำ</span>
            </div>
            {session.games.filter((loan) => !loan.returnedAt).map((loan) => (
              <div key={`preview-game-${loan.id}`} className="pos-bg-row">
                <div className="pos-bg-row-main">{loan.title ?? 'เกม'} · {loan.copyCode ?? '-'}</div>
                <span className="pos-bg-row-state pos-bg-row-state--warn">ยังไม่คืน</span>
              </div>
            ))}
            {session.identityHolds.filter((hold) => hold.status === 'HELD').map((hold) => (
              <div key={`preview-hold-${hold.id}`} className="pos-bg-row">
                <div className="pos-bg-row-main">
                  {IDENTITY_KIND_LABEL[hold.documentKind] ?? hold.documentKind}
                  {hold.documentNumberTail ? ` · ลงท้าย ${hold.documentNumberTail}` : ''}
                </div>
                <span className="pos-bg-row-state pos-bg-row-state--warn">ร้านถือไว้</span>
              </div>
            ))}
            {!session.games.some((loan) => !loan.returnedAt)
              && !session.identityHolds.some((hold) => hold.status === 'HELD') && (
                <div className="pos-block-hint">พร้อมปิดบิล — ไม่มีเกมหรือบัตรค้ำค้างอยู่</div>
            )}
          </div>
          </>}

          {/* ของที่สั่งเข้าบิลระหว่างเล่น (`9.90`) — ต่อกลุ่ม เพราะแต่ละกลุ่มจ่ายคนละใบ */}
          {detailTab === 'tab' && (
          <div className="pos-block pos-bg-section pos-bg-section--tab">
            <div className="pos-block-title">ของที่สั่งเข้าบิล</div>
            <div className="pos-block-hint">
              ของออกจากตู้ตอนนี้ ระบบจึงจองสต็อกทันที — ยอดจะไปรวมกับค่าเล่นในบิลใบเดียวกันตอนเก็บเงิน
            </div>
            {session.billingGroups.map((group) => (
              <div key={group.id} style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {session.billingGroups.length > 1 ? `กลุ่ม ${group.groupNo}` : 'บิลของโต๊ะนี้'}
                  <span style={{ color: 'var(--pos-muted)', fontWeight: 400 }}>
                    {' · ของบนบิล ฿'}{baht(group.tabAmount)}
                    {group.status === 'CLOSING' ? ` · ค่าเล่นที่ปิดแล้ว ฿${baht(group.amountDue)}` : ''}
                  </span>
                </div>
                {group.tabItems.length === 0 && (
                  <div className="pos-block-hint">ยังไม่มีของบนบิลนี้</div>
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
                        }, () => setNotice('เอาออกจากบิลแล้ว'))}>
                        เอาออก
                      </button>
                    )}
                  </div>
                ))}
                {group.status === 'OPEN' && (
                  <div className="pos-bg-form">
                    <label className="pos-bg-field">
                      บาร์โค้ด / รหัสสินค้า
                      {/* ⚠️ แท็บนี้ปิดตัวจับบาร์โค้ดรวมของเครื่องขายไว้โดยตั้งใจ
                          (`resolveScanContext` คืน DISABLED) เครื่องสแกนจึงพิมพ์รหัสลงช่องนี้
                          ตรง ๆ แล้วจบด้วย Enter · ช่องนี้ไม่ได้อยู่ใน <form> การไม่รับ Enter
                          แปลว่ายิงบาร์โค้ดแล้ว "ไม่มีอะไรเกิดขึ้น" ทั้งที่ placeholder สัญญาไว้ */}
                      <input
                        value={tabGroupId === group.id ? tabSku : ''}
                        onChange={(e) => { setTabGroupId(group.id); setTabSku(e.target.value); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTabItem(group.id); } }}
                        placeholder="ยิงบาร์โค้ดหรือพิมพ์รหัส" />
                    </label>
                    <label className="pos-bg-field pos-bg-field--num">
                      จำนวน
                      <input value={tabGroupId === group.id ? tabQty : '1'} inputMode="numeric"
                        onChange={(e) => { setTabGroupId(group.id); setTabQty(e.target.value); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTabItem(group.id); } }} />
                    </label>
                    <button type="button" className="pos-ret-btn pos-ret-btn--open"
                      disabled={busy === 'tab-add' || tabGroupId !== group.id || !tabSku.trim()}
                      onClick={() => addTabItem(group.id)}>
                      เพิ่มเข้าบิล
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          )}

          {/* เกมที่ยืมอยู่ */}
          {detailTab === 'games' && <>
          <div className="pos-block pos-bg-section pos-bg-section--games">
            <div className="pos-block-title">เกมที่ยืม</div>
            {session.games.length === 0 && <div className="pos-block-hint">ยังไม่ได้ยืมกล่องเกม</div>}
            {session.games.map((loan) => (
              <div key={loan.id} className="pos-bg-row">
                <div className="pos-bg-row-main">
                  {loan.title ?? 'เกม'}
                  <span style={{ color: 'var(--pos-muted)' }}>{' · '}{loan.copyCode ?? '-'}{' · '}{loan.status}</span>
                </div>
                {!loan.returnedAt && (
                  <div className="pos-bg-row-actions">
                    <button type="button" className="pos-ret-btn" disabled={busy === `return-${loan.id}`}
                      onClick={() => void run(`return-${loan.id}`, 'copy.return', {
                        loanId: loan.id, status: 'RETURNED', copyStatus: 'AVAILABLE', returnNote,
                      }, () => { setReturnNote(''); setNotice('รับเกมคืนแล้ว'); })}>
                      รับคืน
                    </button>
                    <button type="button" className="pos-ret-btn pos-ret-btn--warn" disabled={busy === `issue-${loan.id}`}
                      onClick={() => void run(`issue-${loan.id}`, 'copy.return', {
                        loanId: loan.id, status: 'ISSUE', copyStatus: 'NEEDS_CHECK', returnNote,
                      }, () => { setReturnNote(''); setNotice('บันทึกว่าต้องตรวจกล่องนี้แล้ว'); })}>
                      คืนแบบมีปัญหา
                    </button>
                  </div>
                )}
              </div>
            ))}

            {session.status === 'OPEN' && (
              <div className="pos-bg-form">
                <label className="pos-bg-field">
                  ให้ยืมกล่องเกม
                  <select value={copyId} onChange={(e) => setCopyId(e.target.value)}>
                    <option value="">เลือกกล่องที่ว่าง</option>
                    {(workspace?.library ?? []).map((title) => (
                      title.copies
                        .filter((copy) => copy.status === 'AVAILABLE')
                        .map((copy) => (
                          <option key={copy.id} value={copy.id}>{title.title} · {copy.copyCode}</option>
                        ))
                    ))}
                  </select>
                </label>
                <label className="pos-bg-field">
                  โน้ตตอนคืน
                  <input value={returnNote} onChange={(e) => setReturnNote(e.target.value)} />
                </label>
                <button type="button" className="pos-ret-btn pos-ret-btn--open" disabled={!copyId || busy === 'checkout-copy'}
                  onClick={() => void run('checkout-copy', 'copy.checkout', {
                    sessionId: session.id, copyId,
                  }, () => { setCopyId(''); setNotice('ให้ยืมกล่องเกมแล้ว'); })}>
                  ให้ยืม
                </button>
              </div>
            )}
          </div>

          {/* บัตรที่รับไว้ค้ำกล่องเกม (`9.93`)
              อยู่ติดกับกล่องเกมเพราะเป็นการกระทำเดียวกันที่เคาน์เตอร์: ยื่นกล่อง รับบัตร ·
              **จอนี้ไม่มีทางอ่านเลขเต็ม** — จอเครื่องขายหันออกทางลูกค้าและแชร์กันทั้งกะ
              การอ่านเลขกลับออกมาอยู่ที่ /admin/board-game ซึ่งมีสิทธิ์ของตัวเอง */}
          <div className="pos-block pos-bg-section pos-bg-section--identity">
            <div className="pos-block-title">บัตรที่รับไว้</div>
            {session.identityHolds.filter((hold) => hold.status === 'HELD').length === 0 && (
              <div className="pos-block-hint">ไม่ได้ถือบัตรของโต๊ะนี้ไว้</div>
            )}
            {session.identityHolds.map((hold) => (
              <div key={hold.id} className="pos-bg-row">
                <div className="pos-bg-row-main">
                  {hold.status === 'RETURNED'
                    ? <span style={{ color: 'var(--pos-muted)' }}>คืนบัตรแล้ว · {IDENTITY_KIND_LABEL[hold.documentKind] ?? hold.documentKind}</span>
                    : <>
                        {hold.holderName ?? '-'}
                        <span style={{ color: 'var(--pos-muted)' }}>
                          {' · '}{IDENTITY_KIND_LABEL[hold.documentKind] ?? hold.documentKind}
                          {hold.documentNumberTail ? ` · ลงท้าย ${hold.documentNumberTail}` : ' · ไม่ได้บันทึกเลข'}
                        </span>
                      </>}
                </div>
                {hold.status === 'HELD' && (
                  <button type="button" className="pos-ret-btn" disabled={busy === `id-release-${hold.id}`}
                    onClick={() => void run(`id-release-${hold.id}`, 'identity.release', {
                      holdId: hold.id,
                    }, () => setNotice('คืนบัตรให้ลูกค้าแล้ว — ลบเลขที่เก็บไว้ทิ้งด้วย'))}>
                    คืนบัตร
                  </button>
                )}
              </div>
            ))}

            {session.status === 'OPEN' && (
              <div className="pos-bg-form">
                <label className="pos-bg-field">
                  ชนิดบัตร
                  <select value={idKind} onChange={(e) => setIdKind(e.target.value)}>
                    {Object.entries(IDENTITY_KIND_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="pos-bg-field">
                  ชื่อบนบัตร
                  <input value={idHolder} onChange={(e) => setIdHolder(e.target.value)} />
                </label>
                {/* เลขไม่บังคับ — ร้านที่เก็บบัตรจริงไว้โดยไม่พิมพ์เลขก็ยังได้ด่านตอนปิดบิล
                    การบังคับพิมพ์จะไล่ร้านกลับไปใช้กระดาษ ซึ่งแย่กว่าทุกทาง */}
                <label className="pos-bg-field">
                  เลขบัตร (ไม่บังคับ)
                  <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
                </label>
                <label className="pos-bg-field">
                  ค้ำกล่องเกม (ไม่บังคับ)
                  <select value={idLoanId} onChange={(e) => setIdLoanId(e.target.value)}>
                    <option value="">ไม่ระบุกล่อง</option>
                    {session.games.filter((loan) => !loan.returnedAt).map((loan) => (
                      <option key={loan.id} value={loan.id}>{loan.title ?? 'เกม'} · {loan.copyCode ?? '-'}</option>
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
                  }, () => { setIdHolder(''); setIdNumber(''); setIdLoanId(''); setNotice('รับบัตรไว้แล้ว'); })}>
                  รับบัตรไว้
                </button>
              </div>
            )}
          </div>
          </>}

          {/* ปิดโต๊ะ / เก็บเงิน */}
          <div className="pos-block pos-bg-section pos-bg-section--checkout">
            <div className="pos-block-title">หยุดเวลา / เก็บเงิน</div>
            {showCloseChoices && session.billingGroups.length > 1 && session.billingGroups.some((group) => group.status === 'OPEN') && (
              <div className="pos-bg-actions-stack pos-bg-close-choices">
                <div className="pos-block-hint">
                  เลือกบิลที่ต้องการหยุดเวลาและเก็บเงิน · กลุ่มอื่นยังเล่นต่อได้
                </div>
                {session.billingGroups
                  .filter((group) => group.status === 'OPEN')
                  .map((group) => (
                    <button key={group.id} type="button" className="pos-ret-btn pos-bg-secondary-action pos-bg-action"
                      disabled={busy === `group-close-${group.id}`}
                      onClick={() => void run(`group-close-${group.id}`, 'group.close', {
                        billingGroupId: group.id,
                      }).then((data) => {
                        if (!data) return;
                        setNotice(`หยุดเวลากลุ่ม ${group.groupNo} แล้ว — กลุ่มอื่นยังเล่นต่อ`);
                        onCheckout(group.id);
                      })}>
                      {busy === `group-close-${group.id}`
                        ? `กำลังปิดบิลกลุ่ม ${group.groupNo}…`
                        : `ปิดบิลกลุ่ม ${group.groupNo} แล้วเก็บเงิน`}
                    </button>
                  ))}
                <button type="button" className="pos-ret-btn pos-bg-secondary-action pos-bg-action"
                  disabled={busy === 'close'} onClick={() => closeSessionAndContinue(session.id)}>
                  ปิดเวลาทุกกลุ่ม
                </button>
              </div>
            )}
            <div className="pos-bg-actions-stack pos-bg-actions-stack--primary">
              {session.status === 'OPEN' && (
                <button type="button" className="pos-ret-btn pos-ret-btn--solid pos-bg-primary-action pos-bg-action" disabled={busy === 'close'}
                  aria-expanded={session.billingGroups.length > 1 ? showCloseChoices : undefined}
                  onClick={() => {
                    if (session.billingGroups.length > 1) {
                      setShowCloseChoices((current) => !current);
                      return;
                    }
                    closeSessionAndContinue(session.id);
                  }}>
                  {busy === 'close'
                    ? 'กำลังปิด…'
                    : session.billingGroups.length > 1
                      ? 'หยุดเวลา แล้วเลือกบิลเก็บเงิน'
                      : 'หยุดเวลา แล้วไปเก็บเงิน'}
                </button>
              )}
            </div>

            {/* บิลที่ปิดเวลาแล้วแต่ยังไม่ได้เก็บเงิน — หนึ่งปุ่มต่อหนึ่งบิล */}
            {session.billingGroups.some((group) => group.status === 'CLOSING') && (
              <div className="pos-bg-actions-stack" style={{ marginTop: 8 }}>
                {session.billingGroups.length > 1 && (
                  <div className="pos-block-hint">
                    โต๊ะนี้แยกเป็น {session.billingGroups.length} บิล — เก็บเงินทีละใบ ใบที่จ่ายแล้วจะหายไปเอง
                  </div>
                )}
                {session.billingGroups
                  .filter((group) => group.status === 'CLOSING')
                  .map((group) => (
                    <button key={group.id} type="button" className="pos-ret-btn pos-ret-btn--solid pos-bg-primary-action pos-bg-action"
                      onClick={() => { setNotice('ส่งบิลไปแท็บขายแล้ว'); onCheckout(group.id); }}>
                      {session.billingGroups.length > 1
                        ? `ไปเก็บเงินกลุ่ม ${group.groupNo} (฿${baht(group.amountDue + group.tabAmount)})`
                        : `ไปเก็บเงินบิลนี้ (฿${baht(group.amountDue + group.tabAmount)})`}
                    </button>
                  ))}
              </div>
            )}

            {session.billingGroups.some((group) => group.status === 'PAID') && (
              <div className="pos-block-hint" style={{ marginTop: 6 }}>
                จ่ายแล้ว {session.billingGroups.filter((group) => group.status === 'PAID').length} บิล
                {session.billingGroups.some((group) => group.status === 'OPEN')
                  ? ' · ยังมีกลุ่มที่เล่นอยู่ โต๊ะจึงยังไม่ว่าง'
                  : ''}
              </div>
            )}

          </div>
        </div>
      )}
        </section>
      </div>
    </div>
  );
}

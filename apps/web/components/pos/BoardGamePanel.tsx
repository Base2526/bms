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
type Workspace = { floor: { areas: Area[]; tables: Table[] }; rates: Rate[]; library: Title[] };

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

/**
 * โต๊ะที่ปิดเวลาแล้วยังไม่ได้เก็บเงินคือโต๊ะที่ยังว่างไม่ได้ แต่ก็ไม่ได้เล่นอยู่ — ป้าย
 * "กำลังเล่น" บนโต๊ะที่ครัวเรียกเก็บเงินไปแล้วคือสิ่งที่ทำให้พนักงานเดินไปถามลูกค้าผิดเรื่อง
 */
function tableStateLabel(session: { status: string; alertStatus: string } | null) {
  if (!session) return 'ว่าง';
  if (session.status === 'CLOSING') return 'รอเก็บเงิน';
  return alertLabel(session.alertStatus);
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
  const [openingTable, setOpeningTable] = useState<Table | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(() => Date.now());

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

  useLiveRefresh({
    enabled: ready,
    intervalMs: pageVisible ? 10_000 : 60_000,
    onRefresh: async (signal) => {
      await loadWorkspace(signal);
      if (selectedId) await loadSession(selectedId, signal);
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

  async function run(name: string, action: string, payload: Record<string, unknown>, after?: () => void) {
    if (busy) return;
    setBusy(name); setError(''); setNotice('');
    try {
      const data = await call(action, { idempotencyKey: keyFor(name), ...payload });
      dropKey(name);
      after?.();
      await loadWorkspace();
      if (selectedId) await loadSession(selectedId);
      return data;
    } catch (e: any) {
      if (e?.decided) dropKey(name);
      setError(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ');
      return null;
    } finally {
      setBusy('');
    }
  }

  function resetOpenForm() {
    setOpeningTable(null);
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

  if (!ready) {
    return (
      <div className="pos-card" style={{ padding: 16 }}>
        <div className="pos-block-title">โต๊ะ / เวลาเล่น</div>
        <div className="pos-block-hint">เลือกผู้ปฏิบัติงานและใส่ PIN ที่แถบด้านบนก่อน จึงจะเปิดโต๊ะได้</div>
      </div>
    );
  }

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="pos-shift-head">
        <div>
          <div className="pos-block-title" style={{ marginBottom: 2 }}>โต๊ะ / เวลาเล่น</div>
          <div className="pos-block-hint">
            ค่าเล่นคิดจากเวลาและคนในโต๊ะ ไม่ใช่สินค้า — ปิดโต๊ะแล้วยอดจะไปรวมกับขนม/เครื่องดื่มในบิลเดียวที่แท็บขาย
          </div>
        </div>
        <button type="button" className="pos-ret-btn" disabled={Boolean(busy)}
          onClick={() => void loadWorkspace().catch((e) => setError(e?.message ?? 'โหลดไม่สำเร็จ'))}>
          โหลดใหม่
        </button>
      </div>

      {error && <div className="pos-card" style={{ padding: 10, borderColor: '#e8bdb8', color: 'var(--pos-danger)' }}>{error}</div>}
      {notice && <div className="pos-card" style={{ padding: 10, color: 'var(--pos-money)' }}>{notice}</div>}

      {attention.length > 0 && (
        <div className="pos-card" style={{ padding: 10 }}>
          <div className="pos-block-title" style={{ marginBottom: 6 }}>โต๊ะที่ต้องดู</div>
          <div className="pos-chips">
            {attention.map((table) => (
              <button key={table.id} type="button"
                className={`pos-chip ${table.openSession?.alertStatus === 'OVERDUE' ? 'pos-chip--warn' : 'pos-chip--personal'}`}
                style={{ border: 'none', cursor: 'pointer' }}
                onClick={() => { setSelectedId(table.openSession!.id); setOpeningTable(null); }}>
                {table.code} · {tableStateLabel(table.openSession)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- ผังโต๊ะ ---------------- */}
      {(workspace?.floor.areas ?? []).map((area) => (
        <div key={area.id} className="pos-block">
          <div className="pos-block-title">{area.name}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(168px, 100%), 1fr))', gap: 8 }}>
            {(tablesByArea.get(area.id) ?? []).map((table) => {
              const open = table.openSession;
              const selected = open
                ? (open.sessionIds ?? [open.id]).includes(selectedId)
                : openingTable?.id === table.id;
              return (
                <button key={table.id} type="button" disabled={table.blocked}
                  onClick={() => {
                    setError(''); setNotice('');
                    if (open) { setSelectedId(open.id); setOpeningTable(null); }
                    else { setOpeningTable(table); setSelectedId(''); setSession(null); }
                  }}
                  style={{
                    textAlign: 'left', padding: 10, borderRadius: 10, minHeight: 92,
                    border: `2px solid ${selected ? 'var(--pos-accent)' : 'var(--pos-line)'}`,
                    background: open ? 'var(--pos-accent-bg)' : 'var(--pos-panel, #fff)',
                    opacity: table.blocked ? 0.5 : 1,
                    cursor: table.blocked ? 'not-allowed' : 'pointer',
                  }}>
                  <div style={{ fontWeight: 700 }}>{table.code}</div>
                  <div style={{ fontSize: 12, color: 'var(--pos-muted)' }}>{table.name} · {table.seats} ที่</div>
                  {open ? (
                    <div style={{ marginTop: 6, fontSize: 12 }}>
                      <div>{tableStateLabel(open)} · {elapsedLabel(open.startedAt, now)}</div>
                      <div style={{ fontWeight: 700 }}>฿{baht(open.amountDue)}</div>
                      {open.billingGroupCount > 1 && (
                        <div style={{ color: 'var(--pos-muted)' }}>
                          แยก {open.billingGroupCount} บิล
                          {open.awaitingPaymentCount > 0 ? ` · รอเก็บ ${open.awaitingPaymentCount}` : ''}
                        </div>
                      )}
                      {(open.sessionCount ?? 1) > 1 && (
                        <div style={{ color: 'var(--pos-muted)' }}>
                          รวมจาก {open.sessionCount} โต๊ะ · บิลยังแยกเดิม
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--pos-muted)' }}>
                      {table.blocked ? 'ปิดใช้งาน' : 'ว่าง'}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* ---------------- เปิดโต๊ะ ---------------- */}
      {openForm && (
        <div className="pos-card" style={{ padding: 14 }}>
          <div className="pos-shift-head">
            <div className="pos-block-title">เปิดโต๊ะ {openingTable.code} · {openingTable.name}</div>
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

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {billingMode === 'FIXED_DURATION' && (
              <label style={{ fontSize: 12 }}>
                เวลาที่ซื้อ (นาที)
                <input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric"
                  style={{ display: 'block', width: 120 }} />
              </label>
            )}
            <label style={{ fontSize: 12 }}>
              เตือนก่อนหมดเวลา (นาที)
              <input value={alertBefore} onChange={(e) => setAlertBefore(e.target.value)} inputMode="numeric"
                style={{ display: 'block', width: 120 }} />
            </label>
            <label style={{ fontSize: 12, flex: '1 1 220px' }}>
              โน้ต
              <input value={note} onChange={(e) => setNote(e.target.value)} style={{ display: 'block', width: '100%' }} />
            </label>
          </div>

          <div className="pos-block" style={{ marginTop: 12 }}>
            <div className="pos-block-title">ผู้เล่น</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ fontSize: 12, flex: '1 1 180px' }}>
                ชื่อผู้เล่น
                <input value={selectedMember?.name ?? draftName} disabled={Boolean(selectedMember)}
                  onChange={(e) => setDraftName(e.target.value)} style={{ display: 'block', width: '100%' }} />
              </label>
              <label style={{ fontSize: 12, flex: '1 1 180px' }}>
                ค้นสมาชิก (ไม่บังคับ)
                <input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder="เบอร์โทร / ชื่อ" style={{ display: 'block', width: '100%' }} />
              </label>
              <label style={{ fontSize: 12 }}>
                อัตรา
                <select value={draftRateId} onChange={(e) => setDraftRateId(e.target.value)}
                  style={{ display: 'block', minWidth: 170 }}>
                  <option value="">{rates[0] ? `${rates[0].name} (฿${baht(rates[0].pricePerHour)}/ชม.)` : 'ยังไม่มีอัตรา'}</option>
                  {rates.map((rate) => (
                    <option key={rate.id} value={rate.id}>{rate.name} · ฿{baht(rate.pricePerHour)}/ชม.</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                กลุ่มบิล
                <input value={draftGroup} onChange={(e) => setDraftGroup(e.target.value)} inputMode="numeric"
                  style={{ display: 'block', width: 90 }} />
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
                    <div key={draft.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <div style={{ fontSize: 13 }}>
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

          <button type="button" className="pos-ret-btn pos-ret-btn--solid" style={{ marginTop: 12 }}
            disabled={busy === 'open' || drafts.length === 0}
            onClick={() => void run('open', 'open', {
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
            }, () => { resetOpenForm(); setNotice('เปิดโต๊ะแล้ว'); })}>
            {busy === 'open' ? 'กำลังเปิด…' : `เปิดโต๊ะ (${drafts.length} คน)`}
          </button>
        </div>
      )}

      {/* ---------------- โต๊ะที่เปิดอยู่ ---------------- */}
      {session && (
        <div className="pos-card" style={{ padding: 14 }}>
          <div className="pos-shift-head">
            <div>
              <div className="pos-block-title" style={{ marginBottom: 2 }}>
                {activeTable ? `${activeTable.code} · ${activeTable.name}` : 'โต๊ะที่เปิดอยู่'}
                {activeTable ? ` · ${areaName.get(activeTable.areaId) ?? ''}` : ''}
              </div>
              <div className="pos-block-hint">
                {tableStateLabel(session)} · เล่นมาแล้ว {elapsedLabel(session.startedAt, now)}
                {session.expectedEndAt ? ` · ถึง ${new Date(session.expectedEndAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}` : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: 'var(--pos-muted)' }}>ยอดถึงตอนนี้</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>฿{baht(session.amountDue)}</div>
              <div style={{ fontSize: 11, color: 'var(--pos-muted)' }}>ค่าเล่น + ของที่สั่ง</div>
            </div>
          </div>

          {/* `9.91`: หลาย session แชร์ seating เดียวกันหลังรวมโต๊ะ แต่เวลาและบิลยังเป็นของเดิม */}
          {(activeSeating?.sessionIds?.length ?? 0) > 1 && (
            <div className="pos-chips" style={{ marginTop: 8 }}>
              <span className="pos-block-hint">ชุดลูกค้าที่โต๊ะนี้:</span>
              {activeSeating!.sessionIds!.map((id, index) => (
                <button key={id} type="button"
                  className={`pos-chip ${id === session.id ? 'pos-chip--personal' : ''}`}
                  style={{ border: 'none', cursor: 'pointer' }}
                  onClick={() => setSelectedId(id)}>
                  ชุด {index + 1}{id === session.id ? ' · กำลังดู' : ''}
                </button>
              ))}
            </div>
          )}

          <div className="pos-block" style={{ marginTop: 10 }}>
            <div className="pos-block-title">ย้าย / รวมโต๊ะ</div>
            <div className="pos-block-hint">
              {sharedSeating
                ? 'โต๊ะนี้มีหลายชุดนั่งร่วมกัน — ย้ายไปโต๊ะว่างจะแยกเฉพาะชุดที่กำลังดูอยู่ออกไป ส่วนรวมโต๊ะจะพาไปทั้งโต๊ะ'
                : 'ย้ายไปโต๊ะว่าง หรือรวมเข้ากับโต๊ะที่มีลูกค้าอยู่ได้ โดยเวลา บิล และของบน tab ของทุกกลุ่มยังแยกเหมือนเดิม'}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
              <label style={{ fontSize: 12, flex: '1 1 220px' }}>
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

          {/* ผู้เล่น */}
          <div className="pos-block" style={{ marginTop: 10 }}>
            <div className="pos-block-title">ผู้เล่น ({session.participants.filter((p) => !p.leftAt).length} คนในโต๊ะ)</div>
            {session.participants.map((participant) => (
              <div key={participant.id}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <div style={{ fontSize: 13, opacity: participant.leftAt ? 0.55 : 1 }}>
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
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
                <label style={{ fontSize: 12, flex: '1 1 160px' }}>
                  เพิ่มผู้เล่น
                  <input value={draftName} onChange={(e) => setDraftName(e.target.value)}
                    placeholder="ชื่อผู้เล่น" style={{ display: 'block', width: '100%' }} />
                </label>
                <label style={{ fontSize: 12 }}>
                  อัตรา
                  <select value={draftRateId} onChange={(e) => setDraftRateId(e.target.value)} style={{ display: 'block', minWidth: 160 }}>
                    <option value="">อัตราเริ่มต้น</option>
                    {rates.map((rate) => (
                      <option key={rate.id} value={rate.id}>{rate.name} · ฿{baht(rate.pricePerHour)}/ชม.</option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 12 }}>
                  กลุ่มบิล
                  <input value={draftGroup} onChange={(e) => setDraftGroup(e.target.value)} inputMode="numeric"
                    style={{ display: 'block', width: 90 }} />
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
            )}
          </div>

          {/* ของที่สั่งเข้าบิลระหว่างเล่น (`9.90`) — ต่อกลุ่ม เพราะแต่ละกลุ่มจ่ายคนละใบ */}
          <div className="pos-block" style={{ marginTop: 10 }}>
            <div className="pos-block-title">ของที่สั่งเข้าบิล</div>
            <div className="pos-block-hint">
              ของออกจากตู้ตอนนี้ ระบบจึงจองสต็อกทันที — ยอดจะไปรวมกับค่าเล่นในบิลใบเดียวกันตอนเก็บเงิน
            </div>
            {session.billingGroups.map((group) => (
              <div key={group.id} style={{ marginTop: 8 }}>
                {session.billingGroups.length > 1 && (
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    กลุ่ม {group.groupNo}
                    <span style={{ color: 'var(--pos-muted)', fontWeight: 400 }}>
                      {' · ของบนบิล ฿'}{baht(group.tabAmount)}
                    </span>
                  </div>
                )}
                {group.tabItems.length === 0 && (
                  <div className="pos-block-hint">ยังไม่มีของบนบิลนี้</div>
                )}
                {group.tabItems.map((item) => (
                  <div key={item.id}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                    <div style={{ fontSize: 13 }}>
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
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 6 }}>
                    <label style={{ fontSize: 12, flex: '1 1 200px' }}>
                      บาร์โค้ด / รหัสสินค้า
                      <input
                        value={tabGroupId === group.id ? tabSku : ''}
                        onChange={(e) => { setTabGroupId(group.id); setTabSku(e.target.value); }}
                        placeholder="ยิงบาร์โค้ดหรือพิมพ์รหัส"
                        style={{ display: 'block', width: '100%' }} />
                    </label>
                    <label style={{ fontSize: 12 }}>
                      จำนวน
                      <input value={tabGroupId === group.id ? tabQty : '1'} inputMode="numeric"
                        onChange={(e) => { setTabGroupId(group.id); setTabQty(e.target.value); }}
                        style={{ display: 'block', width: 90 }} />
                    </label>
                    <button type="button" className="pos-ret-btn pos-ret-btn--open"
                      disabled={busy === 'tab-add' || tabGroupId !== group.id || !tabSku.trim()}
                      onClick={() => {
                        const qty = Number(tabQty);
                        if (!Number.isFinite(qty) || qty < 1) { setError('ใส่จำนวนอย่างน้อย 1'); return; }
                        void run('tab-add', 'tab.add', {
                          billingGroupId: group.id,
                          sku: tabSku.trim(),
                          packQty: Math.round(qty),
                        }, () => { setTabSku(''); setTabQty('1'); setNotice('เพิ่มเข้าบิลแล้ว'); });
                      }}>
                      เพิ่มเข้าบิล
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* เกมที่ยืมอยู่ */}
          <div className="pos-block" style={{ marginTop: 10 }}>
            <div className="pos-block-title">เกมที่ยืม</div>
            {session.games.length === 0 && <div className="pos-block-hint">ยังไม่ได้ยืมกล่องเกม</div>}
            {session.games.map((loan) => (
              <div key={loan.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <div style={{ fontSize: 13 }}>
                  {loan.title ?? 'เกม'}
                  <span style={{ color: 'var(--pos-muted)' }}>{' · '}{loan.copyCode ?? '-'}{' · '}{loan.status}</span>
                </div>
                {!loan.returnedAt && (
                  <div style={{ display: 'flex', gap: 6 }}>
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
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
                <label style={{ fontSize: 12, flex: '1 1 220px' }}>
                  ให้ยืมกล่องเกม
                  <select value={copyId} onChange={(e) => setCopyId(e.target.value)} style={{ display: 'block', width: '100%' }}>
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
                <label style={{ fontSize: 12, flex: '1 1 160px' }}>
                  โน้ตตอนคืน
                  <input value={returnNote} onChange={(e) => setReturnNote(e.target.value)}
                    style={{ display: 'block', width: '100%' }} />
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
          <div className="pos-block" style={{ marginTop: 10 }}>
            <div className="pos-block-title">บัตรที่รับไว้</div>
            {session.identityHolds.filter((hold) => hold.status === 'HELD').length === 0 && (
              <div className="pos-block-hint">ไม่ได้ถือบัตรของโต๊ะนี้ไว้</div>
            )}
            {session.identityHolds.map((hold) => (
              <div key={hold.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <div style={{ fontSize: 13 }}>
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
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
                <label style={{ fontSize: 12, flex: '1 1 130px' }}>
                  ชนิดบัตร
                  <select value={idKind} onChange={(e) => setIdKind(e.target.value)} style={{ display: 'block', width: '100%' }}>
                    {Object.entries(IDENTITY_KIND_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 12, flex: '1 1 160px' }}>
                  ชื่อบนบัตร
                  <input value={idHolder} onChange={(e) => setIdHolder(e.target.value)}
                    style={{ display: 'block', width: '100%' }} />
                </label>
                {/* เลขไม่บังคับ — ร้านที่เก็บบัตรจริงไว้โดยไม่พิมพ์เลขก็ยังได้ด่านตอนปิดบิล
                    การบังคับพิมพ์จะไล่ร้านกลับไปใช้กระดาษ ซึ่งแย่กว่าทุกทาง */}
                <label style={{ fontSize: 12, flex: '1 1 160px' }}>
                  เลขบัตร (ไม่บังคับ)
                  <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)}
                    style={{ display: 'block', width: '100%' }} />
                </label>
                <label style={{ fontSize: 12, flex: '1 1 180px' }}>
                  ค้ำกล่องเกม (ไม่บังคับ)
                  <select value={idLoanId} onChange={(e) => setIdLoanId(e.target.value)} style={{ display: 'block', width: '100%' }}>
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

          {/* เวลาที่ซื้อไว้ — แก้ยอดเงินของโต๊ะ จึงเป็นสิทธิ์ของตัวเอง (override_time)
              คนที่ไม่ได้ถือสิทธิ์นี้กดแล้วจะได้ 403 พร้อมบอกว่าต้องให้ใครมาทำ */}
          {session.status === 'OPEN' && (
            <div className="pos-block" style={{ marginTop: 10 }}>
              <div className="pos-block-title">เวลาที่ซื้อไว้</div>
              <div className="pos-block-hint">
                {session.billingMode === 'FIXED_DURATION'
                  ? `ซื้อไว้ ${plannedMinutes(session)} นาที`
                  : 'เปิดยาว — คิดตามเวลาที่เล่นจริง ยังไม่ได้ซื้อเวลาไว้ล่วงหน้า'}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
                <label style={{ fontSize: 12 }}>
                  เวลาที่ซื้อ (นาที)
                  <input value={planMinutes} onChange={(e) => setPlanMinutes(e.target.value)} inputMode="numeric"
                    style={{ display: 'block', width: 120 }} />
                </label>
                <label style={{ fontSize: 12 }}>
                  เตือนก่อนหมดเวลา (นาที)
                  <input value={planAlert} onChange={(e) => setPlanAlert(e.target.value)} inputMode="numeric"
                    style={{ display: 'block', width: 140 }} />
                </label>
                {session.billingMode === 'FIXED_DURATION' && (
                  <button type="button" className="pos-ret-btn" disabled={busy === 'timing'}
                    onClick={() => void run('timing', 'timing', {
                      sessionId: session.id,
                      billingMode: 'FIXED_DURATION',
                      expectedDurationMinutes: plannedMinutes(session) + 30,
                      alertBeforeMinutes: Number(planAlert) || 0,
                    }, () => setNotice('เพิ่มเวลาให้อีก 30 นาทีแล้ว'))}>
                    +30 นาที
                  </button>
                )}
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

          {/* ปิดโต๊ะ / ยกเลิก */}
          <div className="pos-block" style={{ marginTop: 10 }}>
            {session.billingGroups.length > 1 && session.billingGroups.some((group) => group.status === 'OPEN') && (
              <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="pos-block-hint">
                  คนที่กลับก่อน: ปิดเฉพาะบิลของกลุ่มนั้นได้ กลุ่มอื่นยังจับเวลาและสั่งของต่อเหมือนเดิม
                </div>
                {session.billingGroups
                  .filter((group) => group.status === 'OPEN')
                  .map((group) => (
                    <button key={group.id} type="button" className="pos-ret-btn pos-ret-btn--open"
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
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {session.status === 'OPEN' && (
                <button type="button" className="pos-ret-btn pos-ret-btn--solid" disabled={busy === 'close'}
                  onClick={() => void run('close', 'close', { sessionId: session.id }, undefined)
                    .then((data) => {
                      if (!data) return;
                      // โต๊ะกลุ่มเดียว = ส่งไปเก็บเงินต่อทันทีเหมือนเดิม · โต๊ะที่แยกบิลต้องให้
                      // พนักงานเลือกเองว่าจะเก็บใบไหนก่อน เพราะแต่ละใบคือคนละคนที่จ่ายคนละครั้ง
                      const billed = ((data as any)?.result?.groups ?? []) as BillingGroup[];
                      if (billed.length === 1) {
                        setNotice('ปิดเวลาแล้ว — ไปเก็บเงินที่แท็บขาย');
                        onCheckout(billed[0].id);
                        return;
                      }
                      setNotice(`ปิดเวลาแล้ว · โต๊ะนี้แยกเป็น ${billed.length} บิล — เลือกเก็บทีละใบด้านล่าง`);
                    })}>
                  {busy === 'close'
                    ? 'กำลังปิด…'
                    : session.billingGroups.length > 1 ? 'ปิดเวลาทุกกลุ่ม' : 'ปิดเวลา แล้วไปเก็บเงิน'}
                </button>
              )}
            </div>

            {/* บิลที่ปิดเวลาแล้วแต่ยังไม่ได้เก็บเงิน — หนึ่งปุ่มต่อหนึ่งบิล */}
            {session.billingGroups.some((group) => group.status === 'CLOSING') && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {session.billingGroups.length > 1 && (
                  <div className="pos-block-hint">
                    โต๊ะนี้แยกเป็น {session.billingGroups.length} บิล — เก็บเงินทีละใบ ใบที่จ่ายแล้วจะหายไปเอง
                  </div>
                )}
                {session.billingGroups
                  .filter((group) => group.status === 'CLOSING')
                  .map((group) => (
                    <button key={group.id} type="button" className="pos-ret-btn pos-ret-btn--solid"
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

            {session.status !== 'PAID' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
                <label style={{ fontSize: 12, flex: '1 1 240px' }}>
                  เหตุผลที่ยกเลิกโต๊ะ
                  <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="เช่น ลูกค้าเปลี่ยนใจก่อนเริ่มเล่น" style={{ display: 'block', width: '100%' }} />
                </label>
                <button type="button" className="pos-ret-btn pos-ret-btn--danger"
                  disabled={!cancelReason.trim() || busy === 'cancel'}
                  onClick={() => void run('cancel', 'cancel', {
                    sessionId: session.id, reason: cancelReason.trim(),
                  }, () => { setCancelReason(''); setSelectedId(''); setSession(null); setNotice('ยกเลิกโต๊ะแล้ว'); })}>
                  ยกเลิกโต๊ะ
                </button>
              </div>
            )}
            <div className="pos-block-hint">
              ยกเลิกโต๊ะคือการบอกว่า “ไม่เก็บเงินเวลานี้” — ต้องมีเหตุผลเสมอเพราะมันลบเวลาที่นับไปแล้ว
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

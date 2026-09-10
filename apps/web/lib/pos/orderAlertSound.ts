/**
 * เสียงเตือน "มีงานเข้า" ของจอหน้าร้าน — ส่วนที่เป็นกติกาล้วน ไม่แตะเบราว์เซอร์
 *
 * แยกจาก `orderAlertPlayer.ts` (ตัวที่เรียก WebAudio จริง) เพราะไฟล์นี้ต้อง import ได้จาก
 * เทสที่ไม่มี DOM — กติกาที่ทดสอบไม่ได้คือกติกาที่ไม่มีใครกล้าแก้
 *
 * ⚠️ ทำไมเสียงจึงเป็นเรื่องของ "อุปกรณ์" ไม่ใช่ของร้านและไม่ใช่ของ user:
 * จอครัวที่แขวนอยู่เหนือเตากับแท็บเล็ตแคชเชียร์คือคนละเครื่อง คนละความดัง คนละงาน
 * ถ้าเก็บระดับร้าน การหรี่เสียงที่เคาน์เตอร์จะไปปิดเสียงของครัวไปด้วย
 */

export type AlertKind =
  | "ORDER_ACTION"   // ออเดอร์ออนไลน์ใหม่/ชำระแล้วที่พนักงานต้องรับช่วงต่อ
  | "INBOX_MESSAGE"  // ลูกค้าส่งข้อความใหม่เข้ากล่องข้อความกลาง
  | "ORDER_NEW"      // ตั๋วครัวใบใหม่ (พนักงานกดส่งครัว / รับออร์เดอร์ QR / รับคำขอจากแชท)
  | "QR_PENDING"     // ลูกค้าที่โต๊ะส่งคำขอผ่าน QR มารอให้พนักงานกดรับ
  | "CHAT_REQUEST"   // คำขอสั่งอาหารจากแชท/AI รอพนักงานตรวจ
  | "FOOD_READY"     // ครัวกดพร้อมเสิร์ฟ — เป็นสัญญาณของ "คนเสิร์ฟ" ไม่ใช่ของครัว
  | "SLA_LATE";      // ตั๋วที่เลยเกณฑ์เวลาของสถานีตัวเอง

export const ALERT_KINDS: readonly AlertKind[] = [
  "ORDER_ACTION", "INBOX_MESSAGE", "ORDER_NEW", "QR_PENDING", "CHAT_REQUEST", "FOOD_READY", "SLA_LATE",
] as const;

export type AlertToneId = "CHIME" | "BELL" | "DOUBLE_BEEP" | "MARIMBA" | "ALARM" | "SOFT_PING" | "NONE";

export type ToneStep = {
  /** ความถี่ (Hz) */
  hz: number;
  /** เริ่มเล่นกี่มิลลิวินาทีหลังเริ่มเสียง */
  atMs: number;
  durationMs: number;
  /** 0..1 — คูณกับ volume ของอุปกรณ์อีกที */
  gain: number;
  type: "sine" | "triangle" | "square";
};

export type AlertTone = {
  id: AlertToneId;
  /** ว่าง = เงียบโดยตั้งใจ (ผู้ใช้เลือก "ไม่มีเสียง" ให้เหตุการณ์นั้น) */
  steps: readonly ToneStep[];
};

/**
 * เสียงสังเคราะห์เองทั้งหมด ไม่โหลดไฟล์ — จอครัวต้องร้องได้ตอนเน็ตร้านหลุด และการโหลด
 * เสียงจากโดเมนอื่นคือสิ่งที่จอครัวไม่ควรต้องพึ่ง
 *
 * ทุกเสียงต้องแยกออกจากกัน **ด้วยหู** ไม่ใช่แค่ต่างตัวเลข — ครัวได้ยินทั้งวันจนจำรูปแบบได้
 * จึงคุมสองอย่าง: ทิศของทำนอง (ขึ้น/ลง/ย้ำที่เดิม) และจำนวนโน้ต
 */
export const ALERT_TONES: readonly AlertTone[] = [
  // ทำนองขึ้นสองโน้ต — เสียงเดิมของจอครัวตั้งแต่ 9.53 เก็บไว้เพื่อไม่ให้ร้านที่ชินแล้วต้องเรียนใหม่
  { id: "CHIME", steps: [
    { hz: 880, atMs: 0, durationMs: 150, gain: 0.22, type: "sine" },
    { hz: 1174, atMs: 160, durationMs: 180, gain: 0.22, type: "sine" },
  ] },
  // กระดิ่งเคาน์เตอร์ — โน้ตสูงหางยาว ดังทะลุเสียงครัวได้ดีที่สุดในชุดนี้
  { id: "BELL", steps: [
    { hz: 1568, atMs: 0, durationMs: 90, gain: 0.24, type: "triangle" },
    { hz: 2093, atMs: 60, durationMs: 420, gain: 0.18, type: "sine" },
  ] },
  // สองจังหวะสั้นระดับเดียวกัน — อ่านว่า "มีของเข้าคิว" ไม่ใช่ "รีบ"
  { id: "DOUBLE_BEEP", steps: [
    { hz: 1046, atMs: 0, durationMs: 110, gain: 0.2, type: "square" },
    { hz: 1046, atMs: 170, durationMs: 110, gain: 0.2, type: "square" },
  ] },
  // สามโน้ตไล่ขึ้น นุ่มกว่าเพื่อน — สำหรับงานที่ต้องรู้แต่ไม่ต้องวิ่ง
  { id: "MARIMBA", steps: [
    { hz: 659, atMs: 0, durationMs: 130, gain: 0.2, type: "triangle" },
    { hz: 880, atMs: 120, durationMs: 130, gain: 0.2, type: "triangle" },
    { hz: 1318, atMs: 240, durationMs: 220, gain: 0.18, type: "triangle" },
  ] },
  // สลับสองระดับสี่ครั้ง ยาวสุดในชุด — สงวนไว้ให้ของที่เลยเวลาแล้วเท่านั้น
  // ถ้าเอาไปใช้กับงานปกติ ครัวจะชินแล้วเลิกได้ยินตอนที่มันสำคัญจริง
  { id: "ALARM", steps: [
    { hz: 740, atMs: 0, durationMs: 150, gain: 0.24, type: "square" },
    { hz: 988, atMs: 160, durationMs: 150, gain: 0.24, type: "square" },
    { hz: 740, atMs: 320, durationMs: 150, gain: 0.24, type: "square" },
    { hz: 988, atMs: 480, durationMs: 200, gain: 0.24, type: "square" },
  ] },
  // โน้ตเดียวเบา ๆ — สำหรับจอที่อยู่ใกล้ลูกค้า
  { id: "SOFT_PING", steps: [
    { hz: 1318, atMs: 0, durationMs: 260, gain: 0.16, type: "sine" },
  ] },
  // เงียบโดยตั้งใจ — ต่างจาก "ปิดเสียงทั้งเครื่อง" ตรงที่ปิดได้ทีละเหตุการณ์
  { id: "NONE", steps: [] },
] as const;

export const ALERT_TONE_IDS: readonly AlertToneId[] = ALERT_TONES.map((tone) => tone.id);

export function findAlertTone(id: AlertToneId): AlertTone {
  return ALERT_TONES.find((tone) => tone.id === id) ?? ALERT_TONES[0];
}

/** ความยาวรวมของเสียงหนึ่งครั้ง — ใช้กันไม่ให้ตั้งรอบย้ำสั้นกว่าตัวเสียงเอง */
export function alertToneDurationMs(id: AlertToneId): number {
  return findAlertTone(id).steps.reduce((longest, step) => Math.max(longest, step.atMs + step.durationMs), 0);
}

export type OrderAlertSettings = {
  enabled: boolean;
  /** 0..1 */
  volume: number;
  tones: Record<AlertKind, AlertToneId>;
  /** ย้ำทุกกี่วินาทีตราบใดที่ยังมีงานค้างที่ไม่มีใครรับ · 0 = ดังครั้งเดียว */
  repeatSeconds: number;
  /** ย้ำได้มากสุดกี่ครั้งต่อหนึ่งกอง — กันเสียงดังทั้งวันตอนไม่มีคนอยู่หน้าจอ */
  maxRepeats: number;
};

/**
 * ⚠️ ค่าเริ่มต้นคือ **เปิดเสียง** ต่างจากของเดิม (9.53) ที่ปิดไว้
 *
 * เหตุผลที่เคยปิดไว้คือเบราว์เซอร์บล็อกเสียงจนกว่าจะมีคนแตะจอ — แต่นั่นเป็นเหตุผลให้
 * **บอกผู้ใช้ว่าต้องแตะ** ไม่ใช่เหตุผลให้จอครัวเงียบไปเลย · ผลของค่าเดิมคือแท็บเล็ตเครื่องใหม่
 * ทุกเครื่องเริ่มต้นแบบเงียบสนิทโดยไม่มีอะไรบอก ซึ่งอ่านไม่ต่างจาก "ระบบไม่มีเสียงเตือน"
 */
export function defaultOrderAlertSettings(): OrderAlertSettings {
  return {
    enabled: true,
    volume: 0.8,
    tones: {
      ORDER_ACTION: "BELL",
      INBOX_MESSAGE: "DOUBLE_BEEP",
      ORDER_NEW: "CHIME",
      QR_PENDING: "MARIMBA",
      CHAT_REQUEST: "DOUBLE_BEEP",
      FOOD_READY: "SOFT_PING",
      SLA_LATE: "ALARM",
    },
    repeatSeconds: 20,
    maxRepeats: 10,
  };
}

export const ORDER_ALERT_STORAGE_KEY = "bms.pos.orderAlert.v1";
/** คีย์ของ 9.53 — อ่านครั้งเดียวเพื่อไม่ให้ร้านที่เคยปิดเสียงไว้เจอเสียงเด้งขึ้นมาเอง */
export const LEGACY_CHIME_STORAGE_KEY = "bms.pos.kitchenChime";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function numberOr(raw: unknown, fallback: number): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * ค่าที่อ่านมาจาก localStorage เป็นของที่ผู้ใช้/เวอร์ชันก่อนหน้าเขียนไว้ ไม่ใช่ของที่เราคุม —
 * ค่าที่ผิดรูปต้องตกกลับไปที่ค่าปริยาย ไม่ใช่ทำให้จอครัวพังหรือเงียบ
 */
export function normalizeOrderAlertSettings(raw: unknown, legacyEnabled?: boolean | null): OrderAlertSettings {
  const base = defaultOrderAlertSettings();
  if (!raw || typeof raw !== "object") {
    // ไม่เคยตั้งค่าบนเครื่องนี้ → เคารพสวิตช์ยุค 9.53 ถ้ามี
    return typeof legacyEnabled === "boolean" ? { ...base, enabled: legacyEnabled } : base;
  }
  const input = raw as Record<string, unknown>;
  const tones = { ...base.tones };
  const rawTones = input.tones;
  if (rawTones && typeof rawTones === "object") {
    for (const kind of ALERT_KINDS) {
      const candidate = (rawTones as Record<string, unknown>)[kind];
      if (typeof candidate === "string" && (ALERT_TONE_IDS as readonly string[]).includes(candidate)) {
        tones[kind] = candidate as AlertToneId;
      }
    }
  }
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : base.enabled,
    volume: clamp(numberOr(input.volume, base.volume), 0, 1),
    tones,
    // เพดานบนกันคนตั้งเป็นชั่วโมงแล้วเข้าใจว่าเสียงพัง · ล่างเป็น 0 = ดังครั้งเดียว
    repeatSeconds: clamp(Math.round(numberOr(input.repeatSeconds, base.repeatSeconds)), 0, 300),
    maxRepeats: clamp(Math.round(numberOr(input.maxRepeats, base.maxRepeats)), 0, 50),
  };
}

export function toneForKind(settings: OrderAlertSettings, kind: AlertKind): AlertToneId {
  return settings.tones[kind] ?? defaultOrderAlertSettings().tones[kind];
}

/** เสียงจะดังจริงไหม — ปิดทั้งเครื่อง หรือเลือก "ไม่มีเสียง" ให้เหตุการณ์นั้น ก็เงียบเหมือนกัน */
export function willSound(settings: OrderAlertSettings, kind: AlertKind): boolean {
  return settings.enabled && toneForKind(settings, kind) !== "NONE";
}

// ---------------------------------------------------------------------------
// ของใหม่ตั้งแต่รอบก่อน
// ---------------------------------------------------------------------------

/**
 * รายการที่ "เพิ่งโผล่" เทียบกับรอบก่อน — ไม่ใช่ทุกใบที่ยังค้างอยู่
 *
 * ⚠️ รอบแรกหลังเปิดจอคือการตั้งต้น ต้องคืนค่าว่างเสมอ ไม่งั้นเปิดจอครัวตอนมีงานค้าง 20 ใบ
 * จะได้เสียงรัวทันที ซึ่งไม่ได้บอกอะไรเลยว่ามีอะไรใหม่
 */
export function newAlertIds(previous: ReadonlySet<string> | null, current: readonly string[]): string[] {
  if (!previous) return [];
  return current.filter((id) => !previous.has(id));
}

// ---------------------------------------------------------------------------
// การย้ำจนกว่าจะมีคนรับ
// ---------------------------------------------------------------------------

export type AlertRepeatState = {
  /** เวลาที่ดังครั้งล่าสุดของกองนี้ · null = ยังไม่เคยตั้งนาฬิกา */
  lastPlayedAt: number | null;
  /** ย้ำไปแล้วกี่ครั้ง (ไม่นับครั้งแรกที่ดังตอนของใหม่เข้ามา) */
  repeats: number;
};

export const IDLE_ALERT_REPEAT: AlertRepeatState = { lastPlayedAt: null, repeats: 0 };

/**
 * ดังครั้งเดียวแล้วเงียบ = ครัวที่กำลังผัดอยู่ตอนนั้นพลาดออร์เดอร์นั้นไปเลย ซึ่งเป็นเหตุผล
 * ทั้งหมดที่ระบบนี้มีเสียง · จึงย้ำจนกว่าจะไม่มีงานค้าง (ครัวกด "เริ่มทำ" แล้วตั๋วออกจากกอง)
 * โดยมีเพดานกันเสียงดังทั้งคืนตอนร้านปิดแล้วลืมปิดจอ
 *
 * ฟังก์ชันนี้ตัดสิน "ควรย้ำตอนนี้ไหม" อย่างเดียว — เสียงครั้งแรกของงานใหม่เป็นหน้าที่ของ
 * `newAlertIds` ไม่ใช่ของที่นี่ สองอย่างนี้จึงไม่ทับกัน
 */
export function evaluateAlertRepeat(
  state: AlertRepeatState,
  input: { pending: boolean; now: number; repeatSeconds: number; maxRepeats: number }
): { play: boolean; state: AlertRepeatState } {
  // ไม่มีงานค้างแล้ว = ล้างนาฬิกา ไม่ใช่แค่หยุดดัง (กองถัดไปต้องเริ่มนับใหม่)
  if (!input.pending) return { play: false, state: IDLE_ALERT_REPEAT };
  if (input.repeatSeconds <= 0 || input.maxRepeats <= 0) return { play: false, state };
  // เพิ่งเห็นว่ามีงานค้าง — ตั้งนาฬิกาไว้เฉย ๆ ยังไม่ดัง เพราะเสียงครั้งแรกมาจากของใหม่แล้ว
  if (state.lastPlayedAt === null) return { play: false, state: { lastPlayedAt: input.now, repeats: 0 } };
  if (state.repeats >= input.maxRepeats) return { play: false, state };
  if (input.now - state.lastPlayedAt < input.repeatSeconds * 1000) return { play: false, state };
  return { play: true, state: { lastPlayedAt: input.now, repeats: state.repeats + 1 } };
}

// ---------------------------------------------------------------------------
// จอนี้ยังได้ข้อมูลอยู่ไหม
// ---------------------------------------------------------------------------

export type FeedHealth = "LIVE" | "SLOW" | "STALE";

/**
 * ⚠️ จอครัวที่ค้างเงียบ ๆ อ่านไม่ต่างจากจอครัวที่ไม่มีออร์เดอร์เลย — ซึ่งเป็นความล้มเหลว
 * ที่แพงที่สุดของเรื่องนี้ทั้งเรื่อง · ป้าย "อัปเดตอัตโนมัติ" ต้องมาจาก **เวลาที่โหลดสำเร็จ
 * ครั้งล่าสุด** ไม่ใช่จากนาฬิกาของเครื่อง (ของเดิมโชว์นาฬิกา จึงเดินสวยตลอดแม้เน็ตตายไปแล้ว)
 */
export function feedHealth(lastOkAt: number | null, now: number, intervalMs: number): FeedHealth {
  if (lastOkAt === null) return "STALE";
  const age = now - lastOkAt;
  if (age < 0) return "LIVE";
  // เผื่อ jitter ของรอบ poll ไว้สามรอบ แต่ไม่ต่ำกว่า 15 วินาที เพราะรอบที่ยาว (จออื่น)
  // ไม่ควรถูกตัดสินว่าช้าเพียงเพราะรอบมันยาวโดยตั้งใจ
  if (age <= Math.max(intervalMs * 3, 15_000)) return "LIVE";
  if (age <= Math.max(intervalMs * 10, 60_000)) return "SLOW";
  return "STALE";
}

/**
 * "ล่าสุดเมื่อไร" แบบหยาบพอสำหรับหน้าจอหน้าร้าน — คืนหน่วยกับตัวเลขแยกกัน เพื่อให้ผู้เรียก
 * ประกอบข้อความผ่าน `t()` เองได้ทั้งสองภาษา (ที่นี่ไม่รู้จัก i18n และไม่ควรรู้)
 */
export function describeAgo(lastOkAt: number | null, now: number): { unit: "seconds" | "minutes"; value: number } | null {
  if (lastOkAt === null) return null;
  const seconds = Math.max(0, Math.round((now - lastOkAt) / 1000));
  return seconds < 90 ? { unit: "seconds", value: seconds } : { unit: "minutes", value: Math.round(seconds / 60) };
}

/**
 * รอบ poll ของจอหนึ่ง ๆ — จอที่กำลังถูกมองต้องไวกว่าจอที่เปิดค้างไว้เฉย ๆ แต่
 * **ต้องไม่หยุดสนิท** เพราะป้ายตัวเลขบนแถบซ้ายมองเห็นได้จากทุกจอ
 *
 * ⚠️ อาการ "ส่งครัวแล้วรอ 3-5 นาทีกว่าจะเด้ง" มาจากตรงนี้: ของเดิม `loadTickets()` วิ่ง
 * **เฉพาะตอนเปิดแท็บครัวอยู่** ป้ายจำนวนบนแถบซ้ายจึงไม่มีวันขยับตอนพนักงานยืนหน้าผังโต๊ะ
 * (โค้ดเดิมเขียนคอมเมนต์เตือนเรื่องนี้ไว้เองแล้วสำหรับป้าย QR และป้ายคิว แต่ไม่ได้แก้ให้ตั๋วครัว)
 */
export function alertPollIntervalMs(input: { focused: boolean; visible: boolean }): number {
  // แท็บที่ถูกซ่อนโดนเบราว์เซอร์หรี่ timer อยู่แล้ว (Chrome เหลือ ~1 ครั้ง/นาที เมื่อซ่อนครบ
  // 5 นาที) — ขอถี่กว่านี้ก็ไม่ได้ตามที่ขอ จึงประกาศเจตนาให้ตรงกับความจริงแทน แล้วไป
  // ชดเชยด้วยการโหลดทันทีตอนกลับมามองเห็น (useLiveRefresh)
  if (!input.visible) return 60_000;
  return input.focused ? 5_000 : 15_000;
}

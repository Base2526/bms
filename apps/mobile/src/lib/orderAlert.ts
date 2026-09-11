// กติกาการแจ้งเตือน "มีออร์เดอร์เข้า" — โมดูลนี้ตั้งใจไม่ import อะไรเลย (เทสได้โดยไม่ต้องมี RN)
//
// พอร์ตกติกามาจากฝั่งเว็บ (`apps/web/lib/pos/orderAlertSound.ts`) ไม่ได้คิดชุดที่สองขึ้นมาเอง —
// สองชุดจะ drift แล้ววันหนึ่งจอสองจอของร้านเดียวกันเตือนคนละแบบ

export type OrderAlertKind = 'incoming_order' | 'kitchen_ticket';

export const ORDER_ALERT_KINDS: OrderAlertKind[] = [
  'incoming_order',
  'kitchen_ticket',
];

export interface OrderAlertSettings {
  /** สวิตช์ใหญ่ — ปิดแล้วเงียบทุกช่องทาง */
  enabled: boolean;
  kinds: Record<OrderAlertKind, boolean>;
  vibrate: boolean;
  sound: boolean;
  /** ย้ำซ้ำทุกกี่วินาทีตราบใดที่ยังไม่มีใครรับทราบ · 0 = ไม่ย้ำ */
  repeatSeconds: number;
}

/**
 * ⚠️ ค่าปริยายต้องเป็น "เปิด"
 *
 * ฝั่งเว็บเคยตั้งค่าปริยายเป็นปิด แล้วแท็บเล็ตเครื่องใหม่ทุกเครื่องเริ่มต้นแบบเงียบ
 * ซึ่งพนักงานอ่านไม่ต่างจาก "ระบบนี้ไม่มีเสียงเตือน" · ร้านที่ไม่อยากได้ค่อยไปกดปิดเอง
 */
export const DEFAULT_ORDER_ALERT_SETTINGS: OrderAlertSettings = {
  enabled: true,
  kinds: { incoming_order: true, kitchen_ticket: true },
  vibrate: true,
  sound: true,
  repeatSeconds: 30,
};

const MIN_REPEAT_SECONDS = 10;
const MAX_REPEAT_SECONDS = 300;

export function normalizeOrderAlertSettings(
  patch: Partial<OrderAlertSettings> | null | undefined,
  base: OrderAlertSettings = DEFAULT_ORDER_ALERT_SETTINGS,
): OrderAlertSettings {
  const next: OrderAlertSettings = {
    enabled: patch?.enabled ?? base.enabled,
    kinds: { ...base.kinds, ...(patch?.kinds ?? {}) },
    vibrate: patch?.vibrate ?? base.vibrate,
    sound: patch?.sound ?? base.sound,
    repeatSeconds: patch?.repeatSeconds ?? base.repeatSeconds,
  };
  // ค่าที่อ่านไม่ออกตกกลับค่าปริยาย ไม่ใช่กลายเป็น 0 (= เลิกย้ำ) เงียบ ๆ
  if (!Number.isFinite(next.repeatSeconds) || next.repeatSeconds < 0) {
    next.repeatSeconds = DEFAULT_ORDER_ALERT_SETTINGS.repeatSeconds;
  } else if (next.repeatSeconds > 0) {
    next.repeatSeconds = Math.min(
      MAX_REPEAT_SECONDS,
      Math.max(MIN_REPEAT_SECONDS, Math.round(next.repeatSeconds)),
    );
  }
  return next;
}

/**
 * id ที่เพิ่งโผล่เทียบกับรอบก่อน
 *
 * ⚠️ รอบแรกหลังเปิดจอเป็น "การตั้งต้น" ห้ามเตือน — ไม่งั้นเปิดแอปมาเจอออร์เดอร์ค้าง 5 ใบ
 * แล้วเครื่องสั่นรัว 5 ครั้งทั้งที่ไม่มีอะไรใหม่เกิดขึ้นเลย (ผู้เรียกส่ง `primed: false` รอบแรก)
 */
export function newAlertIds(
  seen: ReadonlySet<string>,
  current: readonly string[],
): string[] {
  return current.filter(id => !seen.has(id));
}

export interface RepeatInput {
  /** จำนวนออร์เดอร์ที่ยังไม่มีใครรับทราบ */
  pendingCount: number;
  /** เวลาที่เตือนครั้งล่าสุด (ms) · null = ยังไม่เคยเตือน */
  lastAlertAtMs: number | null;
  nowMs: number;
  repeatSeconds: number;
  /** มีคนกด "รับทราบ" แล้วหรือยัง — รับทราบแล้วต้องเงียบจนกว่าจะมีใบใหม่ */
  acknowledged: boolean;
}

/**
 * ถึงเวลาย้ำหรือยัง
 *
 * ⚠️ "รับทราบ" ต้องหยุดการย้ำได้จริง ไม่งั้นแจ้งเตือนที่ปิดไม่ได้จะถูกปิดทั้งระบบแทน
 * (คนหน้าร้านปิดสวิตช์ใหญ่ทิ้งเพราะรำคาญ แล้วออร์เดอร์จริงใบถัดไปก็เงียบไปด้วย)
 */
export function shouldRepeatAlert(input: RepeatInput): boolean {
  if (input.acknowledged) return false;
  if (input.pendingCount <= 0) return false;
  if (input.repeatSeconds <= 0) return false;
  if (input.lastAlertAtMs == null) return true;
  return input.nowMs - input.lastAlertAtMs >= input.repeatSeconds * 1000;
}

/**
 * รูปแบบการสั่น — ต้องแยกจากกันด้วย "จังหวะ" ไม่ใช่ความยาว
 * ออร์เดอร์เข้า (สิ่งที่ต้องรีบตัดสินใจ) สั่นสามจังหวะ · ตั๋วครัวสั่นสองจังหวะสั้นกว่า
 *
 * รูปแบบของ RN คือ [หน่วงก่อนเริ่ม, สั่น, หยุด, สั่น, ...] (Android ใช้ทั้งอาร์เรย์,
 * iOS ใช้เฉพาะช่วงหน่วงเพราะคุมความยาวการสั่นเองไม่ได้)
 */
export const ORDER_ALERT_VIBRATION: Record<OrderAlertKind, number[]> = {
  incoming_order: [0, 260, 140, 260, 140, 260],
  kitchen_ticket: [0, 180, 120, 180],
};

export type AlertChannelResult = 'played' | 'skipped' | 'unavailable';

export interface AlertOutcome {
  sound: AlertChannelResult;
  vibration: AlertChannelResult;
}

/**
 * แจ้งเตือนรอบนี้ "ถึงคนจริงไหม"
 *
 * ⚠️ กติกานี้มีไว้เพราะบั๊กเดิมของฝั่งเว็บ: ปุ่มโชว์ว่า "เปิดเสียงอยู่" แต่เงียบสนิท
 * เพราะเบราว์เซอร์บล็อก AudioContext — **การรายงานว่าดังแล้วทั้งที่เงียบคือสิ่งที่ทำให้บั๊กนั้น
 * อยู่ได้เป็นเดือน** · ที่นี่จึงถือว่า "เตือนไม่ถึง" เมื่อทุกช่องทางที่เปิดไว้ไม่ได้ทำงานจริง
 */
export function alertReachedSomeone(outcome: AlertOutcome): boolean {
  return outcome.sound === 'played' || outcome.vibration === 'played';
}

/** ข้อความบนแถบเตือนเมื่อเปิดเสียงไว้แต่เล่นไม่ได้ — ต้องบอกสาเหตุ ไม่ใช่แค่ว่าล้มเหลว */
export function alertBlockedNotice(outcome: AlertOutcome): string | null {
  if (outcome.sound === 'unavailable' && outcome.vibration === 'played') {
    return 'เครื่องนี้ยังไม่มีโมดูลเสียง — แจ้งเตือนด้วยการสั่นและแถบบนจอแทน';
  }
  if (!alertReachedSomeone(outcome)) {
    return 'แจ้งเตือนไม่ถึงเครื่องนี้ (ไม่มีทั้งเสียงและการสั่น) — ดูแถบบนจอแทน';
  }
  return null;
}

export function describeAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'เมื่อครู่';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'เมื่อครู่';
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ชม. ${minutes % 60} น. ที่แล้ว`;
}

import { useCallback, useSyncExternalStore } from 'react';
import { Platform, Vibration } from 'react-native';
import {
  DEFAULT_ORDER_ALERT_SETTINGS,
  ORDER_ALERT_VIBRATION,
  alertBlockedNotice,
  normalizeOrderAlertSettings,
  type AlertChannelResult,
  type AlertOutcome,
  type OrderAlertKind,
  type OrderAlertSettings,
} from '../lib/orderAlert';
import {
  hasOrderAlertSoundPlayer,
  playOrderAlertSound,
} from '../lib/orderAlertSound';

/**
 * สถานะการแจ้งเตือนของ "ทั้งแอป" — เก็บที่ระดับโมดูล ไม่ใช่ state ใน hook
 *
 * ⚠️ เหตุผลมาจากบั๊กจริงของฝั่งเว็บ: hook เดียวกันถูก mount สองตัวในหน้าเดียว แล้ว
 * (ก) สร้างตัวเล่นเสียงสองตัวต่อหน้า (ข) ปรับความดังที่แผงหนึ่งแล้วกดปิดที่อีกแผง
 * ค่าเด้งกลับ เพราะแผงที่สอง merge patch เข้ากับ settings ชุดเก่าที่มันถืออยู่
 * ที่นี่จึงมีชุดเดียวทั้งแอป และทุกจุดอ่านผ่าน `useSyncExternalStore`
 */
interface OrderAlertState {
  settings: OrderAlertSettings;
  lastAlertAtMs: number | null;
  lastKind: OrderAlertKind | null;
  /** มีคนกด "รับทราบ" แล้ว — หยุดย้ำจนกว่าจะมีใบใหม่เข้ามา */
  acknowledged: boolean;
  blockedNotice: string | null;
}

let state: OrderAlertState = {
  settings: DEFAULT_ORDER_ALERT_SETTINGS,
  lastAlertAtMs: null,
  lastKind: null,
  acknowledged: false,
  blockedNotice: null,
};

const listeners = new Set<() => void>();

function emit(next: Partial<OrderAlertState>) {
  state = { ...state, ...next };
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

/**
 * สั่นจริงไหม — ตอบเท่าที่รู้ได้จาก JS
 *
 * ⚠️ `Vibration.vibrate()` ไม่บอกว่าเครื่องมีมอเตอร์สั่นหรือเปล่า **แท็บเล็ตหน้าร้านส่วนใหญ่ไม่มี**
 * จึงคืน 'played' ได้แค่ในความหมาย "สั่งไปแล้วไม่ error" — ด้วยเหตุนี้แถบบนจอกับป้ายบนแท็บ
 * จึงเป็นช่องทางที่ **การันตีได้** ส่วนเสียง/การสั่นเป็น best-effort เสมอ
 */
function vibrateFor(kind: OrderAlertKind): AlertChannelResult {
  try {
    const pattern = ORDER_ALERT_VIBRATION[kind];
    // iOS คุมความยาวการสั่นเองไม่ได้ อาร์เรย์จึงถูกอ่านเป็นช่วงหน่วงอย่างเดียว
    Vibration.vibrate(pattern, false);
    return 'played';
  } catch {
    return 'unavailable';
  }
}

/** ยิงแจ้งเตือนหนึ่งครั้ง · คืนผลว่าช่องทางไหนทำงานจริงบ้าง */
export function fireOrderAlert(kind: OrderAlertKind, nowMs = Date.now()) {
  const { settings } = state;
  const outcome: AlertOutcome = { sound: 'skipped', vibration: 'skipped' };

  if (!settings.enabled || !settings.kinds[kind]) {
    return outcome;
  }

  if (settings.sound) {
    outcome.sound = hasOrderAlertSoundPlayer()
      ? playOrderAlertSound(kind)
        ? 'played'
        : 'unavailable'
      : 'unavailable';
  }
  if (settings.vibrate) {
    outcome.vibration = vibrateFor(kind);
  }

  emit({
    lastAlertAtMs: nowMs,
    lastKind: kind,
    acknowledged: false,
    blockedNotice: alertBlockedNotice(outcome),
  });
  return outcome;
}

export function acknowledgeOrderAlerts() {
  Vibration.cancel();
  emit({ acknowledged: true, blockedNotice: null });
}

/** มีใบใหม่เข้ามา = การรับทราบครั้งก่อนหมดอายุ */
export function resetOrderAlertAcknowledgement() {
  if (state.acknowledged) emit({ acknowledged: false });
}

export function updateOrderAlertSettings(patch: Partial<OrderAlertSettings>) {
  emit({ settings: normalizeOrderAlertSettings(patch, state.settings) });
}

/** อ่านสถานะปัจจุบันนอก React (เทส/ตัวเฝ้าดู) */
export function getOrderAlertSnapshot(): OrderAlertState {
  return state;
}

/** ใช้ในเทสเท่านั้น — คืนสถานะให้เหมือนเพิ่งเปิดแอป */
export function __resetOrderAlertStateForTest() {
  state = {
    settings: DEFAULT_ORDER_ALERT_SETTINGS,
    lastAlertAtMs: null,
    lastKind: null,
    acknowledged: false,
    blockedNotice: null,
  };
  listeners.forEach(listener => listener());
}

export interface UseOrderAlerts extends OrderAlertState {
  /** เครื่องนี้มีโมดูลเสียงติดตั้งอยู่จริงไหม (ดู lib/orderAlertSound.ts) */
  soundAvailable: boolean;
  /** เครื่องนี้พอจะสั่นได้ไหม — เว็บ/แท็บเล็ตบางรุ่นไม่มีมอเตอร์สั่น */
  vibrationSupported: boolean;
  setSettings: (patch: Partial<OrderAlertSettings>) => void;
  acknowledge: () => void;
}

export function useOrderAlerts(): UseOrderAlerts {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setSettings = useCallback(
    (patch: Partial<OrderAlertSettings>) => updateOrderAlertSettings(patch),
    [],
  );
  const acknowledge = useCallback(() => acknowledgeOrderAlerts(), []);
  return {
    ...snapshot,
    soundAvailable: hasOrderAlertSoundPlayer(),
    vibrationSupported: Platform.OS === 'ios' || Platform.OS === 'android',
    setSettings,
    acknowledge,
  };
}

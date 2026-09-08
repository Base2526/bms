"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { createAlertPlayer, type AlertPlayer } from "@/lib/pos/orderAlertPlayer";
import {
  defaultOrderAlertSettings,
  normalizeOrderAlertSettings,
  toneForKind,
  willSound,
  LEGACY_CHIME_STORAGE_KEY,
  ORDER_ALERT_STORAGE_KEY,
  type AlertKind,
  type AlertToneId,
  type OrderAlertSettings,
} from "@/lib/pos/orderAlertSound";

export type OrderAlertsApi = {
  settings: OrderAlertSettings;
  /** เขียนลงเครื่องทันที — การตั้งค่าเสียงที่ต้องกด "บันทึก" อีกทีคือการตั้งค่าที่คนลืมกด */
  update: (patch: Partial<OrderAlertSettings>) => void;
  /** อ่านค่าจากเครื่องเสร็จหรือยัง — กันไม่ให้เสียงดังด้วยค่าปริยายก่อนรู้ว่าผู้ใช้ปิดไว้ */
  ready: boolean;
  /** ผู้ใช้เปิดเสียงไว้ แต่เบราว์เซอร์ยังไม่ยอมให้ส่งเสียงจนกว่าจะมีคนแตะจอ */
  blocked: boolean;
  /** มีงานเข้า — ตัวนี้ตัดสินเองว่าเหตุการณ์นี้ควรดังไหม */
  notify: (kind: AlertKind) => void;
  /** ฟังตัวอย่าง (ต้องเรียกจากการแตะของคน) */
  preview: (tone: AlertToneId) => void;
  unlock: () => void;
};

/**
 * ผูก "การตั้งค่าเสียงของเครื่องนี้" เข้ากับตัวเล่นเสียงจริง
 *
 * ⚠️ **สถานะอยู่ที่ระดับโมดูล ไม่ใช่ใน component** — หน้าเดียวมี consumer ได้มากกว่าหนึ่งตัว
 * (`/pos` เรียกเอง แล้วยังเรนเดอร์ `RestaurantRequestQueue` ซึ่งเรียกอีกตัว) ถ้าต่างคนต่างถือ
 * state ของตัวเองจะได้สองอย่างที่ผิดพร้อมกัน:
 *   1. **AudioContext สองตัวต่อหน้า** ซึ่งเป็นทรัพยากรของเครื่องเสียง ไม่ใช่ตัวแปรธรรมดา
 *   2. **การตั้งค่าเขียนทับกันด้วยค่าที่ค้าง** — ปรับความดังที่แผงหนึ่ง แล้วไปกดปิดเสียงที่อีกแผง
 *      แผงที่สองจะ merge patch เข้ากับ settings ชุดเก่าที่มันถืออยู่ แล้วความดังเด้งกลับเงียบ ๆ
 *
 * ⚠️ เก็บที่ localStorage ของเครื่อง ไม่ใช่ที่ฐานข้อมูล — โดยตั้งใจ:
 * ความดังที่เหมาะกับจอครัวเหนือเตากับแท็บเล็ตแคชเชียร์ไม่เท่ากัน และคนที่ปรับคือคนที่
 * **ยืนอยู่หน้าเครื่องนั้น** · การเก็บระดับร้านจะทำให้การหรี่เสียงที่เคาน์เตอร์ไปปิดเสียงครัว
 *
 * ผลที่ยอมรับไว้: ล้าง site data แล้วค่ากลับเป็นค่าปริยาย (ซึ่ง "เปิดเสียง" จึงไม่ใช่การเงียบ)
 * และผู้จัดการยังตรวจจากหลังบ้านไม่ได้ว่าจอครัวสาขาไหนปิดเสียงอยู่ — ถ้าวันหนึ่งต้องการ
 * ให้ย้ายเฉพาะ `readStored`/`writeStored` ไปอ่าน/เขียนผ่าน API จุดเรียกไม่ต้องแก้
 */
type Snapshot = { settings: OrderAlertSettings; ready: boolean; blocked: boolean };

const INITIAL: Snapshot = { settings: defaultOrderAlertSettings(), ready: false, blocked: false };
let snapshot: Snapshot = INITIAL;
const listeners = new Set<() => void>();
let player: AlertPlayer | null = null;
let detachGestures: (() => void) | null = null;
let activeConsumers = 0;

function publish(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const getSnapshot = () => snapshot;
// ต้องคืน object เดิมทุกครั้งตอน SSR ไม่งั้น React จะวนเรนเดอร์ไม่จบ
const getServerSnapshot = () => INITIAL;

function readStored(): OrderAlertSettings {
  try {
    const raw = window.localStorage.getItem(ORDER_ALERT_STORAGE_KEY);
    const legacyRaw = window.localStorage.getItem(LEGACY_CHIME_STORAGE_KEY);
    // ร้านที่เคยกดปิดเสียงไว้ตั้งแต่ 9.53 ต้องไม่เจอเสียงเด้งขึ้นมาเองหลังอัปเดต
    const legacy = legacyRaw === null ? null : legacyRaw === "1";
    return normalizeOrderAlertSettings(raw ? JSON.parse(raw) : null, legacy);
  } catch {
    // โหมดส่วนตัว / JSON เสีย — ค่าปริยายใช้ได้ ไม่ใช่เหตุให้จอเงียบ
    return defaultOrderAlertSettings();
  }
}

function writeStored(next: OrderAlertSettings) {
  try {
    window.localStorage.setItem(ORDER_ALERT_STORAGE_KEY, JSON.stringify(next));
    // เขียนคีย์เก่าคู่ไปด้วย เผื่อเครื่องเดียวกันถูก downgrade กลับไปเวอร์ชันก่อนหน้า
    window.localStorage.setItem(LEGACY_CHIME_STORAGE_KEY, next.enabled ? "1" : "0");
  } catch { /* โหมดส่วนตัว */ }
}

async function attemptUnlock(): Promise<boolean> {
  if (!player) return false;
  const ok = await player.unlock();
  publish({ blocked: !ok && snapshot.settings.enabled });
  if (ok && detachGestures) { detachGestures(); detachGestures = null; }
  return ok;
}

/**
 * เปิดใช้งานครั้งแรกเมื่อมีจอที่ต้องใช้เสียงจริง — จอค้าปลีกของร้านที่ไม่ใช่ร้านอาหาร
 * ไม่ควรไปแตะเครื่องเสียงของแท็บเล็ตเลยแม้แต่ครั้งเดียว
 *
 * ไม่มีการคืนทรัพยากรโดยตั้งใจ: ตัวเล่นเสียงมีอายุเท่าหน้าเว็บ การ dispose ตอน consumer
 * ตัวสุดท้าย unmount จะทำให้การสลับจอ (ซึ่งเกิดตลอดเวลา) ปลดล็อกเสียงใหม่ทุกครั้ง
 */
function activate() {
  if (player) return;
  player = createAlertPlayer();
  publish({ settings: readStored(), ready: true });
  // เสียงถูกบล็อกจนกว่าจะมีคนแตะจอ — ดักการแตะ "ครั้งไหนก็ได้" ของหน้านี้ ไม่ใช่แค่ตอนกด
  // ปุ่มลำโพง เพราะครัวแตะจอตลอดเวลาอยู่แล้ว และปุ่มลำโพงคือปุ่มที่ไม่มีใครกด
  const onGesture = () => { void attemptUnlock(); };
  document.addEventListener("pointerdown", onGesture);
  document.addEventListener("keydown", onGesture);
  detachGestures = () => {
    document.removeEventListener("pointerdown", onGesture);
    document.removeEventListener("keydown", onGesture);
  };
  // ลองครั้งแรกโดยไม่มี gesture — สำเร็จได้บนเครื่องที่ผู้ใช้เคยโต้ตอบกับโดเมนนี้แล้ว
  void attemptUnlock();
}

function updateSettings(patch: Partial<OrderAlertSettings>) {
  const next = normalizeOrderAlertSettings({ ...snapshot.settings, ...patch });
  writeStored(next);
  publish({ settings: next, blocked: next.enabled ? snapshot.blocked : false });
}

function notify(kind: AlertKind) {
  if (!player || !willSound(snapshot.settings, kind)) return;
  const played = player.play(toneForKind(snapshot.settings, kind), snapshot.settings.volume);
  // ดังไม่ออกทั้งที่ผู้ใช้เปิดไว้ = ต้องบอก ไม่ใช่ปล่อยให้เข้าใจว่าไม่มีออร์เดอร์เข้า
  if (!played) publish({ blocked: true });
}

function preview(tone: AlertToneId) {
  if (!player) return;
  const current = player;
  void attemptUnlock().then((ok) => { if (ok) current.play(tone, snapshot.settings.volume); });
}

export function useOrderAlerts(active = true): OrderAlertsApi {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!active) return;
    activeConsumers += 1;
    if (activeConsumers === 1) activate();
    return () => { activeConsumers -= 1; };
  }, [active]);

  const unlock = useCallback(() => { void attemptUnlock(); }, []);

  return useMemo(
    () => ({ ...state, update: updateSettings, notify, preview, unlock }),
    [state, unlock]
  );
}

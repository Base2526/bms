"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * ⚠️ เก็บที่ localStorage ของเครื่อง ไม่ใช่ที่ฐานข้อมูล — โดยตั้งใจ:
 * ความดังที่เหมาะกับจอครัวเหนือเตากับแท็บเล็ตแคชเชียร์ไม่เท่ากัน และคนที่ปรับคือคนที่
 * **ยืนอยู่หน้าเครื่องนั้น** · การเก็บระดับร้านจะทำให้การหรี่เสียงที่เคาน์เตอร์ไปปิดเสียงครัว
 *
 * ผลที่ยอมรับไว้: ล้าง site data แล้วค่ากลับเป็นค่าปริยาย (ซึ่ง "เปิดเสียง" จึงไม่ใช่การเงียบ)
 * และผู้จัดการยังตรวจจากหลังบ้านไม่ได้ว่าจอครัวสาขาไหนปิดเสียงอยู่ — ถ้าวันหนึ่งต้องการ
 * ให้ย้ายเฉพาะสองฟังก์ชัน `readStored`/`writeStored` ไปอ่าน/เขียนผ่าน API จุดเรียกไม่ต้องแก้
 */
export function useOrderAlerts(): OrderAlertsApi {
  const [settings, setSettings] = useState<OrderAlertSettings>(() => defaultOrderAlertSettings());
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const playerRef = useRef<AlertPlayer | null>(null);
  // ค่าปัจจุบันสำหรับ callback ที่ถูกผูกไว้ตั้งแต่ตอน mount (listener ระดับ document)
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const player = createAlertPlayer();
    playerRef.current = player;
    return () => { playerRef.current = null; player.dispose(); };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ORDER_ALERT_STORAGE_KEY);
      const legacyRaw = window.localStorage.getItem(LEGACY_CHIME_STORAGE_KEY);
      // ร้านที่เคยกดปิดเสียงไว้ตั้งแต่ 9.53 ต้องไม่เจอเสียงเด้งขึ้นมาเองหลังอัปเดต
      const legacy = legacyRaw === null ? null : legacyRaw === "1";
      setSettings(normalizeOrderAlertSettings(raw ? JSON.parse(raw) : null, legacy));
    } catch {
      // โหมดส่วนตัว / JSON เสีย — ค่าปริยายใช้ได้ ไม่ใช่เหตุให้จอเงียบ
      setSettings(defaultOrderAlertSettings());
    } finally {
      setReady(true);
    }
  }, []);

  // เสียงถูกบล็อกจนกว่าจะมีคนแตะจอ — ดักการแตะ "ครั้งไหนก็ได้" ของหน้านี้ ไม่ใช่แค่ตอนกด
  // ปุ่มลำโพง เพราะครัวแตะจอตลอดเวลาอยู่แล้ว และปุ่มลำโพงคือปุ่มที่ไม่มีใครกด
  useEffect(() => {
    if (!ready) return;
    let done = false;
    const attempt = async () => {
      const player = playerRef.current;
      if (!player) return;
      const ok = await player.unlock();
      setBlocked(!ok && settingsRef.current.enabled);
      if (ok) {
        done = true;
        detach();
      }
    };
    const onGesture = () => { if (!done) void attempt(); };
    const detach = () => {
      document.removeEventListener("pointerdown", onGesture);
      document.removeEventListener("keydown", onGesture);
    };
    document.addEventListener("pointerdown", onGesture);
    document.addEventListener("keydown", onGesture);
    // ลองครั้งแรกโดยไม่มี gesture — สำเร็จได้บนเครื่องที่ผู้ใช้เคยโต้ตอบกับโดเมนนี้แล้ว
    void attempt();
    return detach;
  }, [ready]);

  const update = useCallback((patch: Partial<OrderAlertSettings>) => {
    setSettings((current) => {
      const next = normalizeOrderAlertSettings({ ...current, ...patch });
      try {
        window.localStorage.setItem(ORDER_ALERT_STORAGE_KEY, JSON.stringify(next));
        // เขียนคีย์เก่าคู่ไปด้วย เผื่อเครื่องเดียวกันถูก downgrade กลับไปเวอร์ชันก่อนหน้า
        window.localStorage.setItem(LEGACY_CHIME_STORAGE_KEY, next.enabled ? "1" : "0");
      } catch { /* โหมดส่วนตัว */ }
      if (!next.enabled) setBlocked(false);
      return next;
    });
  }, []);

  const notify = useCallback((kind: AlertKind) => {
    const player = playerRef.current;
    if (!player) return;
    const current = settingsRef.current;
    if (!willSound(current, kind)) return;
    const played = player.play(toneForKind(current, kind), current.volume);
    // ดังไม่ออกทั้งที่ผู้ใช้เปิดไว้ = ต้องบอก ไม่ใช่ปล่อยให้เข้าใจว่าไม่มีออร์เดอร์เข้า
    if (!played) setBlocked(true);
  }, []);

  const preview = useCallback((tone: AlertToneId) => {
    const player = playerRef.current;
    if (!player) return;
    void player.unlock().then((ok) => {
      setBlocked(!ok && settingsRef.current.enabled);
      if (ok) player.play(tone, settingsRef.current.volume);
    });
  }, []);

  const unlock = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    void player.unlock().then((ok) => setBlocked(!ok && settingsRef.current.enabled));
  }, []);

  return useMemo(
    () => ({ settings, update, ready, blocked, notify, preview, unlock }),
    [settings, update, ready, blocked, notify, preview, unlock]
  );
}

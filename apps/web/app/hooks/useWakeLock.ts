"use client";

import { useEffect, useState } from "react";

/**
 * กันจอครัวดับระหว่างกะ (Screen Wake Lock API)
 *
 * ⚠️ นี่คือการแก้ที่ **ต้นเหตุ** ของอาการ "ออร์เดอร์เด้งช้า 3-5 นาที" ไม่ใช่แค่บรรเทา:
 * แท็บเล็ตที่จอดับทำให้เบราว์เซอร์หรี่ timer (Chrome เหลือ ~1 ครั้ง/นาทีเมื่อซ่อนครบ 5 นาที
 * และ Android อาจ freeze ทั้งหน้า) · จอที่ไม่ดับเลยจึงไม่เคยเข้าโหมดนั้นตั้งแต่แรก
 *
 * ขอเฉพาะตอนอยู่จอครัวจริง ๆ ไม่ใช่ทั้งแอป — การกินแบตของแท็บเล็ตแคชเชียร์ที่วางอยู่เฉย ๆ
 * ไม่ได้แลกอะไรกลับมา
 *
 * เบราว์เซอร์ที่ไม่รองรับ (Safari เก่า, WebView บางตัว) ตกกลับไปเป็นพฤติกรรมเดิมเงียบ ๆ —
 * `supported` มีไว้ให้หน้าจอบอกผู้ใช้ว่าต้องไปตั้งเวลาจอดับใน OS เอง
 */
export type WakeLockState = {
  supported: boolean;
  /** ถืออยู่จริงหรือไม่ ณ ตอนนี้ (หลุดเองได้เมื่อผู้ใช้สลับแอป) */
  active: boolean;
};

type WakeLockSentinelLike = { released: boolean; release: () => Promise<void>; addEventListener: (type: string, listener: () => void) => void };

export function useWakeLock(want: boolean): WakeLockState {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const api = (navigator as unknown as { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
    setSupported(Boolean(api));
    if (!api || !want) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      try {
        sentinel = await api.request("screen");
        if (cancelled) { void sentinel.release().catch(() => {}); return; }
        setActive(true);
        // OS ปล่อย lock เองเมื่อผู้ใช้สลับแอป — ต้องรู้ตัวเพื่อขอใหม่ตอนกลับมา
        sentinel.addEventListener("release", () => setActive(false));
      } catch {
        // ผู้ใช้/นโยบายเครื่องปฏิเสธได้ ซึ่งไม่ใช่เหตุให้จอครัวพัง
        setActive(false);
      }
    };

    // สลับแอปแล้วกลับมา lock เดิมหายไปแล้ว ต้องขอใหม่ ไม่งั้นได้ผลแค่ครั้งแรกครั้งเดียว
    const onVisible = () => { if (document.visibilityState === "visible") void acquire(); };
    document.addEventListener("visibilitychange", onVisible);
    void acquire();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      setActive(false);
      const held = sentinel;
      sentinel = null;
      if (held && !held.released) void held.release().catch(() => {});
    };
  }, [want]);

  return { supported, active };
}

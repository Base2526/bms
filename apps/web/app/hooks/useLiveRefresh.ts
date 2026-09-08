"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * poll ที่รู้ว่าตัวเองถูกมองอยู่หรือเปล่า
 *
 * ⚠️ ทำไมต้องมีไฟล์นี้ — `setInterval` เปล่า ๆ ไม่พอสำหรับจอหน้าร้าน:
 *
 * 1. **เบราว์เซอร์หรี่ timer ของแท็บที่ถูกซ่อน** Chrome หน่วง timer ของหน้าที่ไม่ได้แสดงผล
 *    และเมื่อซ่อนครบ ~5 นาทีจะเข้า intensive throttling = เดินได้ราว 1 ครั้ง/นาที ·
 *    Android ยัง freeze ทั้งหน้าเมื่อจอดับ ส่วน iOS Safari หยุด timer ไปเลย
 *    → นี่คือที่มาของอาการ "ส่งครัวแล้วรอ 3-5 นาทีกว่าจะเด้ง" ที่รายงานมาจากหน้าร้าน
 * 2. **กลับมามองแล้วต้องเห็นของจริงทันที** ของเดิมไม่มี `visibilitychange` handler เลย
 *    ครัวหยิบแท็บเล็ตขึ้นมาแล้วยังต้องรอ tick ถัดไป ซึ่งเป็นรอบที่เพิ่งถูกหรี่มา
 * 3. **เน็ตร้านหลุดแล้วกลับมา** ต้องโหลดทันที ไม่ใช่รอรอบถัดไป
 *
 * ตัวรอบเวลาไม่ได้อยู่ที่นี่โดยตั้งใจ — ผู้เรียกส่ง `intervalMs` มาเอง เพราะ "จอไหนควรไวแค่ไหน"
 * เป็นการตัดสินใจของหน้านั้น ไม่ใช่ของ hook
 */
export type LiveRefreshOptions = {
  /** ปิดไว้ตอนยังไม่มี token / ยังไม่เปิดกะ — hook จะไม่ยิงอะไรเลย */
  enabled: boolean;
  intervalMs: number;
  onRefresh: () => Promise<unknown>;
};

export type LiveRefreshState = {
  /** เวลาที่โหลดสำเร็จครั้งล่าสุด — ป้าย "อัปเดตล่าสุด" ต้องอ่านจากค่านี้เท่านั้น */
  lastOkAt: number | null;
  lastErrorAt: number | null;
  refreshNow: () => void;
};

export function useLiveRefresh(options: LiveRefreshOptions): LiveRefreshState {
  const { enabled, intervalMs } = options;
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [lastErrorAt, setLastErrorAt] = useState<number | null>(null);
  // ผู้เรียกส่ง arrow function ใหม่ทุก render (หน้าพวกนี้ประกาศ loader ไว้ในตัว component)
  // ถ้าใส่ลง deps ตรง ๆ interval จะถูกสร้างใหม่ทุก render แล้วไม่มีรอบไหนได้ครบเวลาเลย
  const callbackRef = useRef(options.onRefresh);
  callbackRef.current = options.onRefresh;
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async () => {
    // รอบที่ยิงซ้อนกันไม่ได้ทำให้เร็วขึ้น มีแต่ทำให้เครื่องเก่าหน้าร้านค้าง —
    // และคำตอบที่กลับมาไม่เรียงลำดับจะเขียนทับกันเองแบบสุ่ม
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await callbackRef.current();
      if (mounted.current) setLastOkAt(Date.now());
    } catch {
      // ผู้เรียกเป็นคนตัดสินว่าจะโชว์ error ยังไง — ที่นี่สนใจแค่ "รอบนี้ไม่สำเร็จ"
      if (mounted.current) setLastErrorAt(Date.now());
    } finally {
      inFlight.current = false;
    }
  }, []);

  const refreshNow = useCallback(() => { void run(); }, [run]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => { void run(); }, Math.max(1000, intervalMs));
    const wake = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void run();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
    };
  }, [enabled, intervalMs, run]);

  return { lastOkAt, lastErrorAt, refreshNow };
}

/**
 * "จอนี้กำลังถูกมองอยู่ไหม" — ใช้เลือกรอบ poll และใช้ตัดสินว่าควรขอ wake lock ไหม
 * แยกออกมาเพราะสามหน้าจอต้องการคำตอบเดียวกัน และการเขียน listener ซ้ำสามที่คือทางที่
 * วันหนึ่งจะมีที่หนึ่งลืมถอด listener ทิ้ง
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const sync = () => setVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return visible;
}

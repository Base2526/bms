"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * poll ที่รู้ว่าตัวเองถูกมองอยู่ไหม และไม่ปล่อยให้คำขอทับกันเอง
 *
 * ⚠️ ทำไมต้องมีไฟล์นี้ — `setInterval` เปล่า ๆ ไม่พอสำหรับจอหน้าร้าน มีสามเรื่องคนละเรื่อง:
 *
 * 1. **เบราว์เซอร์หรี่ timer ของแท็บที่ถูกซ่อน** Chrome หน่วง timer ของหน้าที่ไม่ได้แสดงผล
 *    และเมื่อซ่อนครบ ~5 นาทีจะเข้า intensive throttling = เดินได้ราว 1 ครั้ง/นาที ·
 *    Android ยัง freeze ทั้งหน้าเมื่อจอดับ ส่วน iOS Safari หยุด timer ไปเลย
 * 2. **กลับมามองแล้วต้องเห็นของจริงทันที** และ **เน็ตร้านหลุดแล้วกลับมาก็ต้องโหลดทันที**
 *    ไม่ใช่รอรอบถัดไป (ซึ่งเป็นรอบที่เพิ่งถูกหรี่มา)
 * 3. **คำขอทับกันเองคือสาเหตุที่จอช้าเป็นนาทีทั้งที่จอเปิดค้างอยู่** — รอบเดิมยิงทุก 5 วินาที
 *    โดยไม่สนว่ารอบก่อนตอบหรือยัง · พอ query ฝั่ง server ช้ากว่า 5 วินาที (จอครัวอ่านตั๋ว
 *    ทั้งประวัติก่อน `9.68`) คำขอจะกองสะสม ชน **เพดาน 6 connection ต่อโดเมนของเบราว์เซอร์**
 *    แล้วคำตอบใหม่สุดต้องรอคิวยาวขึ้นเรื่อย ๆ จนกลายเป็นหลายนาที · เน็ตร้านที่ค้างครึ่งทาง
 *    ยิ่งแย่กว่า เพราะ `fetch` ไม่มี timeout ในตัวเลย คำขอที่ค้างจะกินคิวไว้จน TCP ยอมแพ้เอง
 *
 * ตัวรอบเวลาไม่ได้อยู่ที่นี่โดยตั้งใจ — ผู้เรียกส่ง `intervalMs` มาเอง เพราะ "จอไหนควรไวแค่ไหน"
 * เป็นการตัดสินใจของหน้านั้น ไม่ใช่ของ hook
 */
export type LiveRefreshOptions = {
  /** ปิดไว้ตอนยังไม่มี token / ยังไม่เปิดกะ — hook จะไม่ยิงอะไรเลย */
  enabled: boolean;
  intervalMs: number;
  /**
   * ผู้เรียกต้องส่ง `signal` ต่อให้ `fetch` — คำขอที่ยกเลิกไม่ได้จะยังกินคิวของเบราว์เซอร์
   * ต่อไปแม้เราเลิกรอคำตอบแล้ว ซึ่งเป็นครึ่งหนึ่งของปัญหาที่ timeout นี้มีไว้แก้
   */
  onRefresh: (signal: AbortSignal) => Promise<unknown>;
  /**
   * คำตอบที่มาช้ากว่านี้ไม่มีประโยชน์กับจอหน้าร้านแล้ว — และการรอต่อไปแปลว่ารอบถัดไป
   * ก็จะไม่ได้เริ่มด้วย (ด่านกันรอบซ้อน) = จอค้างเงียบ ๆ ตลอดกาล
   */
  timeoutMs?: number;
};

export type LiveRefreshState = {
  /** เวลาที่โหลดสำเร็จครั้งล่าสุด — ป้าย "อัปเดตล่าสุด" ต้องอ่านจากค่านี้เท่านั้น */
  lastOkAt: number | null;
  lastErrorAt: number | null;
  refreshNow: () => void;
};

const DEFAULT_TIMEOUT_MS = 10_000;

export function useLiveRefresh(options: LiveRefreshOptions): LiveRefreshState {
  const { enabled, intervalMs } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [lastErrorAt, setLastErrorAt] = useState<number | null>(null);
  // ผู้เรียกส่ง arrow function ใหม่ทุก render (หน้าพวกนี้ประกาศ loader ไว้ในตัว component)
  // ถ้าใส่ลง deps ตรง ๆ interval จะถูกสร้างใหม่ทุก render แล้วไม่มีรอบไหนได้ครบเวลาเลย
  const callbackRef = useRef(options.onRefresh);
  callbackRef.current = options.onRefresh;
  const inFlight = useRef(false);
  const lastRunAt = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async () => {
    // รอบที่ยิงซ้อนกันไม่ได้ทำให้เร็วขึ้น มีแต่ทำให้คำขอกองจนคำตอบใหม่สุดมาช้าเป็นนาที
    if (inFlight.current) return;
    inFlight.current = true;
    lastRunAt.current = Date.now();
    const controller = new AbortController();
    let watchdog: number | undefined;
    try {
      const timedOut = new Promise<"timeout">((resolve) => {
        watchdog = window.setTimeout(() => { controller.abort(); resolve("timeout"); }, timeoutMs);
      });
      // ⚠️ ต้อง race ไม่ใช่แค่ abort — ผู้เรียกที่ไม่ได้ส่ง signal ต่อให้ fetch จะค้างต่อไป
      // แล้วด่านกันรอบซ้อนจะไม่มีวันถูกปลด = จอหยุดอัปเดตถาวรโดยไม่มีอะไรบอก
      const outcome = await Promise.race([
        callbackRef.current(controller.signal).then(() => "ok" as const, () => "error" as const),
        timedOut,
      ]);
      if (!mounted.current) return;
      if (outcome === "ok") setLastOkAt(Date.now());
      else setLastErrorAt(Date.now());
    } finally {
      if (watchdog !== undefined) window.clearTimeout(watchdog);
      inFlight.current = false;
    }
  }, [timeoutMs]);

  const refreshNow = useCallback(() => { void run(); }, [run]);

  useEffect(() => {
    if (!enabled) return;
    // ⚠️ ต้องยิงทันทีตอน effect เริ่ม ด้วยสองเหตุผลคนละเรื่อง:
    //
    // 1. **ป้ายสถานะจะโกหกตอนเปิดจอ** — `lastOkAt` เริ่มเป็น null ซึ่ง feedHealth ตีเป็น
    //    STALE โดยตั้งใจ (ตรวจไม่ได้ ≠ ไม่มีปัญหา) แต่กระดานมีข้อมูลอยู่แล้วจากการโหลด
    //    ครั้งแรกของหน้า → จอขึ้น "ขาดการเชื่อมต่อ" สีแดงคู่กับตั๋วที่แสดงอยู่เต็มจอ
    //    ซึ่งเป็นอาการ "จอเดียวกันขัดกันเอง" ที่ทำให้คนเลิกเชื่อตัวเลขทั้งจอ
    // 2. **รอบจะอดตายถ้าคนสลับจอถี่กว่ารอบ** — `intervalMs` เปลี่ยนตามจอที่เปิดอยู่และ
    //    ตาม visibility ทุกครั้งที่เปลี่ยน interval ถูกตั้งใหม่ตั้งแต่ศูนย์ · สลับแท็บทุก 4
    //    วินาทีบนรอบ 5 วินาที = ไม่มีรอบไหนได้ยิงเลยสักครั้ง
    //
    // แต่ยิงทุกครั้งที่ effect เริ่มก็ไม่ได้ — สลับแท็บหนึ่งครั้งจะยิงพร้อมกันทุก feed
    // จึงยิงต่อเมื่อรอบก่อนห่างพอแล้วจริง ๆ
    const since = lastRunAt.current === null ? Infinity : Date.now() - lastRunAt.current;
    if (since >= intervalMs) void run();
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

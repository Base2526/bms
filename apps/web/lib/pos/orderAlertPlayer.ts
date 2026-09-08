/**
 * ตัวเล่นเสียงเตือนของจอหน้าร้าน — ส่วนที่แตะ WebAudio จริง
 *
 * กติกาทั้งหมด (เลือกเสียงไหน ย้ำเมื่อไร) อยู่ใน `orderAlertSound.ts` ซึ่งเป็น pure
 * ไฟล์นี้ทำอย่างเดียวคือ "ทำให้ดัง" และ "บอกว่าดังไม่ได้เพราะอะไร"
 *
 * ⚠️ บั๊กที่ไฟล์นี้มีไว้แก้: ของเดิมสร้าง `AudioContext` ครั้งแรกจากใน `setInterval`
 * ซึ่งไม่ใช่ user gesture → เบราว์เซอร์ให้ context ที่สถานะ `suspended` แล้ว `resume()`
 * จากที่นั่นก็ไม่ผ่าน · ผลคือหลังรีเฟรชหน้า/แท็บเล็ตรีบูต ปุ่มโชว์ว่า "เปิดเสียงอยู่"
 * แต่เงียบสนิทจนกว่าจะมีคนแตะจอ **โดยไม่มีอะไรบอกเลยว่าเงียบ**
 * ตอนนี้จึงมี `blocked` ให้จอเอาไปขึ้นแถบ "แตะเพื่อเปิดเสียง" ได้
 */

import { findAlertTone, type AlertToneId } from "./orderAlertSound";

export type AlertPlayer = {
  /** เล่นเสียงหนึ่งครั้ง — คืน false เมื่อเบราว์เซอร์ยังไม่ยอมให้ส่งเสียง */
  play: (tone: AlertToneId, volume: number) => boolean;
  /** เรียกจากการแตะของคนเท่านั้น — เป็นทั้งการปลดล็อกและการทดสอบลำโพง */
  unlock: () => Promise<boolean>;
  /** true = ผู้ใช้เปิดเสียงไว้แต่เบราว์เซอร์ยังบล็อกอยู่ (ต้องมีคนแตะจอก่อน) */
  isBlocked: () => boolean;
  dispose: () => void;
};

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

export function createAlertPlayer(): AlertPlayer {
  let ctx: AudioContext | null = null;
  let blocked = false;
  let disposed = false;

  function ensureContext(): AudioContext | null {
    if (disposed) return null;
    if (ctx) return ctx;
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      return ctx;
    } catch {
      // จอที่เล่นเสียงไม่ได้ต้องไม่ทำให้คิวครัวพัง — เงียบดีกว่าจอขาว
      return null;
    }
  }

  function emit(tone: AlertToneId, volume: number, context: AudioContext): void {
    const steps = findAlertTone(tone).steps;
    const master = Math.min(1, Math.max(0, volume));
    for (const step of steps) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.frequency.value = step.hz;
      osc.type = step.type;
      const at = context.currentTime + step.atMs / 1000;
      const peak = Math.max(0.0002, step.gain * master);
      // exponentialRamp ห้ามผ่านค่า 0 — เริ่มจากค่าที่เกือบศูนย์แทน
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + step.durationMs / 1000);
      osc.connect(gain).connect(context.destination);
      osc.start(at);
      osc.stop(at + step.durationMs / 1000 + 0.03);
    }
  }

  return {
    play(tone, volume) {
      if (disposed || tone === "NONE") return false;
      const context = ensureContext();
      if (!context) return false;
      if (context.state === "suspended") {
        // ขอ resume ไว้เผื่อหน้านี้เคยถูกแตะแล้ว แต่ **ไม่ถือว่าดังสำเร็จ** — การรายงานว่า
        // ดังแล้วทั้งที่เงียบคือสิ่งที่ทำให้บั๊กเดิมอยู่ได้นานโดยไม่มีใครเห็น
        blocked = true;
        void context.resume().then(() => { blocked = context.state !== "running"; }).catch(() => {});
        return false;
      }
      blocked = false;
      try {
        emit(tone, volume, context);
        return true;
      } catch {
        return false;
      }
    },
    async unlock() {
      if (disposed) return false;
      const context = ensureContext();
      if (!context) return false;
      try {
        if (context.state === "suspended") await context.resume();
      } catch {
        // ปฏิเสธมาก็ยังไม่ใช่เหตุให้จอพัง — แค่ยังบล็อกอยู่
      }
      blocked = context.state !== "running";
      return !blocked;
    },
    isBlocked() {
      return blocked;
    },
    dispose() {
      disposed = true;
      const closing = ctx;
      ctx = null;
      try { void closing?.close(); } catch { /* บางเบราว์เซอร์ปิดซ้ำแล้ว throw */ }
    },
  };
}

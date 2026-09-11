import type { OrderAlertKind } from './orderAlert';

/**
 * จุดเสียบ "เสียงจริง" ของการแจ้งเตือน
 *
 * ⚠️ React Native ไม่มี API เสียงในตัว (ต่างจากเบราว์เซอร์ที่มี WebAudio) การเล่นเสียงต้องมี
 * native module ซึ่งต้อง `pod install` + build ใหม่ทั้ง iOS/Android
 *
 * เครื่องที่เขียนโค้ดนี้ build native ไม่ได้ (ไม่มี Xcode/Android SDK/Java) จึง **ไม่ใส่ dependency
 * ที่คอมไพล์เองไม่ได้ลง package.json** — การเพิ่มโมดูลที่ไม่เคยคอมไพล์แปลว่าทุกคนในทีม build ไม่ผ่าน
 * และการบอกว่า "มีเสียงแล้ว" ทั้งที่ไม่เคยได้ยิน คือบั๊กแบบเดียวกับที่ฝั่งเว็บโดนมา
 * (ปุ่มโชว์ว่าเปิดเสียงอยู่ แต่เงียบสนิทเพราะ AudioContext ถูกบล็อก — อยู่ได้เป็นเดือน)
 *
 * แทนที่จะเดา จึงเปิดเป็น "รู" ไว้ที่เดียว: ติดตั้งโมดูลเสียงเมื่อไร แล้วเรียก
 * `registerOrderAlertSoundPlayer()` หนึ่งครั้งตอนบูตแอป เสียงจะทำงานทันทีโดยไม่ต้องแก้โค้ดที่อื่นเลย
 * ดูตัวอย่างใน README หัวข้อ "เปิดเสียงแจ้งเตือนจริง"
 *
 * สัญญาของ `play()` — **ต้องคืน `false` เมื่อไม่ได้ดังจริง** ห้ามคืน true ลอย ๆ
 * ตัวเรียกใช้ค่านี้ตัดสินใจว่าจะขึ้นแถบเตือนบนจอแทนหรือไม่
 */
export interface OrderAlertSoundPlayer {
  play: (kind: OrderAlertKind) => boolean;
}

let player: OrderAlertSoundPlayer | null = null;

export function registerOrderAlertSoundPlayer(
  next: OrderAlertSoundPlayer | null,
): void {
  player = next;
}

export function hasOrderAlertSoundPlayer(): boolean {
  return player !== null;
}

/** คืน true เฉพาะตอนที่มีตัวเล่นเสียงและมันบอกว่าดังจริง */
export function playOrderAlertSound(kind: OrderAlertKind): boolean {
  if (!player) return false;
  try {
    return player.play(kind) === true;
  } catch {
    // เสียงล้มต้องไม่ล้มการแจ้งเตือนทั้งก้อน — ช่องทางอื่น (สั่น/แถบบนจอ) ยังต้องทำงานต่อ
    return false;
  }
}

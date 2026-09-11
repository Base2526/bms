import { Platform } from 'react-native';
import Sound from 'react-native-sound';
import type { OrderAlertKind } from './orderAlert';
import {
  registerOrderAlertSoundPlayer,
  type OrderAlertSoundPlayer,
} from './orderAlertSound';

/**
 * ตัวเล่นเสียงแจ้งเตือนจริง (react-native-sound)
 *
 * ⚠️ ต้อง build native ใหม่หลังติดตั้ง — `cd ios && pod install` แล้ว `npm run ios` /
 * `npm run android` · **โหลด JS ใหม่บน binary เก่าจะไม่มีเสียง** เพราะ native module ยังไม่อยู่ในเครื่อง
 * (ตอนนั้น `Sound` เป็น undefined แล้วโค้ดนี้จะรายงานว่าเล่นไม่ได้ ซึ่งถูกแล้ว)
 *
 * ⚠️ ชื่อไฟล์ต่างกันสองแพลตฟอร์ม — กับดักที่ทำให้ Android เงียบสนิทโดยไม่มี error:
 * Android อ่านจาก `res/raw` ผ่าน `getIdentifier(name, "raw", pkg)` ซึ่งใช้ **ชื่อที่ไม่มีนามสกุล**
 * ส่วน iOS หาไฟล์ในบันเดิลด้วยชื่อเต็มรวมนามสกุล
 *
 * ไฟล์เสียงสร้างจาก `scripts/make-alert-tones.mjs` (แก้เสียงแล้วรันใหม่)
 */
const ASSET: Record<OrderAlertKind, string> = {
  incoming_order: 'order_in',
  kitchen_ticket: 'kitchen',
};

function assetName(kind: OrderAlertKind): string {
  const base = ASSET[kind];
  return Platform.OS === 'android' ? base : `${base}.wav`;
}

type LoadedSound = InstanceType<typeof Sound>;

const loaded = new Map<OrderAlertKind, LoadedSound>();

/**
 * เตรียมเสียงไว้ล่วงหน้า
 *
 * โหลดตอนบูต ไม่ใช่ตอนออร์เดอร์เข้า — การโหลดไฟล์ครั้งแรกกินเวลา ถ้าโหลดตอนต้องเตือนจริง
 * เสียงจะมาช้ากว่าเหตุการณ์ หรือพลาดไปเลยถ้าผู้ใช้สลับหน้าจอทัน
 */
export function setupOrderAlertSound(): void {
  // ไม่มี native module (เช่นรัน JS ใหม่บน binary เก่า หรือใน jest) = ไม่ต้องลงทะเบียนอะไร
  // ปล่อยให้ระบบรายงานว่า "ยังไม่มีโมดูลเสียง" ตามความจริง
  if (!Sound || typeof Sound.setCategory !== 'function') return;

  // Playback = เล่นได้แม้เครื่องอยู่โหมดเงียบบน iOS · เสียงแจ้งออร์เดอร์ต้องดังแม้สวิตช์ปิดเสียง
  // ไม่งั้นแท็บเล็ตที่ใครเผลอเลื่อนสวิตช์จะเงียบทั้งกะโดยไม่มีอะไรบอก
  Sound.setCategory('Playback', false);

  (Object.keys(ASSET) as OrderAlertKind[]).forEach(kind => {
    // ⚠️ ห้ามอ้างถึงตัวแปรที่กำลังประกาศจากใน callback ของ constructor
    // react-native-sound เรียก callback แบบ async จึงดูเหมือนไม่มีปัญหา แต่ถ้าวันไหนมันเรียก
    // แบบ sync (หรือถูก mock ให้ sync) ตัวแปรจะยังอยู่ใน TDZ แล้วพังทั้งการตั้งค่าเสียง
    const instance: LoadedSound = new Sound(
      assetName(kind),
      Sound.MAIN_BUNDLE,
      error => {
        if (error) {
          // โหลดไม่ได้ = เอาออกจากทะเบียน ปล่อยให้ play() รายงานว่าเล่นไม่ได้
          loaded.delete(kind);
          console.warn(
            `[orderAlert] โหลดเสียง ${assetName(kind)} ไม่สำเร็จ`,
            error,
          );
        }
      },
    );
    // เก็บไว้เสมอแล้วให้ `isLoaded()` เป็นด่านจริงตอนเล่น — ครอบทั้ง callback แบบ sync และ async
    // โดยไม่ต้องเดาว่าไลบรารีเรียกแบบไหน · ความดังใช้ค่าปริยาย (1.0) ตามระดับเสียงสื่อของเครื่อง
    loaded.set(kind, instance);
  });

  const player: OrderAlertSoundPlayer = {
    play: kind => {
      const sound = loaded.get(kind);
      // ⚠️ ต้องคืน false เมื่อยังโหลดไม่เสร็จ/โหลดไม่ได้ — การรายงานว่าดังทั้งที่เงียบ
      // คือบั๊กที่ฝั่งเว็บใช้เวลาเป็นเดือนกว่าจะมีคนเจอ
      if (!sound || !sound.isLoaded()) return false;
      // ออร์เดอร์สองใบติดกันต้องได้ยินสองครั้ง — ไม่ใช่ใบที่สองถูกกลืนเพราะใบแรกยังเล่นค้าง
      sound.stop(() => sound.play());
      return true;
    },
  };

  registerOrderAlertSoundPlayer(player);
}

/** ใช้ตอนปิดแอป/เทส — คืนทรัพยากรของเครื่องเสียง */
export function teardownOrderAlertSound(): void {
  loaded.forEach(sound => sound.release());
  loaded.clear();
  registerOrderAlertSoundPlayer(null);
}

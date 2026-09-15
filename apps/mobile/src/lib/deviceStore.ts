import * as Keychain from 'react-native-keychain';
import type { PairingTarget } from './pairing';

// ที่เก็บ "เครื่องนี้เป็นของร้านไหน" — **iOS Keychain / Android Keystore ไม่ใช่ AsyncStorage**
//
// เหตุผลที่ต้องเป็น secure storage ไม่ใช่ที่เก็บธรรมดา:
//   • device token ไม่มีวันหมดอายุ (ตั้งใจ — เครื่องหน้าร้านเปิดค้างทั้งวัน ไม่มี session ของคน)
//     ใครได้ค่านี้ไปคือขายของ/เปิดลิ้นชัก/อ่านยอดของร้านนั้นได้จนกว่าจะมีคนไปออก token ใหม่
//   • ไอแพดพกออกนอกร้านได้ ต่างจากแท็บเล็ตติดผนังที่เว็บ POS ออกแบบไว้ตอนแรก
//   • AsyncStorage เขียนไฟล์ธรรมดาใน sandbox ของแอป — backup/เครื่อง jailbreak อ่านได้
//
// ⚠️ Keychain ของ iOS **อยู่ต่อหลังลบแอป** โดยดีไซน์ของ Apple — เราจึงลบทิ้งเองตอน "เลิกจับคู่"
// เท่านั้น ถ้าวันหนึ่งอยากให้ลบแอป = เลิกจับคู่ ต้องเพิ่ม first-run marker เอง (ยังไม่ได้ทำ)

const SERVICE = 'com.bms.pos.device';

/** ค่าที่อ่านไม่ได้ (Keychain ล้ม/ยังไม่ปลดล็อกเครื่อง) ต่างจาก "ยังไม่เคยจับคู่" — ผู้เรียกต้องแยกสองอย่างนี้ */
export type LoadResult =
  | { status: 'PAIRED'; target: PairingTarget }
  | { status: 'UNPAIRED' }
  | { status: 'UNAVAILABLE'; error: string };

export async function loadPairing(): Promise<LoadResult> {
  try {
    const creds = await Keychain.getGenericPassword({ service: SERVICE });
    if (!creds) return { status: 'UNPAIRED' };
    // username = serverUrl · password = token (Keychain เก็บได้แค่คู่นี้ ไม่ใช่ JSON ก้อนใหญ่)
    const serverUrl = creds.username ?? '';
    const token = creds.password ?? '';
    if (!serverUrl || !token) return { status: 'UNPAIRED' };
    return { status: 'PAIRED', target: { serverUrl, token } };
  } catch (e: any) {
    return { status: 'UNAVAILABLE', error: String(e?.message ?? e) };
  }
}

export async function savePairing(target: PairingTarget): Promise<void> {
  await Keychain.setGenericPassword(target.serverUrl, target.token, {
    service: SERVICE,
    // เข้าถึงได้หลังปลดล็อกเครื่องครั้งแรกหลังบูต — จอ POS ต้องกลับมาทำงานเองได้หลังไฟดับ
    // โดยไม่ต้องมีคนมาปลดล็อกก่อน (`WHEN_UNLOCKED` จะทำให้แอปที่รีสตาร์ทเองอ่านไม่ได้)
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
  });
}

export async function clearPairing(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE });
}

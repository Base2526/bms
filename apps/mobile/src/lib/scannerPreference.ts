import * as Keychain from 'react-native-keychain';

const SERVICE = 'com.bms.pos.scanner-preference.v1';
const USERNAME = 'scanner-input-mode';

export type ScannerInputMode = 'camera' | 'hardware';

let storageLock: Promise<unknown> = Promise.resolve();

export async function loadScannerInputMode(): Promise<ScannerInputMode> {
  try {
    // ถ้าผู้ใช้สลับโหมดแล้วเปิด modal ใหม่ทันที ต้องรอ write ก่อนหน้า ไม่อ่านค่าเก่ากลับมาทับตัวเลือกใหม่
    await storageLock;
    const credentials = await Keychain.getGenericPassword({ service: SERVICE });
    if (!credentials) return 'camera';
    if (credentials.username !== USERNAME) return 'camera';
    return credentials.password === 'hardware' ? 'hardware' : 'camera';
  } catch {
    // preference ไม่ใช่ credential หลัก: Keychain อ่านไม่ได้ต้องกลับพฤติกรรมเดิมแทนการขวางหน้าขาย
    return 'camera';
  }
}

export async function saveScannerInputMode(
  mode: ScannerInputMode,
): Promise<void> {
  const write = storageLock.then(async () => {
    const stored = await Keychain.setGenericPassword(USERNAME, mode, {
      service: SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
    });
    if (!stored) throw new Error('บันทึกโหมดเครื่องสแกนไม่สำเร็จ');
  });
  // write ที่ล้มต้องไม่ทำให้ทุก write/read หลังจากนั้นถูก reject ต่อเป็นลูกโซ่
  storageLock = write.catch(() => undefined);
  return write;
}

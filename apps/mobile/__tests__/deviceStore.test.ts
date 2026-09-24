import * as Keychain from 'react-native-keychain';
import { clearPairing, savePairing } from '../src/lib/deviceStore';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

const target = {
  serverUrl: 'https://shop.example.com',
  token: `pos_${'a'.repeat(32)}`,
};

describe('device secure pairing store', () => {
  beforeEach(() => jest.clearAllMocks());

  test('does not report pairing success when secure storage declines the write', async () => {
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(false);

    await expect(savePairing(target)).rejects.toThrow(
      'บันทึกข้อมูลจับคู่ลงที่เก็บข้อมูลปลอดภัยไม่สำเร็จ',
    );
  });

  test('does not report unpair success when secure storage declines removal', async () => {
    (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(false);

    await expect(clearPairing()).rejects.toThrow(
      'ลบข้อมูลจับคู่จากที่เก็บข้อมูลปลอดภัยไม่สำเร็จ',
    );
  });
});

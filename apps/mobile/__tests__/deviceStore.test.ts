import * as Keychain from 'react-native-keychain';
import { clearPairing, loadPairing, savePairing } from '../src/lib/deviceStore';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

const target = {
  serverUrl: 'https://shop.example.com',
  token: `pos_${'a'.repeat(32)}`,
};

describe('device secure pairing store', () => {
  beforeEach(() => jest.clearAllMocks());

  test('restores the same version-independent service and token after a new launch', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({ username: target.serverUrl, password: target.token });
    await expect(loadPairing()).resolves.toEqual({ status: 'PAIRED', target });
    await expect(loadPairing()).resolves.toEqual({ status: 'PAIRED', target });
    expect(Keychain.getGenericPassword).toHaveBeenLastCalledWith({ service: 'com.bms.pos.device' });
    expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
  });

  test('distinguishes absent credentials from locked/corrupt credentials without deleting either', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce(false);
    await expect(loadPairing()).resolves.toEqual({ status: 'UNPAIRED' });
    (Keychain.getGenericPassword as jest.Mock).mockRejectedValueOnce(new Error('Locked'));
    await expect(loadPairing()).resolves.toMatchObject({ status: 'UNAVAILABLE' });
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce({ username: target.serverUrl, password: '' });
    await expect(loadPairing()).resolves.toMatchObject({ status: 'UNAVAILABLE' });
    expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
  });

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

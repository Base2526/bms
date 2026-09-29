import * as Keychain from 'react-native-keychain';
import {
  loadScannerInputMode,
  saveScannerInputMode,
} from '../src/lib/scannerPreference';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));

describe('scanner input preference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
  });

  test('defaults to camera when no preference exists or secure storage cannot be read', async () => {
    await expect(loadScannerInputMode()).resolves.toBe('camera');

    (Keychain.getGenericPassword as jest.Mock).mockRejectedValueOnce(
      new Error('device locked'),
    );
    await expect(loadScannerInputMode()).resolves.toBe('camera');
  });

  test('reads the saved hardware scanner preference', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
      username: 'scanner-input-mode',
      password: 'hardware',
    });

    await expect(loadScannerInputMode()).resolves.toBe('hardware');
    expect(Keychain.getGenericPassword).toHaveBeenCalledWith({
      service: 'com.bms.pos.scanner-preference.v1',
    });
  });

  test('treats an unexpected Keychain username or value as camera', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce({
      username: 'different-setting',
      password: 'hardware',
    });
    await expect(loadScannerInputMode()).resolves.toBe('camera');

    (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce({
      username: 'scanner-input-mode',
      password: 'unknown',
    });
    await expect(loadScannerInputMode()).resolves.toBe('camera');
  });

  test.each(['camera', 'hardware'] as const)(
    'writes %s with a dedicated Keychain service',
    async mode => {
      await saveScannerInputMode(mode);

      expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
        'scanner-input-mode',
        mode,
        {
          service: 'com.bms.pos.scanner-preference.v1',
          accessible: 'AfterFirstUnlock',
        },
      );
    },
  );

  test('does not report a preference write as saved when Keychain declines it', async () => {
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(false);

    await expect(saveScannerInputMode('hardware')).rejects.toThrow(
      'บันทึกโหมดเครื่องสแกนไม่สำเร็จ',
    );
  });

  test('waits for an in-flight preference write before reading it back', async () => {
    let finishWrite: ((stored: boolean) => void) | undefined;
    (Keychain.setGenericPassword as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<boolean>(resolve => {
          finishWrite = resolve;
        }),
    );

    const save = saveScannerInputMode('hardware');
    const load = loadScannerInputMode();
    await Promise.resolve();
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();

    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
      username: 'scanner-input-mode',
      password: 'hardware',
    });
    finishWrite?.(true);

    await expect(save).resolves.toBeUndefined();
    await expect(load).resolves.toBe('hardware');
  });
});

import { PixelRatio, Platform } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { captureReceipt } from '../src/lib/captureReceipt';
import { receiptRaster } from '../src/lib/receiptRaster';

jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));
jest.mock('../src/lib/receiptRaster', () => ({
  MAX_RECEIPT_HEIGHT: 16000,
  receiptRaster: jest.fn(() => new Uint8Array([1])),
}));

const originalOS = Platform.OS;
afterEach(() => {
  Platform.OS = originalOS;
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test.each(['ios', 'android'] as const)(
  '%s captures the exact printer dot width',
  async os => {
    Platform.OS = os;
    jest.spyOn(PixelRatio, 'get').mockReturnValue(3);
    jest.mocked(captureRef).mockResolvedValue('png');
    const ref = { current: {} } as Parameters<typeof captureReceipt>[0];
    await captureReceipt(
      ref,
      { width: 400, height: 800 },
      {
        host: '192.168.1.10',
        port: 9100,
        paperWidth: 80,
      },
    );
    expect(captureRef).toHaveBeenCalledWith(ref, {
      format: 'png',
      result: 'base64',
      width: os === 'ios' ? 192 : 576,
      height: os === 'ios' ? 384 : 1152,
    });
    expect(receiptRaster).toHaveBeenCalledWith('png', 576);
  },
);

test('refuses unavailable or oversized receipt surfaces before capture', async () => {
  const config = { host: '192.168.1.10', port: 9100, paperWidth: 58 as const };
  await expect(
    captureReceipt({ current: null }, null, config),
  ).rejects.toThrow();
  const ref = { current: {} } as Parameters<typeof captureReceipt>[0];
  await expect(
    captureReceipt(ref, { width: 100, height: 20000 }, config),
  ).rejects.toThrow();
  expect(captureRef).not.toHaveBeenCalled();
});

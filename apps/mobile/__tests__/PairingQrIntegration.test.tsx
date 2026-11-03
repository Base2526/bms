import React from 'react';
import { Alert } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import { DeviceProvider, useDevice } from '../src/state/DeviceContext';
import { PairingScannerButton } from '../src/components/PairingScannerButton';
import { Button } from '../src/components/Button';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { loadOfflineSales } from '../src/lib/offlineSales';
import { buildPairingQr } from '../../../packages/pos-client-core/src/pairingQr';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => () => void) =>
    require('react').useEffect(callback, [callback]),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));
jest.mock('../src/lib/offlineSales', () => ({ loadOfflineSales: jest.fn() }));
const mockScan = jest.fn();
jest.mock('react-native-data-scanner', () => ({
  DataScanner: { scanBarcode: () => mockScan() },
}));
const target = {
  serverUrl: 'https://shop.example.test',
  token: `pos_${'a'.repeat(43)}`,
};

test.each([
  'success',
  'revoked',
  'forbidden',
  'storage failure',
  'pending cash',
])(
  'real scanner -> DeviceProvider -> verification -> secure storage: %s',
  async scenario => {
    jest.clearAllMocks();
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
    (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);
    (Keychain.setGenericPassword as jest.Mock).mockImplementation(
      async (_user, _value, options) =>
        options.service !== 'com.bms.pos.device' ||
        scenario !== 'storage failure',
    );
    (loadOfflineSales as jest.Mock).mockResolvedValue(
      scenario === 'pending cash'
        ? [{ serverUrl: target.serverUrl, deviceId: 'another-device' }]
        : [],
    );
    mockScan.mockResolvedValue({ value: buildPairingQr(target) });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async url => {
        const status = String(url).endsWith('/api/graphql')
          ? scenario === 'revoked'
            ? 401
            : scenario === 'forbidden'
            ? 403
            : 200
          : 200;
        return {
          ok: status === 200,
          status,
          json: async () => ({
            data: {
              bmsPosSession: {
                device: { id: 'device-a', code: 'POS-A' },
                cashiers: [],
              },
            },
          }),
        } as Response;
      });
    const onPaired = jest.fn();
    let device!: ReturnType<typeof useDevice>;
    function SettingsProbe() {
      device = useDevice();
      return (
        <PairingScannerButton
          target={device.target}
          disabled={
            device.status === 'LOADING' || device.status === 'UNAVAILABLE'
          }
          pair={device.pair}
          onPaired={onPaired}
          onBusyChange={() => {}}
        />
      );
    }
    let tree!: Renderer.ReactTestRenderer;
    try {
      await act(async () => {
        tree = Renderer.create(
          <DeviceProvider>
            <ThemeProvider>
              <SettingsProbe />
            </ThemeProvider>
          </DeviceProvider>,
        );
      });
      await act(async () => {
        tree.root.findByType(Button).props.onPress();
      });
      const writes = (
        Keychain.setGenericPassword as jest.Mock
      ).mock.calls.filter(
        ([, , options]) => options.service === 'com.bms.pos.device',
      );
      const requests = fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/api/graphql'),
      );
      expect(requests).toHaveLength(1);
      expect(requests[0][1]?.headers).toEqual(
        expect.objectContaining({ 'x-pos-device-token': target.token }),
      );
      expect(writes).toHaveLength(
        scenario === 'success' || scenario === 'storage failure' ? 1 : 0,
      );
      expect(onPaired).toHaveBeenCalledTimes(scenario === 'success' ? 1 : 0);
      expect(device.target).toEqual(scenario === 'success' ? target : null);
      expect(tree.root.findByType(Button).props.loading).toBe(false);
      expect(alert.mock.calls[0][0]).toBe(
        scenario === 'success' ? 'จับคู่สำเร็จ' : 'จับคู่ไม่สำเร็จ',
      );
      expect(JSON.stringify(alert.mock.calls)).not.toContain(target.token);
    } finally {
      if (tree) await act(async () => tree.unmount());
      alert.mockRestore();
      fetchMock.mockRestore();
    }
  },
);

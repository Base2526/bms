import React from 'react';
import { Alert } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import DeviceSettingsScreen from '../src/screens/settings/DeviceSettingsScreen';
import { Button } from '../src/components/Button';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { loadOfflineSales } from '../src/lib/offlineSales';

const mockUnpair = jest.fn();
const mockSignOut = jest.fn();
jest.mock('../src/state/DeviceContext', () => ({
  useDevice: () => ({
    status: 'PAIRED',
    target: { serverUrl: 'https://shop.example.test', token: `pos_${'a'.repeat(43)}` },
    storeError: null,
    verify: { kind: 'REJECTED', message: 'token rejected' },
    lastCheckedAt: null,
    pair: jest.fn(),
    unpair: mockUnpair,
    runVerify: jest.fn(),
  }),
}));
jest.mock('../src/state/SessionContext', () => ({
  useSession: () => ({ session: null, signOut: mockSignOut }),
}));
jest.mock('../src/state/StoreModeContext', () => ({
  useStoreMode: () => ({ mode: 'retail' }),
}));
jest.mock('../src/theme/useResponsive', () => ({
  useResponsive: () => ({ isTablet: false }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/lib/offlineSales', () => ({ loadOfflineSales: jest.fn() }));
jest.mock('../src/lib/pickupQueuePreference', () => ({
  usePickupQueueEnabled: () => false,
  savePickupQueueEnabled: jest.fn(),
}));
jest.mock('../src/components/LanguageSelector', () => ({ LanguageSelector: () => null }));
jest.mock('../src/components/PairingScannerButton', () => ({ PairingScannerButton: () => null }));

test('confirmed unpair keeps Settings open for pairing and removes the register from Back', async () => {
  mockUnpair.mockReset().mockResolvedValue(undefined);
  mockSignOut.mockClear();
  (loadOfflineSales as jest.Mock).mockResolvedValue([]);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const navigation = { canGoBack: () => true, goBack: jest.fn(), reset: jest.fn(), navigate: jest.fn() };
  let tree!: Renderer.ReactTestRenderer;
  try {
    await act(async () => {
      tree = Renderer.create(
        <ThemeProvider>
          <DeviceSettingsScreen route={{ key: 'settings-1', name: 'Settings' }} navigation={navigation as never} />
        </ThemeProvider>,
      );
    });
    const unpairButton = tree.root.findAllByType(Button).find(button => button.props.label === 'เลิกจับคู่');
    expect(unpairButton).toBeDefined();
    await act(async () => { await unpairButton!.props.onPress(); });
    expect(mockUnpair).not.toHaveBeenCalled();
    expect(navigation.reset).not.toHaveBeenCalled();
    expect(alert.mock.calls[0][0]).toBe('เลิกจับคู่เครื่องนี้?');
    const actions = alert.mock.calls[0][2];
    await act(async () => { await actions?.[1]?.onPress?.(); });
    expect(mockUnpair).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(navigation.reset).toHaveBeenCalledWith({
      index: 1,
      routes: [{ name: 'Login' }, { name: 'Settings' }],
    });
  } finally {
    await act(async () => tree?.unmount());
    alert.mockRestore();
  }
});

test.each(['pending cash', 'queue read failure', 'secure-storage failure'])(
  'failed unpair leaves navigation and cashier untouched: %s',
  async scenario => {
    mockUnpair.mockReset();
    mockSignOut.mockClear();
    if (scenario === 'pending cash') {
      (loadOfflineSales as jest.Mock).mockResolvedValue([{ id: 'unresolved-sale' }]);
    } else if (scenario === 'queue read failure') {
      (loadOfflineSales as jest.Mock).mockRejectedValue(new Error('queue unreadable'));
    } else {
      (loadOfflineSales as jest.Mock).mockResolvedValue([]);
      mockUnpair.mockRejectedValue(new Error('Keychain unavailable'));
    }
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const navigation = { canGoBack: () => true, goBack: jest.fn(), reset: jest.fn(), navigate: jest.fn() };
    let tree!: Renderer.ReactTestRenderer;
    try {
      await act(async () => {
        tree = Renderer.create(
          <ThemeProvider>
            <DeviceSettingsScreen route={{ key: 'settings-1', name: 'Settings' }} navigation={navigation as never} />
          </ThemeProvider>,
        );
      });
      const unpairButton = tree.root.findAllByType(Button).find(button => button.props.label === 'เลิกจับคู่');
      await act(async () => { await unpairButton!.props.onPress(); });
      if (scenario === 'secure-storage failure') {
        const actions = alert.mock.calls[0][2];
        await act(async () => { await actions?.[1]?.onPress?.(); });
        expect(alert.mock.calls[1][0]).toBe('เลิกจับคู่ไม่สำเร็จ');
      } else {
        expect(alert.mock.calls[0][0]).toBe('ยังเลิกจับคู่ไม่ได้');
        expect(mockUnpair).not.toHaveBeenCalled();
      }
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(navigation.reset).not.toHaveBeenCalled();
    } finally {
      await act(async () => tree?.unmount());
      alert.mockRestore();
    }
  },
);

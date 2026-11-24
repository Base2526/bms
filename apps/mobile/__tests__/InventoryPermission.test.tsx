import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import InventoryScreen from '../src/screens/inventory/InventoryScreen';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { applyPosLanguage } from '../src/i18n/catalog';

// 2026-11-24 recheck: the screen detected a refusal with
// error.message.includes(posText("ไม่มีสิทธิ์")). Server messages stay Thai, so in English the
// search string became "No permission", the panel said "Could not load" and offered a Retry loop.
const forbidden = {
  message: 'ไม่มีสิทธิ์ product.view',
  graphQLErrors: [{ message: 'ไม่มีสิทธิ์ product.view', extensions: { code: 'FORBIDDEN' } }],
};
jest.mock('@apollo/client', () => ({
  useMutation: () => [jest.fn()],
  useLazyQuery: () => [jest.fn()],
  useQuery: () => ({ data: undefined, error: forbidden, refetch: jest.fn() }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({}),
  useFocusEffect: () => undefined,
}));
jest.mock('../src/state/SessionContext', () => ({
  useSession: () => ({
    session: { branch: { name: 'Test' }, credentials: { cashierUserId: 'cashier', pin: '1234' } },
  }),
}));
jest.mock('../src/state/StoreModeContext', () => ({ useStoreMode: () => ({ mode: 'general' }) }));
jest.mock('../src/components/BarcodeScannerModal', () => ({ BarcodeScannerModal: () => null }));

afterEach(() => applyPosLanguage('th'));

test.each(['th', 'en'] as const)('a FORBIDDEN stock lookup shows the permission panel in %s', async language => {
  applyPosLanguage(language);
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}
      >
        <ThemeProvider>
          <InventoryScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  const texts = tree.root.findAllByType(Text).map(node => [].concat(node.props.children).join(''));
  const denied = language === 'en' ? 'This account cannot access inventory' : 'บัญชีนี้ไม่มีสิทธิ์ใช้งานสต็อก';
  const failed = language === 'en' ? 'Could not load inventory tasks' : 'โหลดข้อมูลงานสต็อกไม่สำเร็จ';
  expect(texts).toContain(denied);
  expect(texts).not.toContain(failed);
});

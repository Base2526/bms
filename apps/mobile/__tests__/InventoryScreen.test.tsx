import React from 'react';
import { Alert, TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import InventoryScreen from '../src/screens/inventory/InventoryScreen';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { Button } from '../src/components/Button';

const mockMutation = jest.fn(),
  mockRefresh = jest.fn();
let mockCounts: any;
jest.mock('@apollo/client', () => ({
  useMutation: () => [mockMutation],
  useLazyQuery: () => [jest.fn()],
  useQuery: (document: any) => ({
    data:
      document.definitions[0].name.value === 'MobilePosStockCounts'
        ? mockCounts
        : undefined,
    refetch: mockRefresh,
  }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({}),
  useFocusEffect: () => undefined,
}));
jest.mock('../src/state/SessionContext', () => ({
  useSession: () => ({
    session: {
      branch: { name: 'Test' },
      credentials: { cashierUserId: 'cashier', pin: '1234' },
    },
  }),
}));
jest.mock('../src/state/StoreModeContext', () => ({
  useStoreMode: () => ({ mode: 'general' }),
}));
jest.mock('../src/components/BarcodeScannerModal', () => ({
  BarcodeScannerModal: () => null,
}));
let tree: Renderer.ReactTestRenderer;
const button = (label: string) =>
  tree.root.findAllByType(Button).find(node => node.props.label === label)!;
beforeEach(async () => {
  jest.clearAllMocks();
  mockCounts = undefined;
  mockRefresh.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await act(async () => {
    tree = Renderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, right: 0, bottom: 0, left: 0 },
        }}
      >
        <ThemeProvider>
          <InventoryScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  await act(async () => button('นับสต็อก').props.onPress());
  await act(async () =>
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.placeholder === 'ขอบเขตหรือหมายเหตุการนับ')!
      .props.onChangeText('Shelf A'),
  );
});

test('blank stock counts never submit zero; an explicitly entered zero is accepted', async () => {
  mockCounts = {
    bmsPosStockCounts: {
      counts: [
        {
          id: 'count-1',
          status: 'DRAFT',
          countNo: 'CNT-1',
          items: [],
          varianceUnits: 0,
        },
      ],
    },
  };
  mockMutation.mockResolvedValue({
    data: {
      bmsPosCreateStockCount: { status: 'CREATED', countId: 'count-1' },
      bmsPosRecordStockCountItem: { status: 'OK' },
    },
  });
  await act(async () => button('สร้างใบนับ').props.onPress());
  mockMutation.mockClear();
  const input = (placeholder: string) =>
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.placeholder === placeholder)!;
  await act(async () => {
    input('SKU').props.onChangeText('tea');
    input('ขนาด').props.onChangeText('-');
    input('นับได้').props.onChangeText('  ');
  });
  expect(button('บันทึกรายการ').props.disabled).toBe(true);
  await act(async () => button('บันทึกรายการ').props.onPress());
  expect(mockMutation).not.toHaveBeenCalled();
  await act(async () => input('นับได้').props.onChangeText('0'));
  await act(async () => button('บันทึกรายการ').props.onPress());
  expect(mockMutation.mock.calls[0][0].variables.input.countedQty).toBe(0);
});
afterEach(async () => {
  await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

test.each([undefined, {}, { status: null }, { status: '' }, { status: '  ' }])(
  'incomplete count result retains draft and retry identity: %j',
  async result => {
    mockMutation.mockResolvedValue({
      data: { bmsPosCreateStockCount: result },
    });
    await act(async () => button('สร้างใบนับ').props.onPress());
    await act(async () => button('สร้างใบนับ').props.onPress());
    const requests = mockMutation.mock.calls.map(
      ([args]) => args.variables.input,
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[1].note).toBe('Shelf A');
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalled();
  },
);

test('same-frame double taps create only one count; a failed refresh cannot undo success', async () => {
  let finish!: (value: unknown) => void;
  mockMutation.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  mockRefresh.mockRejectedValue(new Error('read failed'));
  const press = button('สร้างใบนับ').props.onPress;
  let first: Promise<unknown>;
  await act(async () => {
    first = press();
    await press();
  });
  expect(mockMutation).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({
      data: {
        bmsPosCreateStockCount: { status: 'CREATED', countId: 'count-1' },
      },
    });
    await first;
  });
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('a decided stock rejection permits a corrected intent with a new key', async () => {
  mockMutation.mockResolvedValue({
    data: { bmsPosCreateStockCount: { status: 'INVALID', reason: 'review' } },
  });
  await act(async () => button('สร้างใบนับ').props.onPress());
  await act(async () => button('สร้างใบนับ').props.onPress());
  expect(mockMutation.mock.calls[1][0].variables.input.idempotencyKey).not.toBe(
    mockMutation.mock.calls[0][0].variables.input.idempotencyKey,
  );
});

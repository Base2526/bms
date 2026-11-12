import React from 'react';
import { Modal, TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ShiftScreen from '../src/screens/shift/ShiftScreen';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { Button } from '../src/components/Button';

const mockMovement = jest.fn(),
  mockOpen = jest.fn();
let mockIsOpen = true;
jest.mock('@apollo/client', () => ({ useQuery: () => ({ data: undefined }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({}) }));
jest.mock('../src/navigation/RootNavigationActions', () => ({
  useRootNavigationActions: () => ({}),
}));
jest.mock('../src/state/SessionContext', () => ({
  useSession: () => ({
    session: { branch: { name: 'Test' }, cashier: { id: 'staff' } },
  }),
}));
jest.mock('../src/state/StoreModeContext', () => ({
  useStoreMode: () => ({ mode: 'general' }),
}));
jest.mock('../src/state/ShiftContext', () => ({
  useShift: () => ({
    isOpen: mockIsOpen,
    movements: [],
    openedAt: '2026-11-12T00:00:00Z',
    openedByName: 'Staff',
    openingFloat: 0,
    expectedCash: 0,
    cashSales: 0,
    cashRefunds: 0,
    movementIn: 0,
    movementOut: 0,
    roundingTotal: 0,
    addMovement: mockMovement,
    reopenShift: mockOpen,
  }),
}));
let tree: Renderer.ReactTestRenderer;
const button = (label: string) =>
  tree.root
    .findAllByType(Button)
    .find(n => n.props.accessibilityLabel === label)!;
beforeEach(async () => {
  jest.clearAllMocks();
  mockIsOpen = true;
  await act(async () => {
    tree = Renderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, right: 0, bottom: 0, left: 0 },
        }}
      >
        <ThemeProvider>
          <ShiftScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  await act(async () => {
    const tab = tree.root.findAll(n =>
      ['เงินเข้าออก', 'เงินเข้า/ออก'].includes(n.props.label),
    )[0];
    tab.props.onPress();
  });
  await act(async () => button('บันทึกเงินเข้าลิ้นชัก').props.onPress());
  await act(async () => {
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'จำนวนเงิน')!
      .props.onChangeText('50');
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'เหตุผล')!
      .props.onChangeText('Change');
  });
});

test('opening float requires a typed value and preserves explicit zero', async () => {
  await act(async () =>
    tree.root.findAllByType(Modal)[0].props.onRequestClose(),
  );
  mockIsOpen = false;
  // Trigger a render after the server snapshot changes.
  await act(async () =>
    tree.root
      .findAll(n => ['ภาพรวม', 'ภาพรวมกะ'].includes(n.props.label))[0]
      .props.onPress(),
  );
  await act(async () => button('เปิดกะใหม่').props.onPress());
  const input = () =>
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'เงินทอนตั้งต้น')!;
  const submit = () =>
    tree.root
      .findAllByType(Button)
      .find(n => n.props.label === 'ยืนยันเปิดกะ')!
      .props.onPress();
  await act(async () => input().props.onChangeText('  '));
  await act(async () => submit());
  expect(mockOpen).not.toHaveBeenCalled();
  mockOpen.mockResolvedValue(null);
  await act(async () => input().props.onChangeText('0'));
  await act(async () => submit());
  expect(mockOpen).toHaveBeenCalledWith(0);
});
afterEach(async () => {
  await act(async () => tree.unmount());
});

test.each([null, 'Unknown result'])(
  'pending cash movement cannot be dismissed or submitted twice: %s',
  async result => {
    let finish!: (value: string | null) => void;
    mockMovement.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const submit = button('บันทึกรายการเงินเข้า/ออก').props.onPress;
    let first: Promise<unknown>;
    await act(async () => {
      first = submit();
      await submit();
    });
    await act(async () =>
      tree.root.findAllByType(Modal)[0].props.onRequestClose(),
    );
    expect(tree.root.findAllByType(Modal)[0].props.visible).toBe(true);
    expect(mockMovement).toHaveBeenCalledTimes(1);
    expect(
      tree.root
        .findAllByType(TextInput)
        .find(n => n.props.accessibilityLabel === 'จำนวนเงิน')!.props.editable,
    ).toBe(false);
    await act(async () => {
      finish(result);
      await first;
    });
    expect(tree.root.findAllByType(Modal)[0].props.visible).toBe(
      Boolean(result),
    );
    if (result) {
      mockMovement.mockResolvedValue(null);
      await act(async () => button('บันทึกรายการเงินเข้า/ออก').props.onPress());
      expect(mockMovement.mock.calls[1]).toEqual(mockMovement.mock.calls[0]);
    }
  },
);

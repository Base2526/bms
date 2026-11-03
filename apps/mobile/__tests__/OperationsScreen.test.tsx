import React from 'react';
import { Alert, TextInput } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import OperationsScreen from '../src/screens/operations/OperationsScreen';
import { Button } from '../src/components/Button';
import { ThemeProvider } from '../src/theme/ThemeProvider';

const mockMutation = jest.fn();
const mockRefresh = jest.fn();
jest.mock('@apollo/client', () => ({
  useMutation: () => [mockMutation],
  useQuery: (document: any) => ({
    refetch: mockRefresh,
    data: document.definitions[0].name.value === 'MobilePosDeposits' ? {
      bmsPosDeposits: { deposits: [{
        id: 'deposit-1', orderId: 'order-1', balanceDue: 100, status: 'PENDING',
      }] },
    } : undefined,
  }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({}), useFocusEffect: () => undefined }));
jest.mock('../src/state/SessionContext', () => ({ useSession: () => ({ session: {
  branch: { name: 'Branch' }, credentials: { cashierUserId: 'cashier', pin: '1234' },
} }) }));
jest.mock('../src/state/StoreModeContext', () => ({ useStoreMode: () => ({ mode: 'general' }) }));
jest.mock('../src/state/RestaurantOperationsContext', () => ({ useRestaurantOperations: () => ({
  qrSubmissions: [], serviceCalls: [], waitlistEntries: [], pendingQrCount: 0,
  pendingServiceCallCount: 0, activeWaitlistCount: 0, waitingGuests: 0,
}) }));

let tree: ReactTestRenderer.ReactTestRenderer;
const submit = () => tree.root.findAllByType(Button).find(node => node.props.label === 'รับเพิ่ม')!;
beforeEach(async () => {
  jest.clearAllMocks();
  mockRefresh.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
        <ThemeProvider><OperationsScreen section="REGISTER" /></ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  await act(async () => {
    tree.root.findAllByType(TextInput).find(node => node.props.placeholder === 'ยอดรับเพิ่ม')!.props.onChangeText('25');
  });
});
afterEach(async () => { await act(async () => tree.unmount()); jest.restoreAllMocks(); });

test.each(['CONFLICT', 'FORBIDDEN', 'INTERNAL_SERVER_ERROR', 'NETWORK'])(
  'deposit retry handles %s without reusing a decided key or discarding an unknown key', async code => {
    mockMutation.mockRejectedValue(code === 'NETWORK' ? new Error('network') : {
      graphQLErrors: [{ extensions: { code } }],
    });
    await act(async () => { await submit().props.onPress(); });
    await act(async () => { await submit().props.onPress(); });
    const keys = mockMutation.mock.calls.map(([args]) => args.variables.input.idempotencyKey);
    expect(keys).toHaveLength(2);
    if (code === 'CONFLICT' || code === 'FORBIDDEN') expect(keys[1]).not.toBe(keys[0]);
    else expect(keys[1]).toBe(keys[0]);
  },
);

test('a failed read after a committed deposit is not reported as a failed cash action', async () => {
  mockMutation.mockResolvedValue({ data: { bmsPosDeposit: { status: 'TAKEN' } } });
  mockRefresh.mockRejectedValue(new Error('read failed'));
  await act(async () => { await submit().props.onPress(); });
  expect(mockMutation).toHaveBeenCalledTimes(1);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(Alert.alert).not.toHaveBeenCalled();
});

test.each([{}, { status: null }, { status: '' }])('an incomplete deposit result preserves its retry key: %j', async result => {
  mockMutation.mockResolvedValue({ data: { bmsPosDeposit: result } });
  await act(async () => { await submit().props.onPress(); });
  await act(async () => { await submit().props.onPress(); });
  const keys = mockMutation.mock.calls.map(([args]) => args.variables.input.idempotencyKey);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(mockRefresh).not.toHaveBeenCalled();
});

test('two taps before a render send one deposit request', async () => {
  let finish!: (value: unknown) => void;
  mockMutation.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const press = submit().props.onPress;
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => { first = press(); second = press(); });
  expect(mockMutation).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ data: { bmsPosDeposit: { status: 'TAKEN' } } });
    await Promise.all([first, second]);
  });
});

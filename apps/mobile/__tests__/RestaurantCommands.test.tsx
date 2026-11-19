import React from 'react';
import { Alert } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import FloorScreen from '../src/screens/floor/FloorScreen';
import CheckDetailScreen from '../src/screens/floor/CheckDetailScreen';
import IncomingOrdersScreen from '../src/screens/orders/IncomingOrdersScreen';
import {
  IncomingOrdersProvider,
  useIncomingOrders,
} from '../src/state/IncomingOrdersContext';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { Button } from '../src/components/Button';
import { ProductOptionsModal } from '../src/components/ProductOptionsModal';

const mockMutation = jest.fn(),
  mockRefresh = jest.fn();
let mockCurrent: any;
let mockOrders: any[] = [];
jest.mock('@apollo/client', () => ({
  useMutation: () => [mockMutation],
  useQuery: () => ({
    data: {
      bmsPosRestaurantFloor: { areas: [], tables: [], takeawayChecks: [] },
      bmsPosRestaurantCheck: mockCurrent,
      bmsPosRestaurantIncoming: {
        orders: mockOrders,
        config: { paused: false },
      },
      bmsPosSession: { approvers: [] },
    },
    refetch: mockRefresh,
  }),
}));
jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 0,
}));
jest.mock('../src/navigation/parentNavigation', () => ({
  getAppNavigation: (nav: unknown) => nav,
}));
jest.mock('../src/state/SessionContext', () => ({
  useSession: () => ({
    session: {
      cashier: { id: 'cashier' },
      credentials: { cashierUserId: 'cashier', pin: '1234' },
    },
  }),
}));
jest.mock('../src/state/StoreModeContext', () => ({
  useStoreMode: () => ({ mode: 'restaurant' }),
}));
jest.mock('../src/state/OrderAlertContext', () => ({
  useOrderAlerts: () => ({
    settings: { sound: false },
    soundAvailable: false,
    acknowledge: jest.fn(),
  }),
}));
jest.mock('../src/state/RestaurantOperationsContext', () => ({
  useRestaurantOperations: () => ({
    activeWaitlistCount: 0,
    pendingQrCount: 0,
    pendingServiceCallCount: 0,
  }),
}));
jest.mock('../src/components/OrderAlertSettingsModal', () => ({
  OrderAlertSettingsModal: () => null,
}));
jest.mock('../src/components/OfflineStatusBanner', () => ({
  useOfflineStatusBannerState: () => ({ visible: false }),
}));
jest.mock('../src/state/CatalogContext', () => ({
  useCatalog: () => ({ catalog: [], resolveVariant: jest.fn() }),
}));
jest.mock('../src/components/MenuGrid', () => ({ MenuGrid: () => null }));
jest.mock('../src/components/ProductOptionsModal', () => ({
  ProductOptionsModal: () => null,
}));
let tree: Renderer.ReactTestRenderer;
const navigation = {
  navigate: jest.fn(),
  setParams: jest.fn(),
  replace: jest.fn(),
  goBack: jest.fn(),
};
const button = (label: string) =>
  tree.root.findAllByType(Button).find(node => node.props.label === label)!;
async function render(child: React.ReactNode) {
  await act(async () => {
    tree = Renderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 1024, height: 768 },
          insets: { top: 0, right: 0, bottom: 0, left: 0 },
        }}
      >
        <ThemeProvider>{child}</ThemeProvider>
      </SafeAreaProvider>,
    );
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockCurrent = undefined;
  mockOrders = [];
  mockRefresh.mockRejectedValue(new Error('follow-up read failed'));
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

test.each([undefined, { status: '' }, { status: null }])(
  'incomplete online cancellation retains the original retry key: %j',
  async result => {
    mockOrders = [
      {
        id: 'order-1',
        channel: 'WEB',
        customerRef: 'Guest',
        fulfillmentType: 'TAKEAWAY',
        amountDue: 30,
        createdAt: '2026-11-12T00:00:00Z',
        status: 'ACCEPTED',
        items: [{ orderItemId: 1, sku: 'tea', name: 'Tea', qty: 1 }],
      },
    ];
    mockMutation.mockResolvedValue({
      data: { bmsPosRestaurantCancelOrderLines: result },
    });
    await render(
      <IncomingOrdersProvider>
        <IncomingOrdersScreen
          navigation={navigation as any}
          route={{} as any}
        />
      </IncomingOrdersProvider>,
    );
    await act(async () => button('หมด / ยกเลิก').props.onPress());
    await act(async () => button('หมด / ยกเลิก').props.onPress());
    expect(mockMutation).toHaveBeenCalledTimes(2);
    expect(mockMutation.mock.calls[1][0]).toEqual(
      mockMutation.mock.calls[0][0],
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  },
);

test('online cancellation double tap sends once and preserves a committed outcome after failed refresh', async () => {
  mockOrders = [
    {
      id: 'order-1',
      channel: 'WEB',
      amountDue: 30,
      createdAt: '2026-11-12T00:00:00Z',
      status: 'ACCEPTED',
      items: [{ orderItemId: 1, sku: 'tea', name: 'Tea', qty: 1 }],
    },
  ];
  let finish!: (value: unknown) => void;
  mockMutation.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await render(
    <IncomingOrdersProvider>
      <IncomingOrdersScreen navigation={navigation as any} route={{} as any} />
    </IncomingOrdersProvider>,
  );
  const press = button('หมด / ยกเลิก').props.onPress;
  let first: Promise<unknown>;
  await act(async () => {
    first = press();
    await press();
  });
  expect(mockMutation).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({
      data: { bmsPosRestaurantCancelOrderLines: { status: 'RETURNED' } },
    });
    await first;
  });
  expect(Alert.alert).not.toHaveBeenCalled();
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
});

test('takeaway double tap opens once and reaches the committed bill when refresh fails', async () => {
  let finish!: (value: unknown) => void;
  mockMutation.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await render(
    <FloorScreen navigation={navigation as any} route={{} as any} />,
  );
  const press = button('เปิดบิลกลับบ้าน').props.onPress;
  await act(async () => {
    press();
    press();
  });
  expect(mockMutation).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({
      data: { bmsPosRestaurantOpenCheck: { check: { id: 'takeaway-1' } } },
    });
  });
  expect(navigation.navigate).toHaveBeenCalledWith('CheckDetail', {
    checkId: 'takeaway-1',
    serviceMode: 'TAKEAWAY',
  });
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('new table bill survives a failed refresh and is reused by the next add', async () => {
  mockMutation
    .mockResolvedValueOnce({
      data: { bmsPosRestaurantOpenCheck: { check: { id: 'dine-1' } } },
    })
    .mockResolvedValue({
      data: { bmsPosRestaurantAddCheckItem: { check: { id: 'dine-1' } } },
    });
  await render(
    <CheckDetailScreen
      navigation={navigation as any}
      route={{ params: { tableId: 'table-1' } } as any}
    />,
  );
  const configured = {
    item: { sku: 'tea', size: 'L' },
    modifierCodes: ['LESS_SUGAR'],
    kitchenNote: 'No ice',
  };
  await act(async () =>
    tree.root.findByType(ProductOptionsModal).props.onConfirm(configured),
  );
  expect(navigation.setParams).toHaveBeenCalledWith({ checkId: 'dine-1' });
  await act(async () =>
    tree.root.findByType(ProductOptionsModal).props.onConfirm(configured),
  );
  expect(mockMutation).toHaveBeenCalledTimes(3); // one open + two intended additions
  expect(
    mockMutation.mock.calls.slice(1).map(([call]) => call.variables.checkId),
  ).toEqual(['dine-1', 'dine-1']);
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('same-frame item additions send only one command', async () => {
  let finish!: (value: unknown) => void;
  mockMutation.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await render(
    <CheckDetailScreen
      navigation={navigation as any}
      route={{ params: { checkId: 'dine-1' } } as any}
    />,
  );
  const confirm = tree.root.findByType(ProductOptionsModal).props.onConfirm;
  await act(async () => {
    confirm({ item: { sku: 'tea' } });
    confirm({ item: { sku: 'tea' } });
  });
  expect(mockMutation).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({
      data: { bmsPosRestaurantAddCheckItem: { check: { id: 'dine-1' } } },
    });
  });
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('accepted incoming order retains the server outcome when the list refresh fails', async () => {
  let incoming!: ReturnType<typeof useIncomingOrders>;
  function Probe() {
    incoming = useIncomingOrders();
    return null;
  }
  mockMutation.mockResolvedValue({
    data: {
      bmsPosRestaurantAcceptIncomingOrder: {
        status: 'ACCEPTED',
        ticketsCreated: 2,
      },
    },
  });
  await render(
    <IncomingOrdersProvider>
      <Probe />
    </IncomingOrdersProvider>,
  );
  expect(await incoming.acceptOrder('order-1')).toEqual({ ticketsCreated: 2 });
});

import React from 'react';
import { Text } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KitchenProvider, useKitchen } from '../src/state/KitchenContext';
import KitchenBoardScreen from '../src/screens/kitchen/KitchenBoardScreen';
import { ThemeProvider } from '../src/theme/ThemeProvider';
const mockMutation = jest.fn(),
  mockRefresh = jest.fn();
const mockTicket = {
  id: 'ticket-1',
  status: 'NEW',
  pickupQueueLabel: '042',
  tableCode: 'A1',
  roundNo: 1,
  station: 'Bar',
  stationId: 'bar',
  productName: 'Tea',
  qty: 2,
  size: 'L',
  modifierCodes: ['NO_SUGAR', 'EXTRA_ICE'],
  kitchenNote: 'Separate ice',
  createdAt: '2026-11-12T01:00:00Z',
  updatedAt: '2026-11-12T01:00:00Z',
};
jest.mock('@apollo/client', () => ({
  useMutation: () => [mockMutation],
  useQuery: () => ({
    data: {
      bmsPosKitchenTickets: {
        tickets: [
          mockTicket,
          { ...mockTicket, id: 'cancelled', status: 'CANCELLED' },
        ],
        stations: [],
        stationSlas: [],
      },
    },
    refetch: mockRefresh,
  }),
}));
jest.mock('../src/state/SessionContext', () => ({
  useSession: () => ({
    session: {
      cashier: { id: 'staff' },
      credentials: { cashierUserId: 'staff', pin: '1234' },
    },
  }),
}));
jest.mock('../src/components/OrderAlertBanner', () => ({
  OrderAlertBanner: () => null,
}));
let kitchen: ReturnType<typeof useKitchen>, tree: Renderer.ReactTestRenderer;
function Probe() {
  kitchen = useKitchen();
  return null;
}
beforeEach(async () => {
  jest.clearAllMocks();
  mockRefresh.mockResolvedValue(undefined);
  await act(async () => {
    tree = Renderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, right: 0, bottom: 0, left: 0 },
        }}
      >
        <ThemeProvider>
          <KitchenProvider>
            <Probe />
            <KitchenBoardScreen navigation={{} as any} route={{} as any} />
          </KitchenProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
});

test('server-backed size, modifiers, queue number and note reach the kitchen display', () => {
  expect(kitchen.tickets).toHaveLength(1);
  const text = tree.root
    .findAllByType(Text)
    .map(node => [node.props.children].flat().join(''))
    .join(' ');
  for (const value of [
    'Tea · L × 2',
    'NO_SUGAR · EXTRA_ICE',
    'คิว 042',
    'Separate ice',
  ])
    expect(text).toContain(value);
});
test.each(['single', 'bulk'])(
  'a committed %s status change remains successful when refresh fails',
  async kind => {
    mockMutation.mockResolvedValue({
      data: {
        bmsPosKitchenTicketStatus: { ticket: { id: 'ticket-1' } },
        bmsPosKitchenTicketsStatus: { tickets: [{ id: 'ticket-1' }] },
      },
    });
    mockRefresh.mockRejectedValue(new Error('read failed'));
    expect(
      await (kind === 'single'
        ? kitchen.advanceTicket('ticket-1')
        : kitchen.setTicketsStatus(['ticket-1'], 'READY')),
    ).toBeNull();
  },
);
test('single and bulk updates cannot race in the same frame', async () => {
  let finish!: (value: unknown) => void;
  mockMutation.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const first = kitchen.advanceTicket('ticket-1');
  expect(await kitchen.setTicketsStatus(['ticket-1'], 'READY')).not.toBeNull();
  expect(mockMutation).toHaveBeenCalledTimes(1);
  finish({
    data: { bmsPosKitchenTicketStatus: { ticket: { id: 'ticket-1' } } },
  });
  expect(await first).toBeNull();
});

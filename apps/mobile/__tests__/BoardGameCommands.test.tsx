import React from 'react';
import { Alert } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import BoardGameScreen from '../src/screens/boardGame/BoardGameScreen';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { Button } from '../src/components/Button';

const mockMutation = jest.fn(),
  mockRefresh = jest.fn();
jest.mock('@apollo/client', () => ({
  useMutation: () => [mockMutation, {}],
  useQuery: () => ({
    data: {
      bmsPosBoardGameWorkspace: {
        floor: { areas: [], tables: [] },
        waitlist: { entries: [] },
        rates: [],
        library: [],
      },
    },
    refetch: mockRefresh,
  }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));
jest.mock('../src/navigation/parentNavigation', () => ({
  getAppNavigation: (nav: unknown) => nav,
}));
jest.mock('../src/state/DeviceContext', () => ({
  useDevice: () => ({ target: { serverUrl: 'https://test.example' } }),
}));
jest.mock('../src/state/SessionContext', () => ({
  useSession: () => ({
    session: {
      branch: { name: 'Test' },
      credentials: { cashierUserId: 'staff', pin: '1234' },
    },
  }),
}));
jest.mock('../src/state/ShiftContext', () => ({
  useShift: () => ({ isOpen: true }),
}));
jest.mock('../src/state/BoardGameServiceContext', () => ({
  useBoardGameService: () => ({
    pendingCount: 1,
    calls: [
      {
        id: 'call-1',
        status: 'PENDING',
        requestCode: 'GAME_HELP',
        sessionId: 'session-1',
      },
    ],
    refresh: mockRefresh,
  }),
}));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-qrcode-svg', () => () => null);
let tree: Renderer.ReactTestRenderer;
const button = (label: string) =>
  tree.root.findAllByType(Button).find(n => n.props.label === label)!;
beforeEach(async () => {
  jest.clearAllMocks();
  mockRefresh.mockRejectedValue(new Error('read failed'));
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
          <BoardGameScreen navigation={{} as any} route={{} as any} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

test.each(['รับคิว', 'รับทราบ'])(
  'same-frame %s sends once and refresh failure does not undo success',
  async label => {
    if (label === 'รับทราบ') {
      await act(async () =>
        tree.root
          .findAll(
            n => n.props.accessibilityLabel === 'คำเรียกจากโต๊ะ 1 รายการ',
          )[0]
          .props.onPress(),
      );
    }
    let finish!: (value: unknown) => void;
    mockMutation.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const press = button(label).props.onPress;
    await act(async () => {
      press();
      press();
    });
    expect(mockMutation).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ data: {} });
    });
    expect(mockRefresh).toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  },
);

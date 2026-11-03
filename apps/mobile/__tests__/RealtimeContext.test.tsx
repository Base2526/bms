import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { RealtimeProvider } from '../src/state/RealtimeContext';
import type { MobileRealtimeStatus } from '../src/lib/realtime';

let mockStatus: MobileRealtimeStatus;
let mockEnabled = true;
const mockClient = { refetchQueries: jest.fn().mockResolvedValue([]) };
const mockVerify = jest.fn();
const mockTarget = { serverUrl: 'https://shop.example.com', token: 'token' };
jest.mock('@apollo/client', () => ({
  useApolloClient: () => mockClient,
  useQuery: () => ({ data: { bmsPosSession: { businessArchetype: 'general' } } }),
  useSubscription: () => ({}),
}));
jest.mock('../src/graphql/BmsGraphqlProvider', () => ({
  useBmsGraphqlTransport: () => ({ realtimeStatus: mockStatus }),
}));
jest.mock('../src/state/DeviceContext', () => ({
  useDevice: () => ({
    status: mockEnabled ? 'PAIRED' : 'UNPAIRED', target: mockTarget,
    verify: { kind: 'OK', info: { businessArchetype: 'general' } }, runVerify: mockVerify,
  }),
}));

describe('realtime HTTP reconciliation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockEnabled = true;
    mockClient.refetchQueries.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  test.each<MobileRealtimeStatus>(['connecting', 'reconnecting', 'offline', 'degraded'])(
    'refreshes authoritative reads every 30 seconds while %s', async status => {
      mockStatus = status;
      let tree!: ReactTestRenderer.ReactTestRenderer;
      await act(async () => { tree = ReactTestRenderer.create(<RealtimeProvider>{null}</RealtimeProvider>); });
      await act(async () => { jest.advanceTimersByTime(60_000); });
      expect(mockClient.refetchQueries).toHaveBeenCalledTimes(2);
      expect(mockClient.refetchQueries).toHaveBeenCalledWith({ include: 'active' });
      await act(async () => tree.unmount());
      await act(async () => { jest.advanceTimersByTime(30_000); });
      expect(mockClient.refetchQueries).toHaveBeenCalledTimes(2);
    },
  );

  test.each<MobileRealtimeStatus>(['connected', 'authentication_required'])(
    'does not schedule fallback polling while %s', async status => {
      mockStatus = status;
      let tree!: ReactTestRenderer.ReactTestRenderer;
      await act(async () => { tree = ReactTestRenderer.create(<RealtimeProvider>{null}</RealtimeProvider>); });
      mockClient.refetchQueries.mockClear(); // Connected performs one immediate reconciliation.
      await act(async () => { jest.advanceTimersByTime(60_000); });
      expect(mockClient.refetchQueries).not.toHaveBeenCalled();
      await act(async () => tree.unmount());
    },
  );
});

import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { ShiftProvider, useShift } from '../src/state/ShiftContext';
import { applyPosLanguage } from '../src/i18n/catalog';

let mockQueryData: any;

const mockMutation = jest.fn(),
  mockRefresh = jest.fn(),
  mockQueue = jest.fn();
jest.mock('@apollo/client', () => ({
  useQuery: () => ({ data: mockQueryData, refetch: mockRefresh }),
  useMutation: () => [mockMutation],
}));
jest.mock('../src/state/SessionContext', () => ({
  useSession: () => ({
    session: {
      branch: { id: 'branch' },
      cashier: { name: 'Staff' },
      credentials: { cashierUserId: 'staff', pin: '1234' },
    },
  }),
}));
jest.mock('../src/state/DeviceContext', () => ({
  useDevice: () => ({ target: { serverUrl: 'https://test.example' } }),
}));
jest.mock('../src/lib/offlineSales', () => ({
  loadOfflineSales: () => mockQueue(),
}));
let shift: ReturnType<typeof useShift>, tree: Renderer.ReactTestRenderer;
function Probe() {
  shift = useShift();
  return null;
}
beforeEach(async () => {
  jest.clearAllMocks();
  mockQueryData = undefined;
  applyPosLanguage('th');
  mockQueue.mockResolvedValue([]);
  mockRefresh.mockResolvedValue(undefined);
  await act(async () => {
    tree = Renderer.create(
      <ShiftProvider>
        <Probe />
      </ShiftProvider>,
    );
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
  applyPosLanguage('th');
});

test('cached movement times update after a language switch without a server mutation', async () => {
  mockQueryData = {
    bmsPosSession: { shift: { id: 'shift', status: 'OPEN' } },
    bmsPosShiftHistory: { shifts: [] },
    bmsPosShiftReport: { report: null },
    bmsPosCashMovements: { movements: [{ id: 'movement', direction: 'IN', amount: 50, reason: 'FAKE เหตุผล', createdAt: '2026-11-12T09:30:00Z' }] },
  };
  const time = jest.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(function (locale) { return String(locale); });
  try {
    await act(async () => tree.update(<ShiftProvider><Probe /></ShiftProvider>));
    expect(shift.movements[0].at).toBe('th-TH');
    await act(async () => applyPosLanguage('en'));
    expect(shift.movements[0].at).toBe('en-GB');
    expect(shift.movements[0].reason).toBe('FAKE เหตุผล');
    expect(mockMutation).not.toHaveBeenCalled();
  } finally { time.mockRestore(); }
});

test.each(['cash', 'open', 'close'])(
  'committed %s is successful even if follow-up reads fail',
  async action => {
    mockRefresh.mockRejectedValue(new Error('read failed'));
    mockMutation.mockResolvedValue({
      data: {
        bmsPosCashMovement: { status: 'RECORDED' },
        bmsPosShift: { status: action === 'open' ? 'OPENED' : 'CLOSED' },
      },
    });
    const result =
      action === 'cash'
        ? await shift.addMovement('IN', '50', 'Change', {}, 'key-1')
        : action === 'open'
        ? await shift.reopenShift(50)
        : await shift.closeShift('50');
    expect(result).toBeNull();
    expect(mockMutation).toHaveBeenCalledTimes(1);
  },
);

test('cash command and shift close cannot overlap before React rerenders', async () => {
  let finish!: (value: unknown) => void;
  mockMutation.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const first = shift.addMovement('IN', '50', 'Change', {}, 'key-1');
  expect(
    await shift.addMovement('IN', '50', 'Change', {}, 'key-1'),
  ).not.toBeNull();
  expect(await shift.closeShift('50')).not.toBeNull();
  expect(mockMutation).toHaveBeenCalledTimes(1);
  finish({ data: { bmsPosCashMovement: { status: 'RECORDED' } } });
  expect(await first).toBeNull();
});

test('offline queue failure keeps shift open and releases the command lock', async () => {
  mockQueue.mockRejectedValueOnce(new Error('locked storage'));
  expect(await shift.closeShift('50')).toContain('ยังปิดกะไม่ได้');
  expect(mockMutation).not.toHaveBeenCalled();
  mockMutation.mockResolvedValue({
    data: { bmsPosShift: { status: 'CLOSED' } },
  });
  expect(await shift.closeShift('50')).toBeNull();
});

test.each(['', '  ', '\t'])(
  'a blank cash count cannot close a shift: %j',
  async value => {
    mockMutation.mockResolvedValue({
      data: { bmsPosShift: { status: 'CLOSED' } },
    });
    expect(await shift.closeShift(value)).not.toBeNull();
    expect(mockMutation).not.toHaveBeenCalled();
    expect(await shift.closeShift('0')).toBeNull();
    expect(mockMutation).toHaveBeenCalledTimes(1);
  },
);

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useLazyQuery, useMutation } from '@apollo/client';
import { OfflineSalesProvider, useOfflineSales } from '../src/state/OfflineSalesContext';
import { loadOfflineSales, patchOfflineSale, removeOfflineSale } from '../src/lib/offlineSales';

jest.mock('@apollo/client', () => ({ useLazyQuery: jest.fn(), useMutation: jest.fn() }));
jest.mock('../src/i18n/language', () => ({ usePosLanguage: jest.fn(), posText: (text: string) => text }));
jest.mock('../src/lib/offlineSales', () => ({
  ...jest.requireActual('../src/lib/offlineSales'),
  loadOfflineSales: jest.fn(),
  patchOfflineSale: jest.fn(),
  putOfflineSale: jest.fn(),
  removeOfflineSale: jest.fn(),
}));
jest.mock('../src/state/DeviceContext', () => ({
  useDevice: () => ({ target: { serverUrl: 'https://shop.example.com' } }),
}));
jest.mock('../src/state/SessionContext', () => ({
  useSession: () => ({ session: {
    deviceId: 'device-1', branch: { id: 'branch-1' },
    cashier: { id: 'cashier-1', name: 'Cashier' },
    credentials: { cashierUserId: 'cashier-1', pin: '1234' },
  } }),
}));
jest.mock('../src/state/ShiftContext', () => ({
  useShift: () => ({ id: 'current-shift', isOpen: true }),
}));
jest.mock('../src/state/SalesContext', () => ({
  useSales: () => ({ refresh: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock('../src/state/ServerHealthContext', () => ({
  useServerHealth: () => ({ status: 'offline', markOffline: jest.fn() }),
}));

const recover = jest.fn().mockResolvedValue({ data: { bmsPosSaleRecovery: { status: 'EMPTY' } } });
const sell = jest.fn().mockResolvedValue({ data: { bmsPosSale: { status: 'SOLD' } } });

async function syncLegacyRow(shiftId?: string) {
  const row = {
    id: 'sale-1', serverUrl: 'https://shop.example.com', deviceId: 'device-1',
    branchId: 'branch-1', shiftId, cashierUserId: 'cashier-1',
    tenderedAt: '2026-11-01T00:00:00.000Z', total: 100,
    payload: { idempotencyKey: 'sale-1', offlineTenderedAt: '2026-11-01T00:00:00.000Z' },
    state: 'UNKNOWN', attempts: 0, lastError: null, updatedAt: '2026-11-01T00:00:00.000Z',
  };
  (loadOfflineSales as jest.Mock).mockResolvedValue([row]);
  (patchOfflineSale as jest.Mock).mockImplementation(async (_id, patch) => [{ ...row, ...patch }]);
  let offline!: ReturnType<typeof useOfflineSales>;
  function Probe() { offline = useOfflineSales(); return null; }
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { tree = ReactTestRenderer.create(<OfflineSalesProvider><Probe /></OfflineSalesProvider>); });
  await act(async () => { await offline.syncNow(); });
  await act(async () => tree.unmount());
}

beforeEach(() => {
  jest.clearAllMocks();
  recover.mockResolvedValue({ data: { bmsPosSaleRecovery: { status: 'EMPTY' } } });
  sell.mockResolvedValue({ data: { bmsPosSale: { status: 'SOLD' } } });
  (useLazyQuery as jest.Mock).mockReturnValue([recover]);
  (useMutation as jest.Mock).mockReturnValue([sell]);
  (removeOfflineSale as jest.Mock).mockResolvedValue([]);
});

test('recovery checks an old cash row but never posts it without the original shift ID', async () => {
  await syncLegacyRow();
  expect(recover).toHaveBeenCalledTimes(1);
  expect(sell).not.toHaveBeenCalled();
  expect(patchOfflineSale).toHaveBeenCalledWith('sale-1', expect.objectContaining({
    state: 'NEEDS_REVIEW', failureCode: 'SHIFT_ID_UNKNOWN',
  }));
});

test('an offline row still replays to its original open shift', async () => {
  await syncLegacyRow('current-shift');
  expect(recover).toHaveBeenCalledTimes(1);
  expect(sell).toHaveBeenCalledTimes(1);
  expect(removeOfflineSale).toHaveBeenCalledWith('sale-1');
});

function graphqlRefusal(code: string, message: string) {
  return Object.assign(new Error(message), {
    graphQLErrors: [{ message, extensions: { code } }],
  });
}

async function syncRows(rows: Array<Record<string, unknown>>, rounds = 1) {
  let stored = rows;
  (loadOfflineSales as jest.Mock).mockImplementation(async () => stored);
  (patchOfflineSale as jest.Mock).mockImplementation(async (id, patch) => {
    stored = stored.map(row => (row.id === id ? { ...row, ...patch } : row));
    return stored;
  });
  let offline!: ReturnType<typeof useOfflineSales>;
  function Probe() { offline = useOfflineSales(); return null; }
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { tree = ReactTestRenderer.create(<OfflineSalesProvider><Probe /></OfflineSalesProvider>); });
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => { await offline.syncNow(); });
  }
  await act(async () => tree.unmount());
  return stored;
}

function cashRow(id: string) {
  return {
    id, serverUrl: 'https://shop.example.com', deviceId: 'device-1',
    branchId: 'branch-1', shiftId: 'current-shift', cashierUserId: 'cashier-1',
    tenderedAt: '2026-11-01T00:00:00.000Z', total: 100,
    payload: { idempotencyKey: id, offlineTenderedAt: '2026-11-01T00:00:00.000Z' },
    state: 'UNKNOWN', attempts: 0, lastError: null, updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

test.each([
  ['FORBIDDEN', 'PIN ไม่ถูกต้อง'],
  ['UNAUTHENTICATED', 'device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว'],
])('a %s sign-in refusal is not a decision on the cash sale', async (code, message) => {
  recover.mockRejectedValue(graphqlRefusal(code, message));
  const stored = await syncRows([cashRow('sale-1'), cashRow('sale-2')], 2);
  // The server refused the cashier/device, not the sale: both rows stay automatically retryable.
  expect(stored.map(row => [row.id, row.state, row.failureCode ?? null])).toEqual([
    ['sale-1', 'UNKNOWN', null],
    ['sale-2', 'UNKNOWN', null],
  ]);
  expect(patchOfflineSale).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    failureCode: 'DECIDED_REJECTION',
  }));
  // One refused credential is not replayed against every queued row, nor again until sign-in.
  expect(recover).toHaveBeenCalledTimes(1);
  expect(sell).not.toHaveBeenCalled();
});

test('a sale refusal on the replay itself still goes to manager review', async () => {
  sell.mockRejectedValue(graphqlRefusal('BAD_USER_INPUT', 'ข้อมูลบิลไม่ถูกต้อง'));
  const stored = await syncRows([cashRow('sale-1')]);
  expect(stored[0]).toEqual(expect.objectContaining({ state: 'NEEDS_REVIEW', failureCode: 'DECIDED_REJECTION' }));
});

test('a committed legacy sale is recovered without needing its old shift ID', async () => {
  recover.mockResolvedValue({ data: { bmsPosSaleRecovery: { status: 'SOLD' } } });
  await syncLegacyRow();
  expect(sell).not.toHaveBeenCalled();
  expect(removeOfflineSale).toHaveBeenCalledWith('sale-1');
  expect(patchOfflineSale).not.toHaveBeenCalledWith('sale-1', expect.objectContaining({
    failureCode: 'SHIFT_ID_UNKNOWN',
  }));
});

import * as Keychain from 'react-native-keychain';
import {
  loadOfflineSales,
  patchOfflineSale,
  putOfflineSale,
  removeOfflineSale,
  type OfflineSaleRecord,
} from '../src/lib/offlineSales';

let mockStoredPassword: string | null = null;

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  getGenericPassword: jest.fn(async () =>
    mockStoredPassword
      ? { username: 'offline-sales', password: mockStoredPassword }
      : false,
  ),
  setGenericPassword: jest.fn(async (_username: string, password: string) => {
    mockStoredPassword = password;
    return true;
  }),
  resetGenericPassword: jest.fn(async () => {
    mockStoredPassword = null;
    return true;
  }),
}));

function record(id = 'offline-sale-1'): OfflineSaleRecord {
  return {
    id,
    serverUrl: 'https://shop.example.com',
    branchId: 'branch-1',
    cashierUserId: 'cashier-1',
    cashierName: 'Cashier One',
    tenderedAt: '2026-09-18T10:00:00.000Z',
    total: 100,
    state: 'STAGED',
    attempts: 0,
    lastError: null,
    updatedAt: '2026-09-18T10:00:00.000Z',
    payload: {
      idempotencyKey: id,
      offlineTenderedAt: '2026-09-18T10:00:00.000Z',
      mode: 'SALE',
      boardGameBillingGroupId: null,
      lines: [
        {
          sku: 'SKU-1',
          size: 'STD',
          packCode: null,
          packQty: 1,
          baseQty: null,
          packPrice: null,
          unitName: null,
          modifierCodes: [],
          scaleBarcode: null,
          serials: [],
        },
      ],
      payments: [
        {
          method: 'CASH',
          amount: 100,
          cashTendered: 100,
          ref: null,
        },
      ],
      pointsToRedeem: 0,
    },
  };
}

describe('offline sale secure queue', () => {
  beforeEach(() => {
    mockStoredPassword = null;
    jest.clearAllMocks();
  });

  test('persists, updates and removes a replayable request without a PIN', async () => {
    await putOfflineSale(record());

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'offline-sales',
      expect.any(String),
      expect.objectContaining({
        service: 'com.bms.pos.offline-sales.v1',
        accessible: 'AfterFirstUnlock',
      }),
    );
    expect(mockStoredPassword).not.toMatch(/pin/i);
    expect(JSON.parse(mockStoredPassword ?? '{}')).toMatchObject({
      version: 2,
      records: [
        {
          requestFingerprint: expect.stringMatching(/^fnv1a32:[0-9a-f]{8}$/),
        },
      ],
    });
    expect(await loadOfflineSales()).toHaveLength(1);

    await patchOfflineSale('offline-sale-1', {
      state: 'UNKNOWN',
      attempts: 1,
    });
    expect((await loadOfflineSales())[0]).toMatchObject({
      state: 'UNKNOWN',
      attempts: 1,
    });

    await removeOfflineSale('offline-sale-1');
    expect(await loadOfflineSales()).toEqual([]);
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
      service: 'com.bms.pos.offline-sales.v1',
    });
  });

  test('detects a changed request before it can be replayed', async () => {
    await putOfflineSale(record());
    const envelope = JSON.parse(mockStoredPassword ?? '{}');
    envelope.records[0].payload.payments[0].amount = 900;
    mockStoredPassword = JSON.stringify(envelope);

    await expect(loadOfflineSales()).rejects.toThrow(
      'อ่านคิวรายการออฟไลน์ไม่ได้',
    );
  });

  test('requires the integrity signal on a v2 queue', async () => {
    await putOfflineSale(record());
    const envelope = JSON.parse(mockStoredPassword ?? '{}');
    delete envelope.records[0].requestFingerprint;
    mockStoredPassword = JSON.stringify(envelope);

    await expect(loadOfflineSales()).rejects.toThrow(
      'อ่านคิวรายการออฟไลน์ไม่ได้',
    );
  });

  test('reads a legacy v1 record and upgrades it on the next write', async () => {
    mockStoredPassword = JSON.stringify({
      version: 1,
      records: [record(), record('offline-sale-2')],
    });

    expect(await loadOfflineSales()).toHaveLength(2);
    await patchOfflineSale('offline-sale-1', { state: 'SYNCING' });

    const upgraded = JSON.parse(mockStoredPassword ?? '{}');
    expect(upgraded.version).toBe(2);
    expect(upgraded.records).toEqual([
      expect.objectContaining({
        state: 'SYNCING',
        requestFingerprint: expect.stringMatching(/^fnv1a32:[0-9a-f]{8}$/),
      }),
      expect.objectContaining({
        id: 'offline-sale-2',
        requestFingerprint: expect.stringMatching(/^fnv1a32:[0-9a-f]{8}$/),
      }),
    ]);
  });
});

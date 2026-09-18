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

function record(): OfflineSaleRecord {
  return {
    id: 'offline-sale-1',
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
      idempotencyKey: 'offline-sale-1',
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
});

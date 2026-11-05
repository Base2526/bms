import * as Keychain from 'react-native-keychain';
import {
  clearPendingPurchaseReceipt,
  loadPendingPurchaseReceipt,
  purchaseReceiptScope,
  savePendingPurchaseReceipt,
} from '../src/lib/pendingPurchaseReceipt';
const mockStore = new Map<string, string>();
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  getGenericPassword: jest.fn(async ({ service }) =>
    mockStore.has(service) ? { password: mockStore.get(service) } : false,
  ),
  setGenericPassword: jest.fn(async (_user, password, { service }) => {
    mockStore.set(service, password);
    return true;
  }),
  resetGenericPassword: jest.fn(async ({ service }) => {
    mockStore.delete(service);
    return true;
  }),
}));
const receipt = {
  poId: 'po',
  branchId: 'branch',
  cashierUserId: 'cashier',
  idempotencyKey: 'request-key',
  items: [
    { sku: 'SKU', size: 'BASE', qty: 1, lotNo: 'A', expiryDate: '2027-01-01' },
  ],
};
beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});
test('journal isolates servers/devices and never persists a PIN or token', async () => {
  const scope = purchaseReceiptScope('https://shop.example', 'device');
  await savePendingPurchaseReceipt(scope, {
    ...receipt,
    pin: 'secret',
    token: 'secret',
  } as any);
  expect(await loadPendingPurchaseReceipt(scope)).toEqual(receipt);
  expect([...mockStore.values()].join()).not.toMatch(/secret|pin|token/);
  expect(
    await loadPendingPurchaseReceipt(
      purchaseReceiptScope('https://other.example', 'device'),
    ),
  ).toBeNull();
  expect(
    await loadPendingPurchaseReceipt(
      purchaseReceiptScope('https://shop.example', 'other'),
    ),
  ).toBeNull();
});
test('concurrent different requests cannot overwrite an unresolved receipt', async () => {
  const outcomes = await Promise.allSettled([
    savePendingPurchaseReceipt('scope', receipt),
    savePendingPurchaseReceipt('scope', {
      ...receipt,
      idempotencyKey: 'other',
    }),
  ]);
  expect(outcomes.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
  await expect(clearPendingPurchaseReceipt('scope', 'other')).rejects.toThrow();
  expect(await loadPendingPurchaseReceipt('scope')).toEqual(receipt);
  await clearPendingPurchaseReceipt('scope', receipt.idempotencyKey);
  expect(await loadPendingPurchaseReceipt('scope')).toBeNull();
});
test('corrupt or unavailable storage never becomes an empty journal', async () => {
  mockStore.set('scope', '{');
  await expect(loadPendingPurchaseReceipt('scope')).rejects.toThrow();
  await expect(savePendingPurchaseReceipt('scope', receipt)).rejects.toThrow();
  expect(mockStore.get('scope')).toBe('{');
  jest
    .mocked(Keychain.getGenericPassword)
    .mockRejectedValueOnce(new Error('locked'));
  await expect(loadPendingPurchaseReceipt('scope')).rejects.toThrow('locked');
});

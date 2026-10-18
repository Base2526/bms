import * as Keychain from 'react-native-keychain';
import { clearCustomerSession, loadCustomerSession, saveCustomerSession } from '../src/storage/secureStore';

const activation = {
  apiBaseUrl: 'http://127.0.0.1:4100',
  accessToken: 'a'.repeat(43),
  expiresAt: '2099-01-01T00:00:00.000Z',
  syntheticOnly: true as const,
};

test('customer session is stored device-only and excludes caller authority', async () => {
  await saveCustomerSession(activation);
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
    'customer-session-v1',
    JSON.stringify(activation),
    expect.objectContaining({ accessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' }),
  );
  expect(JSON.stringify(activation)).not.toContain('tenantRef');
  expect(JSON.stringify(activation)).not.toContain('bmsOrderRef');
});

test('customer session loader rejects expired and malformed stored state', async () => {
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce({
    username: 'customer-session-v1',
    password: JSON.stringify({ ...activation, expiresAt: '2020-01-01T00:00:00.000Z' }),
  });
  await expect(loadCustomerSession()).resolves.toEqual({ status: 'EXPIRED' });
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce({ username: 'x', password: '{}' });
  await expect(loadCustomerSession()).resolves.toEqual({
    status: 'UNAVAILABLE', error: 'Stored customer session is invalid',
  });
  await clearCustomerSession();
  expect(Keychain.resetGenericPassword).toHaveBeenCalled();
});

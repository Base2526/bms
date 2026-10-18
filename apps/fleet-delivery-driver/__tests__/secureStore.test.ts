import * as Keychain from 'react-native-keychain';
import {
  KeychainDriverCommandStore,
  driverSessionSchema,
  loadDriverSession,
  saveDriverSession,
} from '../src/storage/secureStore';

const validSession = {
  apiBaseUrl: 'https://driver.test.example',
  accessToken: 'test-token-with-minimum-length',
  tenantRef: 'tenant:test',
  branchRef: 'branch:test',
};

describe('secure driver storage', () => {
  beforeEach(() => jest.clearAllMocks());

  test('accepts HTTPS and loopback HTTP but rejects remote plaintext HTTP', () => {
    expect(driverSessionSchema.safeParse(validSession).success).toBe(true);
    expect(driverSessionSchema.safeParse({ ...validSession, apiBaseUrl: 'http://127.0.0.1:8080' }).success).toBe(true);
    expect(driverSessionSchema.safeParse({ ...validSession, apiBaseUrl: 'http://driver.test.example' }).success).toBe(false);
    expect(driverSessionSchema.safeParse({ ...validSession, apiBaseUrl: 'https://token@driver.test.example' }).success).toBe(false);
    expect(driverSessionSchema.safeParse({ ...validSession, apiBaseUrl: 'https://driver.test.example/path' }).success).toBe(false);
  });

  test('stores a validated session in OS secure storage', async () => {
    await saveDriverSession(validSession);
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'driver-session-v1',
      JSON.stringify(validSession),
      expect.objectContaining({ service: 'com.bms.delivery.driver.session.v1' }),
    );
  });

  test('fails closed for malformed stored session data', async () => {
    jest.mocked(Keychain.getGenericPassword).mockResolvedValueOnce({
      service: 'mock',
      storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
      username: 'driver-session-v1',
      password: JSON.stringify({ accessToken: 'leaked-shape' }),
    });
    await expect(loadDriverSession()).resolves.toEqual({
      status: 'UNAVAILABLE',
      error: 'Stored driver session is invalid',
    });
  });

  test('removes the secure queue when it becomes empty', async () => {
    const store = new KeychainDriverCommandStore();
    await store.save([]);
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
      service: 'com.bms.delivery.driver.queue.v1',
    });
  });
});

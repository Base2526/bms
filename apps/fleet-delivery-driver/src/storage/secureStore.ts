import * as Keychain from 'react-native-keychain';
import {
  driverOfflineCommandSchema,
  type DriverCommandStore,
  type DriverOfflineCommand,
} from '@bms/fleet-delivery-driver-core';
import { z } from 'zod';

const SESSION_SERVICE = 'com.bms.delivery.driver.session.v1';
const QUEUE_SERVICE = 'com.bms.delivery.driver.queue.v1';
const MAX_QUEUE_BYTES = 64 * 1024;

const refSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/);
export const driverSessionSchema = z.object({
  apiBaseUrl: z.string().url().refine(value => {
    const url = new URL(value);
    const transportAllowed = url.protocol === 'https:'
      || (url.protocol === 'http:' && url.hostname === '127.0.0.1');
    return transportAllowed
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === ''
      && (url.pathname === '' || url.pathname === '/');
  }, {
    message: 'Driver API requires a credential-free HTTPS origin or loopback development HTTP origin',
  }).transform(value => value.endsWith('/') ? value.slice(0, -1) : value),
  accessToken: z.string().min(16).max(8192),
  tenantRef: refSchema,
  branchRef: refSchema,
}).strict();

export type DriverSession = z.infer<typeof driverSessionSchema>;
export type SessionLoadResult =
  | { status: 'ACTIVE'; session: DriverSession }
  | { status: 'EMPTY' }
  | { status: 'UNAVAILABLE'; error: string };

const accessible = Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY;

export async function loadDriverSession(): Promise<SessionLoadResult> {
  try {
    const credentials = await Keychain.getGenericPassword({ service: SESSION_SERVICE });
    if (!credentials) return { status: 'EMPTY' };
    const parsed = driverSessionSchema.safeParse(JSON.parse(credentials.password));
    if (!parsed.success) return { status: 'UNAVAILABLE', error: 'Stored driver session is invalid' };
    return { status: 'ACTIVE', session: parsed.data };
  } catch (error) {
    return { status: 'UNAVAILABLE', error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveDriverSession(input: DriverSession): Promise<void> {
  const session = driverSessionSchema.parse(input);
  const stored = await Keychain.setGenericPassword('driver-session-v1', JSON.stringify(session), {
    service: SESSION_SERVICE,
    accessible,
  });
  if (!stored) throw new Error('SECURE_SESSION_WRITE_FAILED');
}

export async function clearDriverSession(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SESSION_SERVICE });
}

export class KeychainDriverCommandStore implements DriverCommandStore {
  async load(): Promise<unknown> {
    const credentials = await Keychain.getGenericPassword({ service: QUEUE_SERVICE });
    if (!credentials) return [];
    return z.array(driverOfflineCommandSchema).max(100).parse(JSON.parse(credentials.password));
  }

  async save(commands: readonly DriverOfflineCommand[]): Promise<void> {
    const checked = z.array(driverOfflineCommandSchema).max(100).parse(commands);
    if (checked.length === 0) {
      await Keychain.resetGenericPassword({ service: QUEUE_SERVICE });
      return;
    }
    const serialized = JSON.stringify(checked);
    // Command payloads are restricted to ASCII by their schemas, so character length
    // is also the encoded byte length and does not depend on a TextEncoder polyfill.
    if (serialized.length > MAX_QUEUE_BYTES) {
      throw new Error('DRIVER_SECURE_QUEUE_TOO_LARGE');
    }
    const stored = await Keychain.setGenericPassword('driver-queue-v1', serialized, {
      service: QUEUE_SERVICE,
      accessible,
    });
    if (!stored) throw new Error('SECURE_QUEUE_WRITE_FAILED');
  }

  async clear(): Promise<void> {
    await Keychain.resetGenericPassword({ service: QUEUE_SERVICE });
  }
}

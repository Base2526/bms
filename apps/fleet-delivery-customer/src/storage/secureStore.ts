import * as Keychain from 'react-native-keychain';
import { customerActivationSchema, type CustomerActivation } from '@bms/fleet-delivery-customer-core';

const SESSION_SERVICE = 'com.bms.delivery.customer.session.v1';
const accessible = Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY;

export type CustomerSessionLoadResult =
  | { status: 'ACTIVE'; session: CustomerActivation }
  | { status: 'EMPTY' }
  | { status: 'EXPIRED' }
  | { status: 'UNAVAILABLE'; error: string };

export async function loadCustomerSession(now = Date.now()): Promise<CustomerSessionLoadResult> {
  try {
    const credentials = await Keychain.getGenericPassword({ service: SESSION_SERVICE });
    if (!credentials) return { status: 'EMPTY' };
    const parsed = customerActivationSchema.safeParse(JSON.parse(credentials.password));
    if (!parsed.success) return { status: 'UNAVAILABLE', error: 'Stored customer session is invalid' };
    if (new Date(parsed.data.expiresAt).getTime() <= now) return { status: 'EXPIRED' };
    return { status: 'ACTIVE', session: parsed.data };
  } catch (error) {
    return { status: 'UNAVAILABLE', error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveCustomerSession(input: CustomerActivation): Promise<void> {
  const session = customerActivationSchema.parse(input);
  if (new Date(session.expiresAt).getTime() <= Date.now()) throw new Error('CUSTOMER_SESSION_EXPIRED');
  const stored = await Keychain.setGenericPassword('customer-session-v1', JSON.stringify(session), {
    service: SESSION_SERVICE,
    accessible,
  });
  if (!stored) throw new Error('SECURE_SESSION_WRITE_FAILED');
}

export async function clearCustomerSession(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SESSION_SERVICE });
}

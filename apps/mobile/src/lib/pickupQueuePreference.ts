import { useEffect, useState } from 'react';
import * as Keychain from 'react-native-keychain';

/**
 * Pickup queue numbers (`10.111`) — per-device switch, same storage pattern as the scanner
 * preference. Off by default: only a counter that hands out numbers turns it on. The PIN never
 * goes here.
 */
const SERVICE = 'com.bms.pos.pickup-queue.v1';
const USERNAME = 'pickup-queue-enabled';

let storageLock: Promise<unknown> = Promise.resolve();
let cached: boolean | null = null;
const listeners = new Set<(enabled: boolean) => void>();

export async function loadPickupQueueEnabled(): Promise<boolean> {
  try {
    await storageLock;
    const credentials = await Keychain.getGenericPassword({ service: SERVICE });
    cached = Boolean(
      credentials &&
        credentials.username === USERNAME &&
        credentials.password === '1',
    );
  } catch {
    // A preference must never block selling: unreadable storage means "off".
    cached = false;
  }
  return cached;
}

export async function savePickupQueueEnabled(enabled: boolean): Promise<void> {
  const write = storageLock.then(async () => {
    const stored = await Keychain.setGenericPassword(
      USERNAME,
      enabled ? '1' : '0',
      { service: SERVICE, accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK },
    );
    if (!stored) throw new Error('บันทึกการตั้งค่าเลขคิวไม่สำเร็จ');
  });
  storageLock = write.catch(() => undefined);
  await write;
  cached = enabled;
  for (const listener of listeners) listener(enabled);
}

/** Current switch value, kept in sync when Settings changes it. */
export function usePickupQueueEnabled(): boolean {
  const [enabled, setEnabled] = useState(cached ?? false);
  useEffect(() => {
    let alive = true;
    listeners.add(setEnabled);
    if (cached === null) {
      loadPickupQueueEnabled()
        .then(value => {
          if (alive) setEnabled(value);
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
      listeners.delete(setEnabled);
    };
  }, []);
  return enabled;
}

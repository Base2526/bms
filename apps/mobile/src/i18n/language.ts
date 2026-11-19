import { useSyncExternalStore } from 'react';
import * as Keychain from 'react-native-keychain';
import { type PosLanguage } from '../../../web/i18n/posClient';

export type { PosLanguage };
const SERVICE = 'com.bms.pos.language.v1';
let revision = 0;
let initialized = false;
let pendingLoad: Promise<void> | undefined;
let storageLock: Promise<unknown> = Promise.resolve();
export { getPosLanguage, posLocale, posText } from './catalog';
import { applyPosLanguage, getPosLanguage, subscribe } from './catalog';
export const usePosLanguage = () =>
  useSyncExternalStore(subscribe, getPosLanguage, getPosLanguage);

export function loadPosLanguage(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (pendingLoad) return pendingLoad;
  const startedAt = revision;
  pendingLoad = (async () => {
    try {
      await storageLock;
      const saved = await Keychain.getGenericPassword({ service: SERVICE });
      if (
        revision === startedAt &&
        saved &&
        saved.username === 'language' &&
        (saved.password === 'th' || saved.password === 'en')
      ) {
        applyPosLanguage(saved.password);
      }
    } catch {
      /* A display preference must not block register access. */
    } finally {
      initialized = true;
    }
  })();
  return pendingLoad;
}

/** Serialize writes so rapid changes persist in selection order; never touch device credentials. */
export async function setPosLanguage(next: PosLanguage): Promise<void> {
  if (next !== 'th' && next !== 'en') return;
  revision += 1;
  applyPosLanguage(next);
  const write = storageLock.then(async () => {
    const saved = await Keychain.setGenericPassword('language', next, {
      service: SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
    });
    if (!saved) throw new Error('Could not save language preference');
  });
  storageLock = write.catch(() => undefined);
  await write;
}

import * as Keychain from 'react-native-keychain';
import type { PairingTarget } from './pairing';

type DiagnosticStatus = 'success' | 'error' | 'warning' | 'info';

type DiagnosticContext = {
  route?: string;
  previousRoute?: string;
  online?: boolean;
  visibility?: string;
  digest?: string;
  errorName?: string;
  errorCode?: string;
  httpStatus?: number;
  durationMs?: number;
  appVersion?: string;
  platform?: string;
  viewport?: string;
  source?: string;
  retry?: number;
  sequence?: number;
  bundleVersion?: string;
};

type DiagnosticEvent = {
  eventId: string;
  occurredAt: string;
  category: string;
  action: string;
  status: DiagnosticStatus;
  message?: string;
  context?: DiagnosticContext;
};

const MAX_MESSAGE = 500;
const MAX_QUEUE_EVENTS = 25;
const SEND_TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 30_000;
const QUEUE_SERVICE = 'com.bms.pos.diagnostics';

let queueWork: Promise<void> = Promise.resolve();
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function uuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r % 4) + 8;
    return v.toString(16);
  });
}

function diagnosticsUrl(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/api/pos/diagnostics/events`;
}

function targetFingerprint(target: PairingTarget): string {
  const value = `${target.serverUrl}\n${target.token}`;
  let first = 17;
  let second = 29;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = (first * 31 + code) % 2_147_483_647;
    second = (second * 131 + code) % 2_147_483_629;
  }
  return `target-${first.toString(36)}-${second.toString(36)}`;
}

async function readQueue(target: PairingTarget): Promise<DiagnosticEvent[]> {
  const stored = await Keychain.getGenericPassword({ service: QUEUE_SERVICE });
  if (!stored || stored.username !== targetFingerprint(target)) return [];
  try {
    const parsed = JSON.parse(stored.password);
    return Array.isArray(parsed) ? parsed.slice(-MAX_QUEUE_EVENTS) : [];
  } catch {
    return [];
  }
}

async function writeQueue(
  target: PairingTarget,
  events: DiagnosticEvent[],
): Promise<void> {
  if (!events.length) {
    await Keychain.resetGenericPassword({ service: QUEUE_SERVICE });
    return;
  }
  await Keychain.setGenericPassword(
    targetFingerprint(target),
    JSON.stringify(events),
    {
      service: QUEUE_SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
    },
  );
}

async function sendBatch(
  target: PairingTarget,
  events: DiagnosticEvent[],
): Promise<'sent' | 'retry' | 'drop'> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetch(diagnosticsUrl(target.serverUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${target.token}`,
        'x-pos-device-token': target.token,
      },
      body: JSON.stringify({ events }),
    });
    if (response.ok) return 'sent';
    return response.status === 429 || response.status >= 500 ? 'retry' : 'drop';
  } catch {
    return 'retry';
  } finally {
    clearTimeout(timeout);
  }
}

function boundedQueue(events: DiagnosticEvent[]): DiagnosticEvent[] {
  if (events.length <= MAX_QUEUE_EVENTS) return events;
  return [events[0], ...events.slice(-(MAX_QUEUE_EVENTS - 1))];
}

function scheduleRetry(target: PairingTarget): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    queueWork = queueWork
      .then(async () => {
        const queued = await readQueue(target);
        if (!queued.length) return;
        const result = await sendBatch(target, queued);
        if (result === 'sent' || result === 'drop') {
          await writeQueue(target, []);
        } else {
          scheduleRetry(target);
        }
      })
      .catch(() => undefined);
  }, RETRY_DELAY_MS);
}

async function enqueueAndFlush(
  target: PairingTarget,
  payload: DiagnosticEvent,
): Promise<void> {
  let queued: DiagnosticEvent[];
  try {
    queued = boundedQueue([...(await readQueue(target)), payload]);
    await writeQueue(target, queued);
  } catch {
    await sendBatch(target, [payload]);
    return;
  }

  const result = await sendBatch(target, queued);
  if (result === 'sent' || result === 'drop') {
    await writeQueue(target, []);
  } else {
    scheduleRetry(target);
  }
}

export function recordPosDiagnosticEvent(
  target: PairingTarget | null | undefined,
  event: Omit<DiagnosticEvent, 'eventId' | 'occurredAt'>,
): void {
  if (!target) return;
  const payload: DiagnosticEvent = {
    eventId: uuidV4(),
    occurredAt: new Date().toISOString(),
    category: event.category,
    action: event.action,
    status: event.status,
    message: event.message?.slice(0, MAX_MESSAGE),
    context: event.context,
  };
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  queueWork = queueWork
    .then(() => enqueueAndFlush(target, payload))
    .catch(() => undefined);
}

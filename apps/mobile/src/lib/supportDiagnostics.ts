import * as Keychain from 'react-native-keychain';
import { Platform } from 'react-native';
import packageInfo from '../../package.json';
import { newPosAttemptId } from '../../../../packages/pos-client-core/src/connectionFailure';
import { isAllowedPosDiagnosticAction, safePosDiagnosticErrorCode,
  safePosDiagnosticReason, safePosDiagnosticRoute } from '../../../../packages/pos-client-core/src/diagnosticOperations';
import type { PairingTarget } from './pairing';
import { runWithOperationTimeout } from './operation';

type Status = 'success' | 'error' | 'warning' | 'info';
type Context = {
  cashierUserId?: string; route?: string; online?: boolean; errorName?: string;
  errorCode?: string; httpStatus?: number; durationMs?: number; appVersion?: string;
  platform?: string; source?: string; previousState?: string; nextState?: string;
  outcome?: 'unknown' | 'rejected' | 'read_failed'; serverResponded?: boolean;
  droppedCount?: number; gapFrom?: string; gapTo?: string;
  gapReason?: string;
  nativeCode?: string;
};
type Event = { eventId: string; occurredAt: string; category: 'pos'; action: string;
  status: Status; correlationId: string | null; context: Context;
  delivery?: 'pending' | 'rejected'; rejectReason?: string };
type Gap = { id: string; reason: string; count: number; from: string; to: string;
  delivery: 'pending' | 'delivered' | 'rejected'; rejectReason?: string };
type Queue = { events: Event[]; gaps: Gap[]; blockedReason: string | null };
type Store = { version: 2; targets: Record<string, Queue>; globalGaps: Gap[] };
type Ack = { results: Array<{ eventId: string | null; index: number;
  status: 'accepted' | 'duplicate' | 'rejected'; reason?: string }> };

const SERVICE = 'com.bms.pos.diagnostics';
const USER = 'bms-pos-diagnostics.v2';
const MAX_EVENTS = 25;
const MAX_TARGETS = 8;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let work: Promise<void> = Promise.resolve();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelayMs = 30_000;
let volatile: Store | null = null;
let storageError = false;

function empty(): Store { return { version: 2, targets: {}, globalGaps: [] }; }
function fingerprint(target: PairingTarget): string {
  const value = `${target.serverUrl}\n${target.token}`;
  let a = 17; let b = 29;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = (a * 31 + code) % 2_147_483_647;
    b = (b * 131 + code) % 2_147_483_629;
  }
  return `target-${a.toString(36)}-${b.toString(36)}`;
}
function gap(gaps: Gap[], event: Pick<Event, 'occurredAt'>, reason: string, count = 1) {
  const last = gaps.at(-1);
  if (last?.reason === reason && last.delivery === 'pending') { last.count += count; last.to = event.occurredAt; }
  else gaps.push({ id: newPosAttemptId(), reason, count, from: event.occurredAt, to: event.occurredAt, delivery: 'pending' });
  if (gaps.length > 30) {
    const removed = gaps.splice(0, gaps.length - 29);
    gaps.unshift({ id: newPosAttemptId(), reason: 'gap_summary_rotated', delivery: 'pending',
      count: removed.reduce((sum, item) => sum + item.count, 0),
      from: removed[0].from, to: removed.at(-1)!.to });
  }
}
function rotate(queue: Queue) {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const event of queue.events) if (Date.parse(event.occurredAt) < cutoff) gap(queue.gaps, event, 'local_retention');
  queue.events = queue.events.filter(event => Date.parse(event.occurredAt) >= cutoff);
  while (queue.events.length > MAX_EVENTS) gap(queue.gaps, queue.events.shift()!, 'local_capacity');
}
function ensure(store: Store, key: string): Queue {
  store.targets[key] ??= { events: [], gaps: [], blockedReason: null };
  while (Object.keys(store.targets).length > MAX_TARGETS) {
    const oldest = Object.keys(store.targets).find(candidate => candidate !== key)!;
    const removed = store.targets[oldest];
    for (const event of removed.events) gap(store.globalGaps, event, 'target_history_rotated');
    for (const item of removed.gaps) gap(store.globalGaps, { occurredAt: item.to }, 'target_history_rotated', item.count);
    delete store.targets[oldest];
  }
  return store.targets[key];
}
function safeContext(value: Context | undefined): Context {
  const result: Context = { source: 'native-pos', platform: Platform.OS, appVersion: packageInfo.version };
  if (!value) return result;
  const route = safePosDiagnosticRoute(value.route);
  if (route) result.route = route;
  if (typeof value.cashierUserId === 'string' && UUID.test(value.cashierUserId)) result.cashierUserId = value.cashierUserId;
  if (value.errorCode != null) result.errorCode = safePosDiagnosticErrorCode(value.errorCode);
  if (typeof value.errorName === 'string' && /^(?:Error|TypeError|AbortError|TimeoutError|NetworkError|FetchError|SyntaxError|ApolloError)$/.test(value.errorName)) result.errorName = value.errorName;
  if (typeof value.nativeCode === 'string' && /^-?\d{1,4}$/.test(value.nativeCode)) result.nativeCode = value.nativeCode;
  if (Number.isInteger(value.httpStatus) && value.httpStatus! >= 100 && value.httpStatus! <= 599) result.httpStatus = value.httpStatus;
  if (typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) && value.durationMs >= 0 && value.durationMs <= 120_000) result.durationMs = Math.round(value.durationMs);
  if (typeof value.online === 'boolean') result.online = value.online;
  if (typeof value.serverResponded === 'boolean') result.serverResponded = value.serverResponded;
  if (Number.isInteger(value.droppedCount) && value.droppedCount! > 0 && value.droppedCount! <= 1_000_000) result.droppedCount = value.droppedCount;
  for (const key of ['gapFrom', 'gapTo'] as const)
    if (typeof value[key] === 'string' && Number.isFinite(Date.parse(value[key]))) result[key] = new Date(value[key]).toISOString();
  if (safePosDiagnosticReason(value.gapReason)) result.gapReason = value.gapReason;
  if (value.outcome && ['unknown', 'rejected', 'read_failed'].includes(value.outcome)) result.outcome = value.outcome;
  for (const state of ['previousState', 'nextState'] as const)
    if (/^(?:unchecked|checking|online|offline|degraded|reconnecting|authentication_required)$/.test(value[state] ?? '')) result[state] = value[state];
  return result;
}
function safeEvent(input: { action: string; status: Status; correlationId?: string | null; context?: Context }): Event {
  const action = isAllowedPosDiagnosticAction(input.action) ? input.action : 'pos.unknown_operation';
  return { eventId: newPosAttemptId(), occurredAt: new Date().toISOString(), category: 'pos',
    action, status: input.status,
    correlationId: input.correlationId && UUID.test(input.correlationId) ? input.correlationId : null,
    context: safeContext(input.context), delivery: 'pending' };
}
function restored(value: unknown): Event | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Event;
  if (!UUID.test(item.eventId) || !Number.isFinite(Date.parse(item.occurredAt)) || !isAllowedPosDiagnosticAction(item.action)) return null;
  return { eventId: item.eventId, occurredAt: new Date(item.occurredAt).toISOString(), category: 'pos',
    action: item.action, status: ['success', 'warning', 'info'].includes(item.status) ? item.status : 'error',
    correlationId: item.correlationId && UUID.test(item.correlationId) ? item.correlationId : null,
    context: safeContext(item.context), delivery: item.delivery === 'rejected' ? 'rejected' : 'pending',
    rejectReason: safePosDiagnosticReason(item.rejectReason) ?? undefined };
}
function restoreEvents(values: unknown, gaps: Gap[]): Event[] {
  if (!Array.isArray(values)) return [];
  const events: Event[] = [];
  for (const value of values) {
    const event = restored(value);
    if (event) events.push(event);
    else gap(gaps, { occurredAt: new Date().toISOString() }, 'journal_invalid_event');
  }
  return events;
}
function restoreGaps(values: unknown, rejected: Gap[]): Gap[] {
  if (!Array.isArray(values)) return [];
  const output: Gap[] = [];
  for (const value of values) {
    const item = value as Gap;
    if (!item || !safePosDiagnosticReason(item.reason) || !Number.isInteger(item.count) ||
      item.count < 1 || !Number.isFinite(Date.parse(item.from)) || !Number.isFinite(Date.parse(item.to))) {
      gap(rejected, { occurredAt: new Date().toISOString() }, 'journal_invalid_gap');
      continue;
    }
    output.push({ id: UUID.test(item.id ?? '') ? item.id : newPosAttemptId(),
      reason: item.reason, count: item.count,
      from: new Date(item.from).toISOString(), to: new Date(item.to).toISOString(),
      delivery: item.delivery === 'delivered' || item.delivery === 'rejected' ? item.delivery : 'pending',
      rejectReason: safePosDiagnosticReason(item.rejectReason) ?? undefined });
  }
  while (output.length > 30) {
    const removed = output.shift()!;
    gap(rejected, { occurredAt: removed.to }, 'gap_summary_rotated', removed.count);
  }
  return output;
}
async function persistRecovered(store: Store): Promise<Store> {
  try { await write(store); } catch { storageError = true; volatile = store; }
  return store;
}
async function read(): Promise<Store> {
  if (volatile) return volatile;
  let saved: Awaited<ReturnType<typeof Keychain.getGenericPassword>>;
  try { saved = await Keychain.getGenericPassword({ service: SERVICE }); }
  catch {
    storageError = true;
    volatile = empty();
    gap(volatile.globalGaps, { occurredAt: new Date().toISOString() }, 'secure_storage_unavailable');
    return volatile;
  }
  if (!saved) return empty();
  try {
    const parsed = JSON.parse(saved.password);
    if (saved.username === USER && parsed?.version === 2 && parsed.targets && typeof parsed.targets === 'object') {
      const store = empty();
      for (const [key, data] of Object.entries(parsed.targets)) {
        if (!/^target-[a-z0-9-]{3,40}$/.test(key) || !data || typeof data !== 'object') {
          gap(store.globalGaps, { occurredAt: new Date().toISOString() }, 'journal_invalid_target');
          continue;
        }
        const row = data as Queue;
        const gaps = restoreGaps(row.gaps, store.globalGaps);
        store.targets[key] = { events: restoreEvents(row.events, gaps),
          gaps,
          blockedReason: safePosDiagnosticReason(row.blockedReason) };
        rotate(store.targets[key]);
        ensure(store, key);
      }
      if (Array.isArray(parsed.globalGaps)) {
        const restoredGlobal = restoreGaps(parsed.globalGaps, store.globalGaps);
        store.globalGaps.push(...restoredGlobal);
      }
      if (store.globalGaps.length > 30) {
        const removed = store.globalGaps.splice(0, store.globalGaps.length - 29);
        store.globalGaps.unshift({ id: newPosAttemptId(), reason: 'gap_summary_rotated',
          count: removed.reduce((sum, item) => sum + item.count, 0),
          from: removed[0].from, to: removed.at(-1)!.to, delivery: 'pending' });
      }
      return JSON.stringify(store) === saved.password ? store : persistRecovered(store);
    }
    // Original one-target array, stripped of all free-text messages during migration.
    if (Array.isArray(parsed) && /^target-[a-z0-9-]{3,40}$/.test(saved.username)) {
      const store = empty();
      const gaps: Gap[] = [];
      store.targets[saved.username] = { events: restoreEvents(parsed, gaps), gaps, blockedReason: null };
      rotate(store.targets[saved.username]);
      return persistRecovered(store);
    }
  } catch { /* Account for unreadable storage below. */ }
  const store = empty();
  gap(store.globalGaps, { occurredAt: new Date().toISOString() }, 'journal_unreadable');
  return persistRecovered(store);
}
async function write(store: Store) {
  await Keychain.setGenericPassword(USER, JSON.stringify(store), { service: SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK });
  volatile = null; storageError = false;
}
async function send(target: PairingTarget, events: Event[]): Promise<
  { kind: 'ack'; body: Ack } | { kind: 'blocked' | 'retry'; reason: string }
> {
  try {
    const response = await runWithOperationTimeout(signal => fetch(`${target.serverUrl.replace(/\/+$/, '')}/api/pos/diagnostics/events`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${target.token}`,
        'x-pos-device-token': target.token },
      body: JSON.stringify({ events: events.map(({ delivery: _delivery, rejectReason: _reason, ...item }) => item) }),
    }), 5_000);
    if (response.status === 401) return { kind: 'blocked', reason: 'token_rejected' };
    if (response.status === 403) return { kind: 'blocked', reason: 'permission_denied' };
    if (response.status === 429) return { kind: 'retry', reason: 'rate_limited' };
    if (response.status >= 500) return { kind: 'retry', reason: 'server_error' };
    if (!response.ok) return { kind: 'blocked', reason: 'payload_rejected' };
    const body = await runWithOperationTimeout(async () => response.json() as Promise<Ack>, 5_000);
    if (!Array.isArray(body?.results) || body.results.length !== events.length || body.results.some((row, index) =>
      row?.eventId !== events[index].eventId || row.index !== index || !['accepted', 'duplicate', 'rejected'].includes(row.status)))
      return { kind: 'blocked', reason: 'invalid_acknowledgement' };
    return { kind: 'ack', body };
  } catch { return { kind: 'retry', reason: 'network_or_timeout' }; }
}
function scheduleRetry(target: PairingTarget) {
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; work = work.then(() => flush(target)).catch(() => undefined); }, retryDelayMs);
  // Node contract tests should not stay alive solely for a background retry; RN timers have no unref.
  (retryTimer as unknown as { unref?: () => void }).unref?.();
  retryDelayMs = Math.min(retryDelayMs * 2, 300_000);
}
async function flush(target: PairingTarget) {
  const store = await read();
  const queue = ensure(store, fingerprint(target));
  const pendingGaps = queue.gaps.filter(item => item.delivery === 'pending').slice(0, MAX_EVENTS);
  const gapEvents: Event[] = pendingGaps.map(item => ({ eventId: item.id,
    occurredAt: new Date().toISOString(), category: 'pos', action: 'pos.diagnostic_gap',
    status: 'warning', correlationId: null, context: safeContext({ errorCode: 'POS_DIAGNOSTIC_GAP',
      source: 'native-pos', droppedCount: item.count, gapFrom: item.from, gapTo: item.to,
      gapReason: item.reason }), delivery: 'pending' }));
  const events = [...gapEvents, ...queue.events.filter(item => item.delivery === 'pending')
    .slice(0, MAX_EVENTS - gapEvents.length)];
  if (!events.length || queue.blockedReason) return;
  const result = await send(target, events);
  if (result.kind === 'ack') {
    const delivered = new Set<string>();
    result.body.results.forEach((row, index) => {
      const gapItem = pendingGaps.find(item => item.id === row.eventId);
      if (gapItem) {
        gapItem.delivery = row.status === 'accepted' || row.status === 'duplicate' ? 'delivered' : 'rejected';
        if (row.status === 'rejected') gapItem.rejectReason = safePosDiagnosticReason(row.reason) ?? 'server_rejected';
        return;
      }
      if (row.status === 'accepted' || row.status === 'duplicate') delivered.add(events[index].eventId);
      else { const event = queue.events.find(item => item.eventId === row.eventId);
        if (event) { event.delivery = 'rejected'; event.rejectReason = safePosDiagnosticReason(row.reason) ?? 'server_rejected'; } }
    });
    queue.events = queue.events.filter(item => !delivered.has(item.eventId));
    queue.blockedReason = null; retryDelayMs = 30_000;
  } else queue.blockedReason = result.kind === 'blocked' ? result.reason : null;
  try { await write(store); } catch { storageError = true; volatile = store; }
  if (result.kind === 'retry' || (result.kind === 'ack' &&
    (queue.gaps.some(item => item.delivery === 'pending') || queue.events.some(item => item.delivery === 'pending')))) scheduleRetry(target);
}
export function recordPosDiagnosticEvent(target: PairingTarget | null | undefined,
  event: { category: string; action: string; status: Status; message?: string;
    correlationId?: string | null; context?: Context }): void {
  if (!target) return;
  const item = safeEvent(event);
  work = work.then(async () => {
    const store = await read();
    const queue = ensure(store, fingerprint(target));
    queue.events.push(item); rotate(queue);
    try { await write(store); } catch { storageError = true; volatile = store; }
    // Pairing/verification evidence may describe an unverified server or token.
    // Wait for the paired health check to confirm this exact target before upload.
    if (item.action !== 'pos.device.verify') await flush(target);
  }).catch(() => { storageError = true; });
}
export async function retryPosDiagnosticUpload(target: PairingTarget | null | undefined): Promise<void> {
  if (!target) return;
  work = work.then(async () => {
    const store = await read();
    const queue = ensure(store, fingerprint(target));
    if (!queue.events.some(item => item.delivery === 'pending') && !queue.gaps.some(item => item.delivery === 'pending')) return;
    queue.blockedReason = null;
    await write(store); await flush(target);
  }).catch(() => { storageError = true; });
  await work;
}
export async function getPosDiagnosticSummary(target: PairingTarget | null | undefined) {
  await work;
  const store = await read().catch(() => { storageError = true; return volatile ?? empty(); });
  const queue = target ? store.targets[fingerprint(target)] : null;
  return { pending: (queue?.events.filter(item => item.delivery === 'pending').length ?? 0)
      + (queue?.gaps.filter(item => item.delivery === 'pending').length ?? 0),
    rejected: (queue?.events.filter(item => item.delivery === 'rejected').length ?? 0)
      + (queue?.gaps.filter(item => item.delivery === 'rejected').length ?? 0),
    blockedReason: queue?.blockedReason ?? null, storageError,
    gaps: [...(queue?.gaps ?? []), ...store.globalGaps], last: queue?.events.at(-1) ?? null,
    otherTargetCount: Object.keys(store.targets).length - (queue ? 1 : 0) };
}
/** Safe JSON text for the OS share sheet; old credentials appear only as opaque target IDs. */
export async function exportPosDiagnostics(): Promise<string> {
  await work;
  const store = await read().catch(() => { storageError = true; return volatile ?? empty(); });
  return JSON.stringify({ ...store, exportedAt: new Date().toISOString(), storageError }, null, 2);
}

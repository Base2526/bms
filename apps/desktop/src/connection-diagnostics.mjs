import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MAX_EVENTS = 500;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_GAPS = 100;
const VALID_CODES = new Set([
  'POS_AUTHENTICATION', 'POS_PERMISSION', 'POS_RATE_LIMIT', 'POS_TIMEOUT',
  'POS_CANCELLED', 'POS_SERVER', 'POS_VERSION', 'POS_PROTOCOL', 'POS_NETWORK',
  'POS_BUSINESS', 'POS_RECOVERED', 'POS_REALTIME', 'POS_UNKNOWN_ERROR',
  'POS_RENDERER', 'POS_RENDERER_CRASHED', 'POS_RENDERER_OOM', 'POS_RENDERER_KILLED',
  'POS_RENDERER_LAUNCH_FAILED', 'POS_RENDERER_INTEGRITY_FAILURE',
  'POS_RENDERER_ABNORMAL_EXIT',
]);
const VALID_REASONS = new Set([
  'local_retention', 'local_capacity', 'gap_summary_rotated', 'journal_invalid_event',
  'journal_invalid_gap', 'journal_unreadable', 'server_rejected', 'event_too_old',
  'clock_ahead', 'invalid_time', 'invalid_event', 'invalid_event_id', 'invalid_location',
  'invalid_device', 'invalid_category', 'invalid_action', 'invalid_status', 'invalid_correlation_id',
  'batch_limit', 'token_rejected', 'permission_denied', 'payload_rejected',
  'invalid_acknowledgement', 'rate_limited', 'server_error', 'network_or_timeout',
  'transport_failure',
]);
const POS_OPERATIONS = new Set(JSON.parse(readFileSync(new URL('./diagnostic-operations.json', import.meta.url), 'utf8')));
const POS_ACTIONS = new Set([
  'desktop.renderer.crash', 'desktop.navigation.failed', 'desktop.connection.recovered',
  'desktop.startup.failed', 'desktop.pairing.failed', 'desktop.api.request', 'restaurant.api.request',
  'restaurant.api.failed', 'restaurant.api.result',
]);
const POS_ROUTES = new Set([
  '/pos', '/pos/app', '/pos/restaurant', '/pos/manual', '/pos/display', '/pos/queue-board',
  '/api/graphql', '/api/pos', '/api/pos/session', '/api/pos/ar', '/api/pos/ar/collect',
  '/api/pos/blind-return', '/api/pos/board-game', '/api/pos/board-game/session',
  '/api/pos/cash-movement', '/api/pos/deposit', '/api/pos/expense',
  '/api/pos/kitchen/tickets', '/api/pos/kitchen/tickets/status', '/api/pos/last-sale',
  '/api/pos/member', '/api/pos/member/preview', '/api/pos/no-sale', '/api/pos/park',
  '/api/pos/pharmacy-evidence', '/api/pos/pharmacy-review', '/api/pos/purchase',
  '/api/pos/restaurant/checks', '/api/pos/scan', '/api/pos/recent-sales',
  '/api/pos/refund-settlement', '/api/pos/return', '/api/pos/sale', '/api/pos/search',
  '/api/pos/send-receipt', '/api/pos/shift-report', '/api/pos/shift-report/export',
  '/api/pos/shifts', '/api/pos/void',
  '/api/pos/restaurant/floor', '/api/pos/restaurant/incoming', '/api/pos/restaurant/menu',
  '/api/pos/restaurant/qr-orders', '/api/pos/restaurant/service-calls',
  '/api/pos/restaurant/waitlist', '/api/pos/shift', '/api/pos/support-diagnostics',
]);
const VALID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanEvent(input, platform, appVersion) {
  const operation = /^(?:graphql|network)\.([A-Za-z][A-Za-z0-9]*)$/.exec(input?.action ?? '');
  if (!input || !VALID_CODES.has(input.code)
    || !(POS_ACTIONS.has(input.action) || (operation && (operation[1] === 'Unknown' || POS_OPERATIONS.has(operation[1]))))) return null;
  const context = {
    errorCode: input.code,
    platform,
    appVersion,
    source: 'desktop-pos',
  };
  if (POS_ROUTES.has(input.route)) context.route = input.route;
  if (Number.isInteger(input.httpStatus) && input.httpStatus >= 100 && input.httpStatus <= 599) context.httpStatus = input.httpStatus;
  if (Number.isFinite(input.durationMs) && input.durationMs >= 0 && input.durationMs <= 120_000) context.durationMs = Math.round(input.durationMs);
  if (Number.isInteger(input.nativeCode) && input.nativeCode >= -9999 && input.nativeCode <= 9999) context.nativeCode = String(input.nativeCode);
  if (['unknown', 'rejected', 'read_failed'].includes(input.outcome)) context.outcome = input.outcome;
  if (['unchecked', 'checking', 'online', 'offline', 'degraded', 'reconnecting', 'authentication_required'].includes(input.previousState)) context.previousState = input.previousState;
  if (['unchecked', 'checking', 'online', 'offline', 'degraded', 'reconnecting', 'authentication_required'].includes(input.nextState)) context.nextState = input.nextState;
  if (typeof input.serverResponded === 'boolean') context.serverResponded = input.serverResponded;
  return {
    eventId: VALID_UUID.test(input.eventId ?? '') ? input.eventId : randomUUID(),
    occurredAt: new Date().toISOString(),
    category: 'pos',
    action: input.action,
    status: input.status === 'success' ? 'success' : input.status === 'warning' ? 'warning' : 'error',
    correlationId: VALID_UUID.test(input.correlationId ?? '') ? input.correlationId : null,
    context,
    targetKey: typeof input.targetKey === 'string' && /^[a-f0-9]{64}$/.test(input.targetKey) ? input.targetKey : null,
    delivery: 'pending',
  };
}

function restoreEvent(item, platform, appVersion) {
  if (!item || !Number.isFinite(Date.parse(item.occurredAt))) return null;
  const savedPlatform = /^(?:win32|linux|darwin)$/.test(item.context?.platform) ? item.context.platform : platform;
  const savedVersion = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][A-Za-z0-9][A-Za-z0-9.\-]{0,60})?$/.test(item.context?.appVersion)
    ? item.context.appVersion : appVersion;
  const clean = cleanEvent({ eventId: item.eventId, action: item.action, code: item.context?.errorCode,
    route: item.context?.route, httpStatus: item.context?.httpStatus, durationMs: item.context?.durationMs,
    nativeCode: Number(item.context?.nativeCode), outcome: item.context?.outcome,
    previousState: item.context?.previousState, nextState: item.context?.nextState,
    serverResponded: item.context?.serverResponded, correlationId: item.correlationId,
    targetKey: item.targetKey, status: item.status }, savedPlatform, savedVersion);
  if (!clean || clean.eventId !== item.eventId) return null;
  clean.occurredAt = new Date(item.occurredAt).toISOString();
  clean.delivery = item.delivery === 'rejected' ? 'rejected' : 'pending';
  if (clean.delivery === 'rejected') clean.rejectReason = VALID_REASONS.has(item.rejectReason)
    ? item.rejectReason : 'server_rejected';
  return clean;
}

function restoreGap(item) {
  if (!item || !VALID_REASONS.has(item.reason) || !Number.isInteger(item.count)
    || item.count < 1 || !Number.isFinite(Date.parse(item.from)) || !Number.isFinite(Date.parse(item.to))) return null;
  return { targetKey: /^[a-f0-9]{64}$/.test(item.targetKey ?? '') ? item.targetKey : null,
    reason: item.reason, count: item.count,
    from: new Date(item.from).toISOString(), to: new Date(item.to).toISOString() };
}

function addGap(state, event, reason) {
  const last = state.gaps.at(-1);
  if (last && last.targetKey === event.targetKey && last.reason === reason) {
    last.count += 1;
    last.to = event.occurredAt;
  } else {
    state.gaps.push({ targetKey: event.targetKey, reason, count: 1, from: event.occurredAt, to: event.occurredAt });
  }
  if (state.gaps.length > MAX_GAPS) {
    const overflow = state.gaps.splice(0, state.gaps.length - MAX_GAPS + 1);
    const count = overflow.reduce((sum, gap) => sum + gap.count, 0);
    state.gaps.unshift({ targetKey: null, reason: 'gap_summary_rotated', count,
      from: overflow[0].from, to: overflow.at(-1).to });
  }
}

function rotate(state) {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const event of state.events) {
    if (Date.parse(event.occurredAt) < cutoff) addGap(state, event, 'local_retention');
  }
  state.events = state.events.filter(event => Date.parse(event.occurredAt) >= cutoff);
  while (state.events.length > MAX_EVENTS) addGap(state, state.events.shift(), 'local_capacity');
}

/** Every write is an atomic, user-only file replace; no credential or free text enters this journal. */
export function createConnectionJournal({ filePath, platform, appVersion }) {
  let work = Promise.resolve();
  let loaded = null;
  let storageError = false;
  const empty = () => ({ version: 1, events: [], gaps: [] });
  const read = async () => {
    if (loaded) return loaded;
    let hadJournal = false;
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      hadJournal = true;
      if (!Array.isArray(parsed.events) || !Array.isArray(parsed.gaps)) throw new Error('invalid journal');
      loaded = { version: 1, events: [], gaps: [],
        lastUploadFailure: VALID_REASONS.has(parsed.lastUploadFailure) ? parsed.lastUploadFailure : null };
      for (const item of parsed.events) {
        const event = restoreEvent(item, platform, appVersion);
        if (event) loaded.events.push(event);
        else addGap(loaded, { targetKey: null, occurredAt: new Date().toISOString() }, 'journal_invalid_event');
      }
      for (const item of parsed.gaps) {
        const gap = restoreGap(item);
        if (gap) loaded.gaps.push(gap);
        else addGap(loaded, { targetKey: null, occurredAt: new Date().toISOString() }, 'journal_invalid_gap');
      }
      if (loaded.gaps.length > MAX_GAPS) {
        const overflow = loaded.gaps.splice(0, loaded.gaps.length - MAX_GAPS + 1);
        loaded.gaps.unshift({ targetKey: null, reason: 'gap_summary_rotated',
          count: overflow.reduce((sum, gap) => sum + gap.count, 0),
          from: overflow[0].from, to: overflow.at(-1).to });
      }
    } catch (error) {
      loaded = empty();
      if (error?.code !== 'ENOENT') {
        hadJournal = true;
        // Keep the damaged original for manual support recovery; the new journal reports the gap.
        try { await rename(filePath, `${filePath}.${Date.now()}.unreadable`); } catch {}
        loaded.gaps.push({ targetKey: null, reason: 'journal_unreadable', count: 1,
          from: new Date().toISOString(), to: new Date().toISOString() });
      }
    }
    rotate(loaded);
    // Commit sanitization and age rotation even when the app only opens the
    // recovery/export screen and no new event is appended.
    if (hadJournal) await save(loaded).catch(() => { storageError = true; });
    return loaded;
  };
  const save = async (state) => {
    let temp = null;
    try {
      await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      temp = `${filePath}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
      await rename(temp, filePath);
      temp = null;
      await chmod(filePath, 0o600);
      storageError = false;
    } catch (error) {
      if (temp) await rm(temp, { force: true }).catch(() => undefined);
      storageError = true; throw error;
    }
  };
  const transact = (operation) => {
    const result = work.then(async () => {
      const state = await read();
      const value = await operation(state);
      rotate(state);
      await save(state);
      return value;
    });
    work = result.catch(() => undefined);
    return result;
  };
  return {
    append(input) {
      return transact(state => {
        const event = cleanEvent(input, platform, appVersion);
        if (!event) return null;
        state.events.push(event);
        return { eventId: event.eventId, code: event.context.errorCode };
      });
    },
    summary() {
      return work.then(async () => {
        const state = await read();
        const last = state.events.at(-1);
        return { pending: state.events.filter(event => event.delivery === 'pending').length,
          rejected: state.events.filter(event => event.delivery === 'rejected').length,
          gaps: state.gaps, storageError, lastUploadFailure: state.lastUploadFailure ?? null,
          last: last ? { eventId: last.eventId, code: last.context.errorCode, occurredAt: last.occurredAt } : null };
      });
    },
    exportTo(destination) {
      return work.then(async () => {
        const state = await read();
        const output = { version: 1, exportedAt: new Date().toISOString(), appVersion, platform,
          events: state.events, gaps: state.gaps };
        output.lastUploadFailure = state.lastUploadFailure ?? null;
        output.storageError = storageError;
        await writeFile(destination, JSON.stringify(output, null, 2), { flag: 'w', mode: 0o600 });
        await chmod(destination, 0o600);
        return { events: state.events.length, gaps: state.gaps.length };
      });
    },
    async flush(targetKey, send) {
      return transact(async state => {
        const batch = state.events.filter(event => event.targetKey === targetKey && event.delivery === 'pending').slice(0, 50);
        if (!batch.length) return { pending: 0 };
        let response;
        try { response = await send(batch.map(({ targetKey: _targetKey, delivery: _delivery, ...event }) => event)); }
        catch (error) {
          state.lastUploadFailure = VALID_REASONS.has(error?.diagnosticReason)
            ? error.diagnosticReason : 'transport_failure';
          return { pending: batch.length, reason: state.lastUploadFailure };
        }
        if (!response || !Array.isArray(response.results) || response.results.length !== batch.length) {
          state.lastUploadFailure = 'invalid_acknowledgement';
          return { pending: batch.length, reason: state.lastUploadFailure };
        }
        if (response.results.some((result, index) => result?.index !== index
          || result?.eventId !== batch[index].eventId
          || !['accepted', 'duplicate', 'rejected'].includes(result.status))) {
          state.lastUploadFailure = 'invalid_acknowledgement';
          return { pending: batch.length, reason: state.lastUploadFailure };
        }
        state.lastUploadFailure = null;
        const delivered = new Set();
        response.results.forEach((result, index) => {
          if (result.eventId !== batch[index].eventId) return;
          if (result.status === 'accepted' || result.status === 'duplicate') delivered.add(result.eventId);
          else if (result.status === 'rejected') {
            const event = state.events.find(item => item.eventId === result.eventId);
            if (event) { event.delivery = 'rejected'; event.rejectReason = VALID_REASONS.has(result.reason) ? result.reason : 'server_rejected'; }
          }
        });
        state.events = state.events.filter(event => !delivered.has(event.eventId));
        return { pending: state.events.filter(event => event.targetKey === targetKey && event.delivery === 'pending').length,
          rejected: state.events.filter(event => event.targetKey === targetKey && event.delivery === 'rejected').length };
      });
    },
  };
}

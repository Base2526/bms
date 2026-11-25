import { describePosConnectionFailure, newPosAttemptId } from '@pos-core/connectionFailure';
import { safePosDiagnosticRoute } from '@pos-core/diagnosticOperations';

type Diagnostic = Parameters<NonNullable<NonNullable<Window['bmsDesktop']>['recordDiagnostic']>>[0];
const lastReadFailure = new Map<string, number>();
let currentTarget: string | null = null;
let failedRoute: string | null = null;

function report(input: Diagnostic, mutation: boolean, target: string) {
  const bridge = window.bmsDesktop;
  if (!bridge?.recordDiagnostic) return;
  const key = `${input.route}:${input.code}`;
  const now = Date.now();
  if (!mutation && input.status !== 'success' && now - (lastReadFailure.get(key) ?? 0) < 30_000) return;
  lastReadFailure.set(key, now);
  void (async () => {
    // Main attributes IPC events to the active pairing. Check it again just
    // before IPC so an old request cannot be attributed after token rotation.
    if (target && bridge.getDeviceToken && await bridge.getDeviceToken() !== target) return;
    await bridge.recordDiagnostic?.(input);
  })().catch(() => undefined);
}

/** Preserve the original fetch result and mutation key; diagnostics are a side effect only. */
export async function posDiagnosticFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof window === 'undefined' || !window.bmsDesktop?.recordDiagnostic) {
    return globalThis.fetch(input, init);
  }
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let url: URL;
  try { url = new URL(raw, window.location.href); }
  catch { return globalThis.fetch(input, init); }
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/pos/')) {
    return globalThis.fetch(input, init);
  }

  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const mutation = method !== 'GET' && method !== 'HEAD';
  const route = safePosDiagnosticRoute(url.pathname) ?? '/api/pos';
  const attemptId = newPosAttemptId();
  const startedAt = Date.now();
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const target = headers.get('x-pos-device-token') ?? '';
  if (target !== currentTarget) {
    currentTarget = target;
    failedRoute = null;
    lastReadFailure.clear();
  }
  headers.set('x-pos-attempt-id', attemptId);
  try {
    const response = await globalThis.fetch(input, { ...init, headers });
    // A paired target may change while an older request is still in flight. Its
    // outcome must never be journalled under the newly paired device.
    if (target !== currentTarget) return response;
    const serverResponded = response.headers.get('x-pos-attempt-id') === attemptId;
    const malformed = response.ok && /text\/html/i.test(response.headers.get('content-type') ?? '');
    if (!response.ok || malformed) {
      const failure = malformed
        ? describePosConnectionFailure({ code: 'INVALID_RESPONSE', httpStatus: response.status }, mutation)
        : describePosConnectionFailure({ httpStatus: response.status }, mutation);
      failedRoute = route;
      report({ action: 'desktop.api.request', code: failure.code, route,
        httpStatus: response.status, durationMs: Date.now() - startedAt,
        correlationId: attemptId, serverResponded, outcome: failure.outcome }, mutation, target);
    } else if (failedRoute === route && currentTarget === target) {
      failedRoute = null;
      report({ action: 'desktop.api.request', code: 'POS_RECOVERED', route,
        httpStatus: response.status, durationMs: Date.now() - startedAt,
        correlationId: attemptId, serverResponded, status: 'success',
        previousState: 'offline', nextState: 'online' }, false, target);
    }
    return response;
  } catch (error) {
    if (target !== currentTarget) throw error;
    const failure = describePosConnectionFailure(error, mutation);
    failedRoute = route;
    report({ action: 'desktop.api.request', code: failure.code, route,
      durationMs: Date.now() - startedAt, correlationId: attemptId,
      serverResponded: false, outcome: failure.outcome }, mutation, target);
    throw error;
  }
}

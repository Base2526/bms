import { runWithOperationTimeout } from '@pos-core/operation';
import { describePosConnectionFailure, newPosAttemptId, posTransportError } from '@pos-core/connectionFailure';
import { safePosDiagnosticRoute } from '@pos-core/diagnosticOperations';

const lastFailureAt = new Map<string, number>();
let hadFailure = false;
function reportDesktop(input: Parameters<NonNullable<NonNullable<Window['bmsDesktop']>['recordDiagnostic']>>[0], mutation = false) {
  if (typeof window === 'undefined' || !window.bmsDesktop?.recordDiagnostic) return;
  const key = `${input.route}:${input.code}`;
  const now = Date.now();
  if (!mutation && input.status !== 'success' && now - (lastFailureAt.get(key) ?? 0) < 30_000) return;
  lastFailureAt.set(key, now);
  void window.bmsDesktop.recordDiagnostic(input).catch(() => undefined);
}

/** Bound headers AND body, and never accept a proxy's HTML 200 as a successful command. */
export async function readPosJson(url: string, init: RequestInit = {}) {
  const mutation = !['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase());
  const attemptId = newPosAttemptId();
  const startedAt = Date.now();
  const pathname = new URL(url, 'http://pos.invalid').pathname;
  const safeRoute = safePosDiagnosticRoute(pathname) ?? '/api/pos';
  const action = 'restaurant.api.request';
  let httpStatus: number | null = null;
  let serverResponded = false;
  try {
    return await runWithOperationTimeout(async signal => {
      const headers = new Headers(init.headers);
      headers.set('x-pos-attempt-id', attemptId);
      const response = await fetch(url, { ...init, headers, signal });
      httpStatus = response.status;
      serverResponded = response.headers.get('x-pos-attempt-id') === attemptId;
      const body: unknown = await response.json().catch(() => null);
      if (response.ok && (!body || typeof body !== 'object' || Array.isArray(body))) {
        throw Object.assign(new Error(), { code: 'INVALID_RESPONSE', httpStatus: response.status });
      }
      if (response.ok) {
        const data = body as Record<string, unknown>;
        const pathname = new URL(url, 'http://pos.invalid').pathname;
        const requiredArrays: Record<string, string[]> = {
          '/api/pos/restaurant/floor': ['areas', 'tables'],
          '/api/pos/restaurant/waitlist': ['entries'],
          '/api/pos/restaurant/menu': ['items'],
          '/api/pos/kitchen/tickets': ['tickets'],
        };
        // A malformed read must not replace the last snapshot with an empty board or crash render.
        const arrays = !mutation || pathname === '/api/pos/restaurant/floor' ? requiredArrays[pathname] ?? [] : [];
        if (arrays.some(key => !Array.isArray(data[key])
          || (data[key] as unknown[]).some(row => !row || typeof row !== 'object' || Array.isArray(row)))) {
          throw Object.assign(new Error(), { code: 'INVALID_RESPONSE', httpStatus: response.status });
        }
      }
      if (!response.ok) {
        const failure = describePosConnectionFailure({ httpStatus: response.status }, mutation);
        hadFailure = true;
        reportDesktop({ action, code: failure.code, route: safeRoute, httpStatus,
          durationMs: Date.now() - startedAt, correlationId: attemptId, serverResponded,
          outcome: failure.outcome }, mutation);
      } else if (hadFailure) {
        reportDesktop({ action, code: 'POS_RECOVERED', route: safeRoute, httpStatus,
          durationMs: Date.now() - startedAt, correlationId: attemptId, serverResponded,
          previousState: 'offline', nextState: 'online', status: 'success' });
        hadFailure = false;
      }
      return { response, body: (body && typeof body === 'object' ? body : {}) as Record<string, any>, attemptId, serverResponded };
    }, undefined, init.signal);
  } catch (error) {
    const publicError = posTransportError(error, mutation);
    const failure = describePosConnectionFailure(publicError, mutation);
    hadFailure = true;
    reportDesktop({ action, code: failure.code, route: safeRoute, httpStatus,
      durationMs: Date.now() - startedAt, correlationId: attemptId, serverResponded,
      outcome: failure.outcome }, mutation);
    throw Object.assign(publicError, { attemptId, serverResponded });
  }
}

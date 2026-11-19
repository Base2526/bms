import { runWithOperationTimeout } from '@pos-core/operation';
import { posTransportError } from '@pos-core/connectionFailure';

/** Bound headers AND body, and never accept a proxy's HTML 200 as a successful command. */
export async function readPosJson(url: string, init: RequestInit = {}) {
  const mutation = !['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase());
  try {
    return await runWithOperationTimeout(async signal => {
      const response = await fetch(url, { ...init, signal });
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
      return { response, body: (body && typeof body === 'object' ? body : {}) as Record<string, any> };
    }, undefined, init.signal);
  } catch (error) {
    throw posTransportError(error, mutation);
  }
}

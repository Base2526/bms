let operationSequence = 0;

/** Unique per user intent. Keep the returned value and reuse it when retrying an unknown outcome. */
export function createIdempotencyKey(prefix: string): string {
  operationSequence = (operationSequence + 1) % 1_000_000;
  const random = Math.random().toString(36).slice(2, 12);
  return `${prefix}-${Date.now().toString(36)}-${operationSequence.toString(36)}-${random}`;
}

export function resultFailure(
  result: { status?: string | null; reason?: string | null } | null | undefined,
  fallback: string,
): string | null {
  if (!result) return fallback;
  return result.status === 'OK' || result.status === 'SUCCESS'
    ? null
    : result.reason ?? result.status ?? fallback;
}

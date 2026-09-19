export * from '../../../../packages/pos-client-core/src/operation';

export function resultFailure(
  result: { status?: string | null; reason?: string | null } | null | undefined,
  fallback: string,
): string | null {
  if (!result) return fallback;
  return result.status === 'OK' || result.status === 'SUCCESS'
    ? null
    : result.reason ?? result.status ?? fallback;
}

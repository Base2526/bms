/**
 * Did the server refuse this request for lack of permission?
 *
 * Reads the GraphQL `extensions.code` the server sets (`FORBIDDEN`), which connectionErrorLink
 * keeps intact. The Inventory screen used to look for posText("ไม่มีสิทธิ์") inside the message:
 * server messages stay Thai, so in English mode it searched for "No permission" and the
 * permission-denied panel never appeared (a Retry button looped instead). The Thai server wording is
 * still accepted for older servers that sent no code.
 */
export function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const graphQLErrors = (error as { graphQLErrors?: unknown }).graphQLErrors;
  if (Array.isArray(graphQLErrors)
    && graphQLErrors.some(item => (item as { extensions?: { code?: unknown } })?.extensions?.code === 'FORBIDDEN')) {
    return true;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('ไม่มีสิทธิ์');
}

import type { MobileRealtimeEventFieldsFragment } from '../graphql/generated';

export type MobileRealtimeStatus =
  | 'offline'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'degraded'
  | 'authentication_required';

export type MobileRealtimeEvent = MobileRealtimeEventFieldsFragment;

export interface RealtimeTicketResponse {
  ticket: string;
  expiresAt: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function graphqlHttpUrl(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/api/graphql`;
}

export function realtimeWsUrl(serverUrl: string): string {
  const base = serverUrl.replace(/\/+$/, '');
  if (base.startsWith('https://')) {
    return `wss://${base.slice('https://'.length)}/graphql`;
  }
  if (base.startsWith('http://')) {
    return `ws://${base.slice('http://'.length)}/graphql`;
  }
  return `wss://${base}/graphql`;
}

export function realtimeTicketUrl(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/api/bms/realtime/ticket?scope=pos`;
}

export function nativeWebSocketOptions(): {
  headers: Record<string, string>;
} {
  return { headers: { 'x-bms-client-class': 'native' } };
}

export function reconnectDelayMs(
  retryCount: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(1_000 * 2 ** Math.max(0, retryCount), 30_000);
  return Math.round(exponential * (0.75 + random() * 0.5));
}

export function isMobileRealtimeEvent(
  value: unknown,
): value is MobileRealtimeEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<MobileRealtimeEvent>;
  return (
    typeof event.eventId === 'string' &&
    UUID_RE.test(event.eventId) &&
    typeof event.eventType === 'string' &&
    typeof event.tenantId === 'string' &&
    UUID_RE.test(event.tenantId) &&
    typeof event.entityType === 'string' &&
    typeof event.entityId === 'string' &&
    typeof event.occurredAt === 'string'
  );
}

export class BoundedRealtimeDeduplicator {
  private seen = new Set<string>();

  constructor(private readonly limit = 1_024) {}

  accept(eventId: string): boolean {
    if (this.seen.has(eventId)) return false;
    this.seen.add(eventId);
    if (this.seen.size > this.limit) {
      const keep = [...this.seen].slice(-Math.ceil(this.limit / 2));
      this.seen = new Set(keep);
    }
    return true;
  }

  clear(): void {
    this.seen.clear();
  }
}

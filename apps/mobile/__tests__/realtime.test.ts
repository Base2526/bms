import {
  BoundedRealtimeDeduplicator,
  graphqlHttpUrl,
  isMobileRealtimeEvent,
  nativeWebSocketOptions,
  realtimeTicketUrl,
  realtimeWsUrl,
  reconnectDelayMs,
} from '../src/lib/realtime';

describe('mobile GraphQL realtime helpers', () => {
  test('derives HTTP, ticket and websocket URLs from the paired server', () => {
    expect(graphqlHttpUrl('https://bms.example/')).toBe(
      'https://bms.example/api/graphql',
    );
    expect(realtimeTicketUrl('https://bms.example/')).toBe(
      'https://bms.example/api/bms/realtime/ticket?scope=pos',
    );
    expect(realtimeWsUrl('http://10.0.2.2:3000/')).toBe(
      'ws://10.0.2.2:3000/graphql',
    );
  });

  test('marks the React Native websocket as a native client', () => {
    expect(nativeWebSocketOptions()).toEqual({
      headers: { 'x-bms-client-class': 'native' },
    });
  });

  test('uses bounded exponential backoff with jitter', () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(750);
    expect(reconnectDelayMs(0, () => 1)).toBe(1250);
    expect(reconnectDelayMs(20, () => 0)).toBe(22500);
    expect(reconnectDelayMs(20, () => 1)).toBe(37500);
  });

  test('accepts PostgreSQL UUID text without requiring RFC version bits', () => {
    const event = {
      eventId: '11111111-1111-1111-1111-111111111111',
      eventType: 'shift.changed',
      tenantId: '22222222-2222-2222-2222-222222222222',
      entityType: 'pos_shift',
      entityId: 'shift-1',
      occurredAt: '2026-09-12T00:00:00.000Z',
    };
    expect(isMobileRealtimeEvent(event)).toBe(true);
    expect(isMobileRealtimeEvent({ ...event, eventId: 'bad' })).toBe(false);
  });

  test('deduplicates within a bounded rolling window', () => {
    const seen = new BoundedRealtimeDeduplicator(4);
    expect(seen.accept('a')).toBe(true);
    expect(seen.accept('a')).toBe(false);
    for (const id of ['b', 'c', 'd', 'e']) expect(seen.accept(id)).toBe(true);
    expect(seen.accept('a')).toBe(true);
    seen.clear();
    expect(seen.accept('e')).toBe(true);
  });
});

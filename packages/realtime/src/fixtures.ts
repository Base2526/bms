import {
  REALTIME_SCHEMA_VERSION,
  type RealtimeEvent,
  type RealtimeEventType,
} from "./events.js";

const FIXTURE_ID = "11111111-1111-4111-8111-111111111111";

export function makeRealtimeEventFixture(
  eventType: RealtimeEventType = "order.status_changed",
  overrides: Partial<RealtimeEvent> = {},
): RealtimeEvent {
  return {
    eventId: FIXTURE_ID,
    eventType,
    schemaVersion: REALTIME_SCHEMA_VERSION,
    tenantId: "22222222-2222-4222-8222-222222222222",
    actorType: "SYSTEM",
    entityType: "order",
    entityId: "33333333-3333-4333-8333-333333333333",
    aggregateVersion: 1,
    occurredAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

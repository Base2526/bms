import {
  REALTIME_EVENT_RULES,
  type RealtimeAudience,
  type RealtimeEvent,
} from "./events.js";

const PREFIX = "bms:rt:v1";
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function segment(value: string, field: string): string {
  if (!SEGMENT.test(value)) throw new Error(`${field} is not a safe topic segment`);
  return value;
}

export type RealtimeTopicAudience =
  | { audience: "tenant"; tenantId: string }
  | { audience: "location"; tenantId: string; locationId: string }
  | { audience: "user"; tenantId: string; userId: string }
  | { audience: "device"; tenantId: string; locationId: string; deviceId: string };

export function topicForTenant(tenantId: string): string {
  return `${PREFIX}:tenant:${segment(tenantId, "tenantId")}`;
}

export function topicForLocation(tenantId: string, locationId: string): string {
  return `${topicForTenant(tenantId)}:location:${segment(locationId, "locationId")}`;
}

export function topicForUser(tenantId: string, userId: string): string {
  return `${topicForTenant(tenantId)}:user:${segment(userId, "userId")}`;
}

export function topicForDevice(tenantId: string, locationId: string, deviceId: string): string {
  return `${topicForLocation(tenantId, locationId)}:device:${segment(deviceId, "deviceId")}`;
}

export function topicForAudience(scope: RealtimeTopicAudience): string {
  switch (scope.audience) {
    case "tenant": return topicForTenant(scope.tenantId);
    case "location": return topicForLocation(scope.tenantId, scope.locationId);
    case "user": return topicForUser(scope.tenantId, scope.userId);
    case "device": return topicForDevice(scope.tenantId, scope.locationId, scope.deviceId);
  }
}

export function audienceForEvent(event: RealtimeEvent): RealtimeTopicAudience {
  const audience: RealtimeAudience = REALTIME_EVENT_RULES[event.eventType].audience;
  if (audience === "tenant") return { audience, tenantId: event.tenantId };
  if (audience === "location") {
    if (!event.locationId) throw new Error("locationId is required for a location event");
    return { audience, tenantId: event.tenantId, locationId: event.locationId };
  }
  if (audience === "user") {
    if (!event.userId) throw new Error("userId is required for a user event");
    return { audience, tenantId: event.tenantId, userId: event.userId };
  }
  if (!event.locationId || !event.deviceId) {
    throw new Error("locationId and deviceId are required for a device event");
  }
  return {
    audience,
    tenantId: event.tenantId,
    locationId: event.locationId,
    deviceId: event.deviceId,
  };
}

export function topicForEvent(event: RealtimeEvent): string {
  return topicForAudience(audienceForEvent(event));
}

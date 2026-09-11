export const REALTIME_SCHEMA_VERSION = 1 as const;

export const REALTIME_EVENT_TYPES = [
  "device.session.changed",
  "shift.changed",
  "pos.order.changed",
  "restaurant.floor.changed",
  "restaurant.check.created",
  "restaurant.check.updated",
  "restaurant.round.sent",
  "restaurant.ticket.created",
  "restaurant.ticket.status_changed",
  "restaurant.customer_request.created",
  "restaurant.customer_request.accepted",
  "restaurant.qr_submission.created",
  "restaurant.qr_submission.status_changed",
  "restaurant.table_call.created",
  "restaurant.table_call.status_changed",
  "restaurant.check.paid",
  "restaurant.check.cancelled",
  "menu.availability.changed",
  "waitlist.changed",
  "order.created",
  "order.status_changed",
  "order.paid",
  "order.cancelled",
  "order.fulfillment_changed",
  "order.line_cancelled",
  "payment.submitted",
  "payment.confirmed",
  "payment.rejected",
  "payment.refund_pending",
  "payment.refunded",
  "inventory.changed",
  "inventory.reservation_changed",
  "inventory.transfer.sent",
  "inventory.transfer.received",
  "inventory.count.applied",
  "purchase.received",
  "product.availability.changed",
  "inbox.conversation.changed",
  "inbox.message.created",
  "inbox.assignment.changed",
  "inbox.status.changed",
  "shipment.created",
  "shipment.status_changed",
  "shipment.booking_failed",
  "pharmacy.case.created",
  "pharmacy.case.status_changed",
  "pharmacy.case.assigned",
  "notification.created",
  "dashboard.invalidated",
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];
export type RealtimeActorType =
  | "SYSTEM"
  | "ADMIN"
  | "USER"
  | "POS_DEVICE"
  | "CUSTOMER"
  | "JOB"
  | "WEBHOOK";
export type RealtimeScalar = boolean | number | string | null;
export type RealtimePayload = Readonly<Record<string, RealtimeScalar>>;
export type RealtimeAudience = "tenant" | "location" | "user" | "device";

export interface RealtimeEvent {
  eventId: string;
  eventType: RealtimeEventType;
  schemaVersion: typeof REALTIME_SCHEMA_VERSION;
  tenantId: string;
  locationId?: string;
  userId?: string;
  actorType: RealtimeActorType;
  actorId?: string;
  deviceId?: string;
  entityType: string;
  entityId: string;
  aggregateVersion?: number;
  updatedAt?: string;
  occurredAt: string;
  payload?: RealtimePayload;
}

export interface RealtimeEventRule {
  audience: RealtimeAudience;
  permissions: readonly string[];
  allowedPayloadKeys: readonly string[];
}

const STATUS_PAYLOAD = ["status", "previousStatus", "change", "reasonCode", "source"] as const;
const location = (permissions: readonly string[]): RealtimeEventRule => ({
  audience: "location",
  permissions,
  allowedPayloadKeys: STATUS_PAYLOAD,
});
const tenant = (permissions: readonly string[]): RealtimeEventRule => ({
  audience: "tenant",
  permissions,
  allowedPayloadKeys: STATUS_PAYLOAD,
});

export const REALTIME_EVENT_RULES: Readonly<Record<RealtimeEventType, RealtimeEventRule>> = {
  "device.session.changed": { audience: "device", permissions: [], allowedPayloadKeys: STATUS_PAYLOAD },
  "shift.changed": location(["pos.shift.report"]),
  "pos.order.changed": location(["order.view"]),
  "restaurant.floor.changed": location(["restaurant.floor.manage"]),
  "restaurant.check.created": location(["order.view"]),
  "restaurant.check.updated": location(["order.view"]),
  "restaurant.round.sent": location(["order.view"]),
  "restaurant.ticket.created": location(["order.view"]),
  "restaurant.ticket.status_changed": location(["order.view"]),
  "restaurant.customer_request.created": location(["order.view"]),
  "restaurant.customer_request.accepted": location(["order.view"]),
  "restaurant.qr_submission.created": location(["order.view"]),
  "restaurant.qr_submission.status_changed": location(["order.view"]),
  "restaurant.table_call.created": location(["order.view"]),
  "restaurant.table_call.status_changed": location(["order.view"]),
  "restaurant.check.paid": location(["order.view"]),
  "restaurant.check.cancelled": location(["order.view"]),
  "menu.availability.changed": location(["product.view"]),
  "waitlist.changed": location(["restaurant.floor.manage"]),
  "order.created": location(["order.view"]),
  "order.status_changed": location(["order.view"]),
  "order.paid": location(["order.view"]),
  "order.cancelled": location(["order.view"]),
  "order.fulfillment_changed": location(["order.view"]),
  "order.line_cancelled": location(["order.view"]),
  "payment.submitted": location(["payment.view"]),
  "payment.confirmed": location(["payment.view"]),
  "payment.rejected": location(["payment.view"]),
  "payment.refund_pending": location(["payment.view"]),
  "payment.refunded": location(["payment.view"]),
  "inventory.changed": location(["product.view"]),
  "inventory.reservation_changed": location(["product.view"]),
  "inventory.transfer.sent": location(["inventory.transfer"]),
  "inventory.transfer.received": location(["inventory.transfer"]),
  "inventory.count.applied": location(["inventory.count"]),
  "purchase.received": location(["purchase.view"]),
  "product.availability.changed": tenant(["product.view"]),
  "inbox.conversation.changed": tenant(["inbox.view"]),
  "inbox.message.created": tenant(["inbox.view"]),
  "inbox.assignment.changed": tenant(["inbox.view"]),
  "inbox.status.changed": tenant(["inbox.view"]),
  "shipment.created": location(["shipping.view"]),
  "shipment.status_changed": location(["shipping.view"]),
  "shipment.booking_failed": location(["shipping.view"]),
  "pharmacy.case.created": tenant(["pharmacy.assessment.read"]),
  "pharmacy.case.status_changed": tenant(["pharmacy.assessment.read"]),
  "pharmacy.case.assigned": tenant(["pharmacy.assessment.read"]),
  "notification.created": { audience: "user", permissions: [], allowedPayloadKeys: ["source"] },
  "dashboard.invalidated": tenant(["report.view"]),
};

const DOMAIN_FLAG: Readonly<Record<string, string>> = {
  restaurant: "REALTIME_RESTAURANT_ENABLED",
  menu: "REALTIME_RESTAURANT_ENABLED",
  waitlist: "REALTIME_RESTAURANT_ENABLED",
  order: "REALTIME_ORDERS_ENABLED",
  payment: "REALTIME_PAYMENTS_ENABLED",
  inventory: "REALTIME_INVENTORY_ENABLED",
  purchase: "REALTIME_INVENTORY_ENABLED",
  product: "REALTIME_INVENTORY_ENABLED",
  inbox: "REALTIME_INBOX_ENABLED",
  shipment: "REALTIME_SHIPPING_ENABLED",
  pharmacy: "REALTIME_PHARMACY_ENABLED",
  notification: "REALTIME_ADMIN_ENABLED",
  dashboard: "REALTIME_ADMIN_ENABLED",
  pos: "REALTIME_POS_ENABLED",
  shift: "REALTIME_POS_ENABLED",
  device: "REALTIME_POS_ENABLED",
};

/** Server-side rollout gate. Missing flags fail closed and leave polling authoritative. */
export function isRealtimeEventEnabled(
  eventType: RealtimeEventType,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (env.REALTIME_SUBSCRIPTIONS_ENABLED !== "1") return false;
  const flag = DOMAIN_FLAG[eventType.split(".", 1)[0]];
  return Boolean(flag) && env[flag] === "1";
}

const EVENT_TYPE_SET = new Set<string>(REALTIME_EVENT_TYPES);
const ACTOR_TYPES = new Set<RealtimeActorType>([
  "SYSTEM", "ADMIN", "USER", "POS_DEVICE", "CUSTOMER", "JOB", "WEBHOOK",
]);
const ROOT_KEYS = new Set([
  "eventId", "eventType", "schemaVersion", "tenantId", "locationId", "userId", "actorType",
  "actorId", "deviceId", "entityType", "entityId", "aggregateVersion", "updatedAt", "occurredAt",
  "payload",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FORBIDDEN_PAYLOAD_KEY = /(name|email|phone|address|token|secret|password|pin|card|bank|prescription|clinical|evidence|attachment|file|message|body|note|raw|args)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function requireSafeId(value: unknown, field: string, uuid = false): asserts value is string {
  if (typeof value !== "string" || !(uuid ? UUID.test(value) : SAFE_ID.test(value))) {
    throw new RealtimeEventValidationError(`${field} is invalid`);
  }
}

export class RealtimeEventValidationError extends Error {
  readonly code = "INVALID_REALTIME_EVENT";

  constructor(message: string) {
    super(message);
    this.name = "RealtimeEventValidationError";
  }
}

export function validateRealtimeEvent(value: unknown): RealtimeEvent {
  if (!isRecord(value)) throw new RealtimeEventValidationError("event must be an object");
  for (const key of Object.keys(value)) {
    if (!ROOT_KEYS.has(key)) throw new RealtimeEventValidationError(`unknown event field: ${key}`);
  }

  requireSafeId(value.eventId, "eventId", true);
  if (typeof value.eventType !== "string" || !EVENT_TYPE_SET.has(value.eventType)) {
    throw new RealtimeEventValidationError("eventType is not registered");
  }
  if (value.schemaVersion !== REALTIME_SCHEMA_VERSION) {
    throw new RealtimeEventValidationError("schemaVersion is not supported");
  }
  requireSafeId(value.tenantId, "tenantId", true);
  requireSafeId(value.entityType, "entityType");
  requireSafeId(value.entityId, "entityId");
  if (typeof value.actorType !== "string" || !ACTOR_TYPES.has(value.actorType as RealtimeActorType)) {
    throw new RealtimeEventValidationError("actorType is invalid");
  }
  for (const field of ["locationId", "userId", "actorId", "deviceId"] as const) {
    if (value[field] !== undefined) requireSafeId(value[field], field);
  }
  if (!isIsoDate(value.occurredAt)) throw new RealtimeEventValidationError("occurredAt is invalid");
  if (value.updatedAt !== undefined && !isIsoDate(value.updatedAt)) {
    throw new RealtimeEventValidationError("updatedAt is invalid");
  }
  if (value.aggregateVersion !== undefined &&
      (!Number.isSafeInteger(value.aggregateVersion) || (value.aggregateVersion as number) < 0)) {
    throw new RealtimeEventValidationError("aggregateVersion must be a non-negative safe integer");
  }
  if (value.aggregateVersion === undefined && value.updatedAt === undefined) {
    throw new RealtimeEventValidationError("aggregateVersion or updatedAt is required");
  }

  const eventType = value.eventType as RealtimeEventType;
  const rule = REALTIME_EVENT_RULES[eventType];
  if (rule.audience === "location" && value.locationId === undefined) {
    throw new RealtimeEventValidationError("locationId is required for this event type");
  }
  if (rule.audience === "user" && value.userId === undefined) {
    throw new RealtimeEventValidationError("userId is required for this event type");
  }
  if (rule.audience === "device" && (value.locationId === undefined || value.deviceId === undefined)) {
    throw new RealtimeEventValidationError("locationId and deviceId are required for this event type");
  }

  if (value.payload !== undefined) {
    if (!isRecord(value.payload)) throw new RealtimeEventValidationError("payload must be an object");
    const entries = Object.entries(value.payload);
    if (entries.length > 8) throw new RealtimeEventValidationError("payload has too many fields");
    const allowed = new Set(rule.allowedPayloadKeys);
    for (const [key, item] of entries) {
      if (FORBIDDEN_PAYLOAD_KEY.test(key)) {
        throw new RealtimeEventValidationError(`payload field is sensitive: ${key}`);
      }
      if (!allowed.has(key)) throw new RealtimeEventValidationError(`payload field is not allowed: ${key}`);
      if (item !== null && !["boolean", "number", "string"].includes(typeof item)) {
        throw new RealtimeEventValidationError(`payload field must be scalar: ${key}`);
      }
      if (typeof item === "string" && item.length > 128) {
        throw new RealtimeEventValidationError(`payload string is too long: ${key}`);
      }
      if (typeof item === "number" && !Number.isFinite(item)) {
        throw new RealtimeEventValidationError(`payload number is invalid: ${key}`);
      }
    }
    if (JSON.stringify(value.payload).length > 1024) {
      throw new RealtimeEventValidationError("payload exceeds 1024 bytes");
    }
  }

  return value as unknown as RealtimeEvent;
}

export function safeRealtimeEventLog(event: RealtimeEvent): Record<string, RealtimeScalar | undefined> {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    tenantId: event.tenantId,
    locationId: event.locationId,
    userId: event.userId,
    deviceId: event.deviceId,
    entityType: event.entityType,
    entityId: event.entityId,
    aggregateVersion: event.aggregateVersion,
    occurredAt: event.occurredAt,
  };
}

export function safePubSubLogValue(value: unknown): Record<string, unknown> {
  const candidate = isRecord(value) && "realtimeEvent" in value ? value.realtimeEvent : value;
  try {
    return { realtimeEvent: safeRealtimeEventLog(validateRealtimeEvent(candidate)) };
  } catch {
    return {
      payloadType: Array.isArray(value) ? "array" : typeof value,
      payloadKeys: isRecord(value) ? Object.keys(value).slice(0, 16).sort() : [],
    };
  }
}

export class BoundedEventDeduplicator {
  readonly #maximumSize: number;
  readonly #seen = new Set<string>();
  readonly #order: string[] = [];

  constructor(maximumSize = 512) {
    if (!Number.isSafeInteger(maximumSize) || maximumSize < 1 || maximumSize > 10_000) {
      throw new Error("maximumSize must be an integer between 1 and 10000");
    }
    this.#maximumSize = maximumSize;
  }

  remember(eventId: string): boolean {
    requireSafeId(eventId, "eventId", true);
    if (this.#seen.has(eventId)) return false;
    this.#seen.add(eventId);
    this.#order.push(eventId);
    while (this.#order.length > this.#maximumSize) {
      const oldest = this.#order.shift();
      if (oldest) this.#seen.delete(oldest);
    }
    return true;
  }

  clear(): void {
    this.#seen.clear();
    this.#order.length = 0;
  }
}

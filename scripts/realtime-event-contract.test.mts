import assert from "node:assert/strict";
import test from "node:test";

import {
  BoundedEventDeduplicator,
  REALTIME_EVENT_RULES,
  REALTIME_EVENT_TYPES,
  RealtimeEventValidationError,
  audienceForEvent,
  isRealtimeEventEnabled,
  makeRealtimeEventFixture,
  publishRealtimeEvent,
  safePubSubLogValue,
  safeRealtimeEventLog,
  subscribeRealtimeEvents,
  topicForDevice,
  topicForEvent,
  topicForLocation,
  topicForTenant,
  topicForUser,
  validateRealtimeEvent,
} from "../packages/realtime/src/index.ts";

const LOCATION_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";
const DEVICE_ID = "66666666-6666-4666-8666-666666666666";

test("every event type has one central audience and permission rule", () => {
  assert.deepEqual(Object.keys(REALTIME_EVENT_RULES).sort(), [...REALTIME_EVENT_TYPES].sort());
  for (const type of REALTIME_EVENT_TYPES) {
    assert.ok(["tenant", "location", "user", "device"].includes(REALTIME_EVENT_RULES[type].audience));
    assert.ok(Array.isArray(REALTIME_EVENT_RULES[type].permissions));
  }
});

test("rollout flags fail closed and gate domains independently", () => {
  assert.equal(isRealtimeEventEnabled("order.created", {}), false);
  assert.equal(isRealtimeEventEnabled("order.created", {
    REALTIME_SUBSCRIPTIONS_ENABLED: "1",
    REALTIME_ORDERS_ENABLED: "1",
  }), true);
  assert.equal(isRealtimeEventEnabled("payment.confirmed", {
    REALTIME_SUBSCRIPTIONS_ENABLED: "1",
    REALTIME_ORDERS_ENABLED: "1",
    REALTIME_PAYMENTS_ENABLED: "0",
  }), false);
});

test("validates a minimal tenant invalidation and requires version or updatedAt", () => {
  const event = makeRealtimeEventFixture();
  assert.equal(validateRealtimeEvent(event), event);
  assert.throws(
    () => validateRealtimeEvent({ ...event, aggregateVersion: undefined }),
    (error: unknown) => error instanceof RealtimeEventValidationError && /aggregateVersion or updatedAt/.test(error.message),
  );
  assert.equal(
    validateRealtimeEvent({ ...event, aggregateVersion: undefined, updatedAt: event.occurredAt }).updatedAt,
    event.occurredAt,
  );
});

test("location, user, and device events cannot omit their server routing scope", () => {
  assert.throws(() => validateRealtimeEvent(makeRealtimeEventFixture("inventory.changed")), /locationId is required/);
  assert.throws(() => validateRealtimeEvent(makeRealtimeEventFixture("notification.created")), /userId is required/);
  assert.throws(() => validateRealtimeEvent(makeRealtimeEventFixture("device.session.changed")), /locationId and deviceId/);

  assert.equal(
    audienceForEvent(validateRealtimeEvent(makeRealtimeEventFixture("inventory.changed", { locationId: LOCATION_ID }))).audience,
    "location",
  );
  assert.equal(
    audienceForEvent(validateRealtimeEvent(makeRealtimeEventFixture("notification.created", { userId: USER_ID }))).audience,
    "user",
  );
  assert.equal(
    audienceForEvent(validateRealtimeEvent(makeRealtimeEventFixture("device.session.changed", {
      locationId: LOCATION_ID,
      deviceId: DEVICE_ID,
    }))).audience,
    "device",
  );
});

test("topic builders reject separators and use tenant-qualified narrow scopes", () => {
  const tenantId = makeRealtimeEventFixture().tenantId;
  assert.equal(topicForTenant(tenantId), `bms:rt:v1:tenant:${tenantId}`);
  assert.equal(topicForLocation(tenantId, LOCATION_ID), `bms:rt:v1:tenant:${tenantId}:location:${LOCATION_ID}`);
  assert.equal(topicForUser(tenantId, USER_ID), `bms:rt:v1:tenant:${tenantId}:user:${USER_ID}`);
  assert.equal(
    topicForDevice(tenantId, LOCATION_ID, DEVICE_ID),
    `bms:rt:v1:tenant:${tenantId}:location:${LOCATION_ID}:device:${DEVICE_ID}`,
  );
  assert.throws(() => topicForTenant(`${tenantId}:other`), /safe topic segment/);
  assert.equal(
    topicForEvent(validateRealtimeEvent(makeRealtimeEventFixture("inventory.changed", { locationId: LOCATION_ID }))),
    topicForLocation(tenantId, LOCATION_ID),
  );
});

test("payload accepts allowlisted scalar hints and rejects PII, health evidence, nesting, and unknown keys", () => {
  const base = makeRealtimeEventFixture("pharmacy.case.status_changed");
  assert.equal(validateRealtimeEvent({ ...base, payload: { status: "APPROVED" } }).payload?.status, "APPROVED");
  for (const payload of [
    { patientName: "person" },
    { clinicalNote: "detail" },
    { evidenceFileId: "file-1" },
    { phone: "0800000000" },
    { status: { nested: true } },
    { arbitrary: "value" },
  ]) {
    assert.throws(() => validateRealtimeEvent({ ...base, payload }), RealtimeEventValidationError);
  }
  assert.throws(() => validateRealtimeEvent({ ...base, tenant_id: base.tenantId }), /unknown event field/);
});

test("publish validates first and emits one standard wrapper on the narrow topic", async () => {
  const calls: Array<[string, unknown]> = [];
  const publisher = {
    async publish(topic: string, payload: unknown) {
      calls.push([topic, payload]);
      return 1;
    },
  };
  const event = makeRealtimeEventFixture("notification.created", { userId: USER_ID });
  await publishRealtimeEvent(publisher, event);
  assert.deepEqual(calls, [[topicForUser(event.tenantId, USER_ID), { realtimeEvent: event }]]);

  await assert.rejects(
    () => publishRealtimeEvent(publisher, { ...event, userId: undefined }),
    RealtimeEventValidationError,
  );
  assert.equal(calls.length, 1);
});

test("subscribe helper builds the topic from an authorized audience object", () => {
  const calls: string[] = [];
  const token = { async *[Symbol.asyncIterator]() {} };
  const subscriber = {
    asyncIterator<T>(topic: string | readonly string[]): AsyncIterable<T> {
      calls.push(String(topic));
      return token as AsyncIterable<T>;
    },
  };
  const tenantId = makeRealtimeEventFixture().tenantId;
  assert.equal(subscribeRealtimeEvents(subscriber, { audience: "location", tenantId, locationId: LOCATION_ID }), token);
  assert.deepEqual(calls, [topicForLocation(tenantId, LOCATION_ID)]);
});

test("safe logging never includes payload values or legacy payload contents", () => {
  const event = validateRealtimeEvent(makeRealtimeEventFixture("pharmacy.case.status_changed", {
    payload: { status: "APPROVED" },
  }));
  const safe = JSON.stringify(safeRealtimeEventLog(event));
  assert.doesNotMatch(safe, /APPROVED/);
  assert.doesNotMatch(safe, /payload/);

  const legacy = JSON.stringify(safePubSubLogValue({ phone: "0800000000", message: "secret" }));
  assert.doesNotMatch(legacy, /0800000000|secret/);
  assert.match(legacy, /payloadKeys/);
});

test("bounded deduplication forgets the oldest event and can be cleared on tenant/logout change", () => {
  const one = "11111111-1111-4111-8111-111111111111";
  const two = "22222222-2222-4222-8222-222222222222";
  const three = "33333333-3333-4333-8333-333333333333";
  const dedupe = new BoundedEventDeduplicator(2);
  assert.equal(dedupe.remember(one), true);
  assert.equal(dedupe.remember(one), false);
  assert.equal(dedupe.remember(two), true);
  assert.equal(dedupe.remember(three), true);
  assert.equal(dedupe.remember(one), true);
  dedupe.clear();
  assert.equal(dedupe.remember(three), true);
});

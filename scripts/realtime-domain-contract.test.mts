import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { REALTIME_EVENT_TYPES } from "../packages/realtime/src/events.ts";

const migration = readFileSync(
  new URL("../db/migrations/9.71__bms_realtime_domain_events.sql", import.meta.url),
  "utf8",
);
const purchase = readFileSync(new URL("../apps/web/lib/bms/purchase.ts", import.meta.url), "utf8");
const instrumentation = readFileSync(new URL("../apps/web/instrumentation.ts", import.meta.url), "utf8");
const nodeInstrumentation = readFileSync(new URL("../apps/web/instrumentation.node.ts", import.meta.url), "utf8");
const pump = readFileSync(new URL("../apps/web/lib/bms/realtimePump.ts", import.meta.url), "utf8");

const required = [
  "restaurant.check.created", "restaurant.check.updated", "restaurant.round.sent",
  "restaurant.ticket.created", "restaurant.ticket.status_changed",
  "restaurant.customer_request.created", "restaurant.customer_request.accepted",
  "restaurant.table_call.created", "restaurant.table_call.status_changed",
  "restaurant.check.paid", "restaurant.check.cancelled",
  "order.created", "order.status_changed", "order.paid", "order.cancelled",
  "order.fulfillment_changed", "order.line_cancelled",
  "payment.submitted", "payment.confirmed", "payment.rejected",
  "payment.refund_pending", "payment.refunded",
  "inventory.changed", "inventory.reservation_changed", "inventory.transfer.sent",
  "inventory.transfer.received", "inventory.count.applied", "purchase.received",
  "product.availability.changed", "menu.availability.changed",
  "inbox.conversation.changed", "inbox.message.created", "inbox.assignment.changed",
  "inbox.status.changed", "shipment.created", "shipment.status_changed",
  "shipment.booking_failed", "pharmacy.case.created", "pharmacy.case.status_changed",
  "pharmacy.case.assigned", "notification.created", "dashboard.invalidated",
] as const;

test("every supported production domain event is registered and installed at a transaction boundary", () => {
  for (const eventType of required) {
    assert.ok(REALTIME_EVENT_TYPES.includes(eventType), `${eventType} is not centrally registered`);
    assert.ok(migration.includes(`'${eventType}'`) || purchase.includes(`"${eventType}"`),
      `${eventType} has no transactional enqueue`);
  }
});

test("database triggers enqueue only; Redis publishing stays in the post-commit dispatcher", () => {
  assert.match(migration, /AFTER INSERT OR UPDATE/);
  assert.match(migration, /INSERT INTO public\.bms_realtime_outbox/);
  assert.doesNotMatch(migration, /pubsub\.publish|publishRealtimeEvent/i);
  assert.match(migration, /SECURITY DEFINER/g);
  assert.match(migration, /SET search_path = pg_catalog, public/g);
});

test("purchase receipt event is inserted with the same transaction before commit", () => {
  const enqueue = purchase.indexOf("await enqueueRealtimeEventInTx");
  const commit = purchase.indexOf('await client.query("COMMIT")', enqueue);
  assert.ok(enqueue >= 0 && commit > enqueue);
  assert.match(purchase.slice(enqueue, commit), /eventType: "purchase\.received"/);
  assert.match(purchase.slice(enqueue, commit), /locationId/);
});

test("pharmacy envelopes expose only case identity and safe lifecycle state", () => {
  const start = migration.indexOf("bms_realtime_pharmacy_trigger");
  const end = migration.indexOf("bms_realtime_restaurant_trigger", start);
  const pharmacy = migration.slice(start, end);
  assert.match(pharmacy, /jsonb_build_object\('status'/);
  assert.doesNotMatch(pharmacy, /raw_messages|medical_info|complaint|evidence|prescription|clinical|decision_reason/);
});

test("web instances continuously drain with a bounded backoff and fleet-safe claim function", () => {
  assert.match(instrumentation, /NEXT_RUNTIME === "nodejs"/);
  assert.match(instrumentation, /import\("\.\/instrumentation\.node"\)/);
  assert.match(nodeInstrumentation, /startRealtimeOutboxPump/);
  assert.match(pump, /REALTIME_OUTBOX_DISPATCH_ENABLED/);
  assert.match(pump, /REALTIME_OUTBOX_POLL_MS/);
  assert.match(pump, /Math\.min\(30_000/);
  assert.match(pump, /dispatchRealtimeOutboxBatch/);
});

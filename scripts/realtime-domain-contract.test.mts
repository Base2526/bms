import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { REALTIME_EVENT_TYPES } from "../packages/realtime/src/events.ts";

const migration = readFileSync(
  new URL("../db/migrations/9.71__bms_realtime_domain_events.sql", import.meta.url),
  "utf8",
);
const posTriggerSplitMigration = readFileSync(
  new URL("../db/migrations/9.74__bms_realtime_pos_trigger_split.sql", import.meta.url),
  "utf8",
);
const posDeviceHeartbeatFilterMigration = readFileSync(
  new URL("../db/migrations/9.84__bms_realtime_pos_device_heartbeat_filter.sql", import.meta.url),
  "utf8",
);
const remainingBusinessEventsMigration = readFileSync(
  new URL("../db/migrations/9.85__bms_realtime_remaining_business_events.sql", import.meta.url),
  "utf8",
);
const parkedSaleDeleteMigration = readFileSync(
  new URL("../db/migrations/9.86__bms_realtime_parked_sale_delete.sql", import.meta.url),
  "utf8",
);
const purchase = readFileSync(new URL("../apps/web/lib/bms/purchase.ts", import.meta.url), "utf8");
const instrumentation = readFileSync(new URL("../apps/web/instrumentation.ts", import.meta.url), "utf8");
const nodeInstrumentation = readFileSync(new URL("../apps/web/instrumentation.node.ts", import.meta.url), "utf8");
const pump = readFileSync(new URL("../apps/web/lib/bms/realtimePump.ts", import.meta.url), "utf8");
const dispatcher = readFileSync(new URL("../apps/web/lib/bms/realtimeDispatcher.ts", import.meta.url), "utf8");

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
  "payment.store_credit.changed", "payment.ar.changed",
  "inventory.changed", "inventory.reservation_changed", "inventory.transfer.sent",
  "inventory.transfer.received", "inventory.count.applied", "inventory.wastage.recorded",
  "purchase.received", "purchase.order.changed",
  "product.availability.changed", "menu.availability.changed",
  "inbox.conversation.changed", "inbox.message.created", "inbox.assignment.changed",
  "inbox.status.changed", "shipment.created", "shipment.status_changed",
  "shipment.booking_failed", "pharmacy.case.created", "pharmacy.case.status_changed",
  "pharmacy.case.assigned", "pharmacy.authorization.changed",
  "pos.return.changed", "pos.deposit.changed", "pos.expense.changed",
  "pos.no_sale.recorded", "pos.parked_sale.changed", "pos.petty_cash.changed",
  "order.tax_document.changed", "order.loyalty.changed",
  "notification.created", "dashboard.invalidated",
] as const;

test("every supported production domain event is registered and installed at a transaction boundary", () => {
  for (const eventType of required) {
    assert.ok(REALTIME_EVENT_TYPES.includes(eventType), `${eventType} is not centrally registered`);
    assert.ok(
      migration.includes(`'${eventType}'`)
        || remainingBusinessEventsMigration.includes(`'${eventType}'`)
        || purchase.includes(`"${eventType}"`),
      `${eventType} has no transactional enqueue`);
  }
});

test("remaining business triggers use one safe row-shape helper and restricted routing reads", () => {
  assert.match(remainingBusinessEventsMigration, /to_jsonb\(NEW\)/);
  assert.doesNotMatch(remainingBusinessEventsMigration, /\bNEW\.[a-z_]+/);
  assert.match(remainingBusinessEventsMigration, /SECURITY DEFINER/);
  assert.match(remainingBusinessEventsMigration, /SET search_path = pg_catalog, public/);
  assert.match(
    remainingBusinessEventsMigration,
    /GRANT SELECT \(id, tenant_id, location_id, device_id\)[\s\S]*ON public\.bms_pos_blind_returns TO bms_realtime_dispatcher/,
  );
  assert.match(
    remainingBusinessEventsMigration,
    /ALTER FUNCTION public\.bms_realtime_business_change_trigger\(\) OWNER TO bms_realtime_dispatcher/,
  );
  assert.doesNotMatch(
    remainingBusinessEventsMigration,
    /jsonb_build_object\([^)]*(amount|customer|note|reason|cart|evidence)/i,
  );
  assert.match(
    parkedSaleDeleteMigration,
    /CASE WHEN TG_OP = 'DELETE' THEN to_jsonb\(OLD\) ELSE to_jsonb\(NEW\) END/,
  );
  assert.match(
    parkedSaleDeleteMigration,
    /AFTER INSERT OR UPDATE OR DELETE ON public\.bms_pos_parked_sales/,
  );
  assert.doesNotMatch(parkedSaleDeleteMigration, /\b(?:NEW|OLD)\.[a-z_]+/);
  assert.doesNotMatch(
    parkedSaleDeleteMigration,
    /jsonb_build_object\([^)]*(amount|customer|note|reason|cart|evidence)/i,
  );
});

test("database triggers enqueue only; Redis publishing stays in the post-commit dispatcher", () => {
  assert.match(migration, /AFTER INSERT OR UPDATE/);
  assert.match(migration, /INSERT INTO public\.bms_realtime_outbox/);
  assert.doesNotMatch(migration, /pubsub\.publish|publishRealtimeEvent/i);
  assert.match(migration, /SECURITY DEFINER/g);
  assert.match(migration, /SET search_path = pg_catalog, public/g);
});

test("POS realtime triggers stay split by table row shape", () => {
  const deviceStart = posTriggerSplitMigration.indexOf(
    "CREATE OR REPLACE FUNCTION public.bms_realtime_pos_device_trigger()",
  );
  const shiftStart = posTriggerSplitMigration.indexOf(
    "CREATE OR REPLACE FUNCTION public.bms_realtime_pos_shift_trigger()",
  );
  const ownerStart = posTriggerSplitMigration.indexOf(
    "ALTER FUNCTION public.bms_realtime_pos_device_trigger()",
  );

  assert.ok(deviceStart >= 0, "POS device trigger function is missing");
  assert.ok(shiftStart > deviceStart, "POS shift trigger function is missing");
  assert.ok(ownerStart > shiftStart, "POS trigger ownership block is missing");

  const deviceFunction = posTriggerSplitMigration.slice(deviceStart, shiftStart);
  const shiftFunction = posTriggerSplitMigration.slice(shiftStart, ownerStart);

  assert.match(deviceFunction, /NEW\.active/);
  assert.doesNotMatch(deviceFunction, /NEW\.status|NEW\.device_id/);
  assert.match(deviceFunction, /SECURITY DEFINER/);
  assert.match(deviceFunction, /SET search_path = pg_catalog, public/);
  assert.match(shiftFunction, /NEW\.status/);
  assert.match(shiftFunction, /NEW\.device_id/);
  assert.doesNotMatch(shiftFunction, /NEW\.active/);
  assert.match(shiftFunction, /SECURITY DEFINER/);
  assert.match(shiftFunction, /SET search_path = pg_catalog, public/);
  assert.match(
    posTriggerSplitMigration,
    /ALTER FUNCTION public\.bms_realtime_pos_device_trigger\(\) OWNER TO bms_realtime_dispatcher/,
  );
  assert.match(
    posTriggerSplitMigration,
    /ALTER FUNCTION public\.bms_realtime_pos_shift_trigger\(\) OWNER TO bms_realtime_dispatcher/,
  );
  assert.match(
    posTriggerSplitMigration,
    /ON public\.bms_pos_devices[\s\S]*?EXECUTE FUNCTION public\.bms_realtime_pos_device_trigger\(\)/,
  );
  assert.match(
    posTriggerSplitMigration,
    /ON public\.bms_pos_shifts[\s\S]*?EXECUTE FUNCTION public\.bms_realtime_pos_shift_trigger\(\)/,
  );
  assert.match(
    posTriggerSplitMigration,
    /DROP FUNCTION IF EXISTS public\.bms_realtime_pos_scope_trigger\(\)/,
  );
});

test("POS device heartbeat and receipt counters do not invalidate RN GraphQL reads", () => {
  const triggerStart = posDeviceHeartbeatFilterMigration.indexOf(
    "CREATE TRIGGER trg_bms_realtime_device",
  );
  const triggerEnd = posDeviceHeartbeatFilterMigration.indexOf("COMMIT;", triggerStart);
  assert.ok(triggerStart >= 0 && triggerEnd > triggerStart, "filtered POS device trigger is missing");
  const trigger = posDeviceHeartbeatFilterMigration.slice(triggerStart, triggerEnd);

  assert.match(trigger, /AFTER INSERT OR UPDATE OF/);
  for (const field of [
    "location_id", "token_hash", "token_issued_at", "active", "scanner_mode",
  ]) {
    assert.match(trigger, new RegExp(`\\b${field}\\b`), `${field} must still invalidate the device session`);
  }
  assert.doesNotMatch(trigger, /\blast_seen_at\b/);
  assert.doesNotMatch(trigger, /\breceipt_seq\b/);
  assert.doesNotMatch(trigger, /\bupdated_at\b/);
  assert.match(
    trigger,
    /ON public\.bms_pos_devices[\s\S]*EXECUTE FUNCTION public\.bms_realtime_pos_device_trigger\(\)/,
  );
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
  // ตรึง "รอบหนึ่งของ pump ต้อง drain แล้วกวาดด้วย" ไม่ใช่ชื่อฟังก์ชัน · pump ที่เรียก
  // `dispatchRealtimeOutboxBatch` ตรง ๆ คือ pump ที่ข้าม retention — และไม่มีผู้เรียกอื่น
  // ของตัวกวาดเลย `REALTIME_RETENTION_SECONDS` จึงกลายเป็นนโยบายที่ไม่มีใครบังคับใช้
  assert.doesNotMatch(pump, /dispatchRealtimeOutboxBatch/);
  assert.match(pump, /result\.claimed > 0/);
  assert.doesNotMatch(pump, /postgresRealtimeOutboxRepository/);
  assert.match(dispatcher, /export async function runRealtimeOutboxMaintenance/);
  assert.match(dispatcher, /await dispatchRealtimeOutboxBatch\(\)/);
  // ⚠️ ห้าม assert แค่ `cleanupRealtimeOutbox\(\)` — มันแมตช์ **บรรทัดประกาศ** ของฟังก์ชันเอง
  // (`export async function cleanupRealtimeOutbox(): Promise<…>`) แล้วเขียวต่อให้ไม่มีใครเรียก
  // (มิวเทชัน M3 รอดไปเพราะรูปนั้น) · ต้องเล็งที่ "จุดที่เรียก"
  assert.match(dispatcher, /await cleanupRealtimeOutbox\(\)/);
});

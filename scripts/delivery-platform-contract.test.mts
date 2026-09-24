import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { DELIVERY_CAPABILITIES } from "../apps/web/lib/bms/deliveryPlatforms/capabilities";
import { normalizeFoodpandaOrder } from "../apps/web/lib/bms/deliveryPlatforms/foodpanda";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("delivery migration has tenant isolation, durable inbox/outbox, finance and leased workers", () => {
  const sql = read("db/migrations/10.12__bms_delivery_platform_foundation.sql");
  for (const table of [
    "bms_delivery_integrations", "bms_delivery_location_mappings", "bms_delivery_menu_mappings",
    "bms_delivery_orders", "bms_delivery_order_lines", "bms_delivery_order_modifiers",
    "bms_delivery_events", "bms_delivery_commands", "bms_delivery_intake_controls",
    "bms_delivery_order_events", "bms_delivery_handoffs", "bms_delivery_settlements",
    "bms_delivery_settlement_lines", "bms_delivery_adjustments", "bms_delivery_disputes",
    "bms_delivery_dispute_evidence",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
    assert.match(sql.slice(sql.indexOf("FOREACH t IN ARRAY")), new RegExp(`'${table}'`));
  }
  assert.match(sql, /ALTER TABLE %I FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /'PLATFORM_SETTLEMENT'/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/g);
  assert.match(sql, /bms_claim_delivery_events/);
  assert.match(sql, /bms_claim_delivery_commands/);
  assert.match(sql, /bms_claim_due_delivery_preparation/);
  assert.match(sql, /bms_claim_expired_delivery_acceptance/);
  assert.match(sql, /BYPASSRLS/);
  assert.match(sql, /location_mapping_id\s+UUID NOT NULL/);
  assert.match(sql, /acceptance_idempotency_key\s+TEXT/);
});

test("provider capabilities stay conservative and unavailable contracts fail closed", () => {
  assert.equal(DELIVERY_CAPABILITIES.FOODPANDA.webhookOrders, "VERIFIED");
  assert.equal(DELIVERY_CAPABILITIES.FOODPANDA.acceptOrder, "PARTNER_CONFIRMATION_REQUIRED");
  assert.equal(DELIVERY_CAPABILITIES.LINEMAN.webhookOrders, "NOT_PUBLIC");
  assert.match(read("apps/web/lib/bms/deliveryIntegrations.ts"), /DELIVERY_OFFICIAL_ORDER_LIFECYCLE_CONTRACT_REQUIRED/);
  const blocked = read("apps/web/lib/bms/deliveryPlatforms/blockedAdapter.ts");
  assert.match(blocked, /CONTRACT_BLOCKED/);
  assert.doesNotMatch(blocked, /fetch\(/);
});

test("foodpanda normalization rejects implicit currency and never invents provider idempotency headers", () => {
  const fixture = {
    order_id: "order-1", order_code: "A001", status: "RECEIVED", order_type: "DELIVERY",
    accepted_for: "2026-09-24T10:00:00Z",
    client: { store_id: "store-1" },
    payment: { sub_total: 100, order_total: 120 },
    items: [{ _id: "line-1", sku: "sku-1", name: "Meal", pricing: { quantity: 1, unit_price: 100 } }],
  };
  assert.equal(normalizeFoodpandaOrder(fixture).ok, false);
  const normalized = normalizeFoodpandaOrder(fixture, {
    environment: "SANDBOX", clientId: null, clientSecret: null, accessToken: "token",
    refreshToken: null, webhookSecret: "secret", apiVersion: "v2", config: { currency: "THB" },
  });
  assert.equal(normalized.ok, true);
  if (normalized.ok) {
    assert.equal(normalized.value.currency, "THB");
    assert.equal(normalized.value.items[0].providerItemId, "sku-1");
    assert.deepEqual(normalized.value.items[0].modifiers, []);
    assert.equal(normalized.value.acceptanceDeadlineAt, null);
    assert.equal(normalized.value.estimatedDeliveryAt, "2026-09-24T10:00:00.000Z");
  }
  assert.doesNotMatch(read("apps/web/lib/bms/deliveryPlatforms/foodpanda.ts"), /"Idempotency-Key"/);
});

test("webhook boundary derives tenant from integration and enforces auth, size and rate limits", () => {
  const route = read("apps/web/app/api/bms/delivery/[provider]/webhook/[integrationId]/route.ts");
  const service = read("apps/web/lib/bms/deliveryPlatforms/webhooks.ts");
  assert.match(route, /rateLimit\(/);
  assert.match(route, /256 \* 1024/);
  assert.match(route, /req\.arrayBuffer\(\)/);
  assert.match(service, /verifyWebhook/);
  assert.match(service, /integration\.tenant_id/);
  assert.doesNotMatch(route, /tenantId.*body/i);
  assert.match(service, /payload_hash/);
  assert.match(service, /sanitized_payload/);
  const migration = read("db/migrations/10.12__bms_delivery_platform_foundation.sql");
  const resolver = migration.slice(migration.indexOf("bms_resolve_delivery_webhook_integration"), migration.indexOf("bms_claim_delivery_events"));
  assert.doesNotMatch(resolver, /SELECT \*/);
  assert.doesNotMatch(resolver, /client_secret_encrypted|access_token_encrypted|refresh_token_encrypted/);
});

test("delivery order creation is atomic, mapping is VERIFIED-only and external calls stay outside it", () => {
  const events = read("apps/web/lib/bms/deliveryPlatforms/eventWorker.ts");
  assert.match(events, /mapping_status !== "VERIFIED"/);
  assert.match(events, /createOrderInTx/);
  assert.match(events, /'PLATFORM_SETTLEMENT'/);
  assert.match(events, /DELIVERY_PRICE_MISMATCH/);
  assert.match(events, /SCHEDULED_PREP_POLICY_REQUIRED/);
  const command = read("apps/web/lib/bms/deliveryPlatforms/commands.ts");
  assert.ok(command.indexOf("executeCommand(command)") < command.indexOf("finishCommand(command, result)"));
  assert.match(command, /delivery_intake_control/);
  assert.match(command, /sync_status = 'MANUAL_PROVIDER_ACTION_REQUIRED'/);
});

test("POS delivery mutations re-derive branch, permission and idempotency on the server", () => {
  const route = read("apps/web/app/api/pos/restaurant/incoming/route.ts");
  const operations = read("apps/web/lib/bms/deliveryPlatforms/orderOperations.ts");
  const posPage = read("apps/web/app/(pos)/pos/page.tsx");
  assert.match(route, /auth\.device\.locationId/);
  assert.match(route, /auth\.device\.id/);
  assert.match(route, /restaurant\.delivery\.handoff/);
  assert.match(operations, /restaurant\.kitchen\.update/);
  assert.match(operations, /restaurant\.delivery\.handoff/);
  assert.match(operations, /shipOrderInTx/);
  assert.match(operations, /IDEMPOTENCY_CONFLICT/);
  assert.match(operations, /bms_delivery_handoffs/);
  const ordering = read("apps/web/lib/bms/restaurantOrdering.ts");
  assert.match(ordering, /acceptance_idempotency_key/);
  assert.match(ordering, /accepted_device_id/);
  assert.match(ordering, /IDEMPOTENCY_CONFLICT/);
  assert.match(posPage, /rejectIncomingOrder/);
  assert.match(posPage, /order\.items\.map/);
  assert.match(posPage, /provider tablet/);
});

test("provider lifecycle changes invalidate every register without making realtime authoritative", () => {
  const events = read("apps/web/lib/bms/deliveryPlatforms/eventWorker.ts");
  const commands = read("apps/web/lib/bms/deliveryPlatforms/commands.ts");
  const operations = read("apps/web/lib/bms/deliveryPlatforms/orderOperations.ts");
  const restaurant = read("apps/web/app/(pos)/pos/restaurant/page.tsx");
  for (const source of [events, commands, operations]) {
    assert.match(source, /enqueueRealtimeEventInTx/);
    assert.match(source, /order\.fulfillment_changed/);
  }
  assert.match(restaurant, /"order\.fulfillment_changed"/);
  assert.match(restaurant, /polling.*reconciliation path/);
});

test("platform money is server-only and delivery channels bypass parcel carriers without entering AI tools", () => {
  const payments = read("apps/web/lib/bms/payments.ts");
  const checkout = read("apps/web/lib/bms/checkout.ts");
  const tools = read("apps/web/lib/bms/tools/catalog.ts");
  const pos = read("apps/web/lib/bms/pos.ts");
  const settlements = read("apps/web/lib/bms/deliverySettlements.ts");
  const shipping = read("apps/web/lib/bms/shipping.ts");
  assert.doesNotMatch(payments, /PLATFORM_SETTLEMENT/);
  assert.doesNotMatch(checkout, /PLATFORM_SETTLEMENT/);
  assert.doesNotMatch(tools, /PLATFORM_SETTLEMENT/);
  assert.match(pos, /PROVIDER_CONFIRMATION_REQUIRED/);
  assert.match(settlements, /PROVIDER_REFUND_CONFIRMED/);
  for (const channel of ["grabfood", "lineman", "foodpanda"]) assert.match(shipping, new RegExp(`"${channel}"`));
});

test("all delivery cron routes fail closed and are visible in the repository scheduler", () => {
  for (const file of [
    "events/process", "commands/process", "intake/auto-resume", "scheduled-preparation", "acceptance-timeout",
  ]) {
    const route = read(`apps/web/app/api/bms/delivery/${file}/route.ts`);
    assert.match(route, /authorizeCronRequest\(req\)/);
    assert.match(route, /recordJobRun\(/);
  }
  const workflow = read(".github/workflows/bms-cron.yml");
  for (const name of ["delivery-events-process", "delivery-commands-process", "delivery-intake-auto-resume", "delivery-scheduled-preparation", "delivery-acceptance-timeout"]) {
    assert.match(workflow, new RegExp(name));
  }
});

test("admin operations, action center and finance reconciliation are tenant-scoped and permission-gated", () => {
  const page = read("apps/web/app/(admin)/admin/delivery-platforms/page.tsx");
  const financeRoute = read("apps/web/app/api/bms/delivery/settlements/route.ts");
  const finance = read("apps/web/lib/bms/deliverySettlements.ts");
  const operations = read("apps/web/lib/bms/deliveryOperations.ts");
  const actions = read("apps/web/lib/bms/actionCenter.ts");
  assert.match(page, /delivery\.integration\.view/);
  assert.match(page, /delivery\.settlement\.view/);
  assert.match(financeRoute, /authorizeAdminRoute\("delivery\.settlement\.view"\)/);
  assert.match(financeRoute, /delivery\.dispute\.manage/);
  assert.match(finance, /beginTenantTx\(client, input\.tenantId/);
  assert.match(finance, /MISSING_SETTLEMENT/);
  assert.match(finance, /delivery\.adjustment_recorded/);
  assert.match(page, /record_adjustment/);
  assert.match(page, /create_dispute/);
  assert.match(page, /transition_dispute/);
  assert.match(operations, /beginTenantTx\(client, tenantId/);
  assert.match(operations, /sanitized_payload->>'providerOrderId'/);
  assert.doesNotMatch(operations, /e\.provider_order_id/);
  assert.match(actions, /collectDeliverySignals/);
});

test("late acceptance is blocked without inventing provider reject or refund semantics", () => {
  const timeout = read("apps/web/lib/bms/deliveryPlatforms/acceptanceTimeout.ts");
  const ordering = read("apps/web/lib/bms/restaurantOrdering.ts");
  assert.match(timeout, /local_status='ACTION_REQUIRED'/);
  assert.match(timeout, /reservationReleased: false/);
  assert.doesNotMatch(timeout, /cancelOrderInTx|processPosReturn|enqueueDeliveryCommandInTx/);
  assert.match(ordering, /ACCEPTANCE_EXPIRED/);
  assert.match(ordering, /acceptance_deadline_at/);
});

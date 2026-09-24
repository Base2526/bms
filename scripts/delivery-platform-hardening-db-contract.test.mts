// Writes only one throwaway tenant. Run against a local migrated test database, never production.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { encryptSecret } from "../apps/web/lib/bms/crypto.ts";
import { processClaimedDeliveryEvent } from "../apps/web/lib/bms/deliveryPlatforms/eventWorker.ts";
import { intakeDeliveryWebhook } from "../apps/web/lib/bms/deliveryPlatforms/webhooks.ts";
import { DECLARE_FAKE_SALES_SURFACES_SQL } from "./testing/salesSurfaces.mts";

type Claimed = Parameters<typeof processClaimedDeliveryEvent>[0];

test("delivery currency, latest-state history, kill switch and webhook conflict are atomic", async (t) => {
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(process.env.POSTGRES_HOST ?? ""),
    "local test DB required",
  );
  await query(readFileSync(new URL("../db/migrations/10.14__bms_delivery_platform_hardening.sql", import.meta.url), "utf8"));

  const tag = `FAKE-delivery-hardening-${process.pid}-${Date.now()}`;
  const tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants(name,slug) VALUES($1,$2) RETURNING id`,
    [tag, `${tag.toLowerCase()}-${randomUUID()}`],
  )).rows[0].id;
  t.after(async () => {
    await query(`DELETE FROM bms_audit_log WHERE tenant_id=$1`, [tenantId]).catch(() => {});
    await query(`DELETE FROM bms_tenants WHERE id=$1`, [tenantId]);
  });

  await query(
    `INSERT INTO bms_store_profile(tenant_id,business_archetype,currency)
     VALUES($1,'restaurant','THB')`,
    [tenantId],
  );
  const locationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations(tenant_id,code,name,active) VALUES($1,'MAIN',$2,TRUE) RETURNING id`,
    [tenantId, tag],
  )).rows[0].id;
  const sku = `FAKE-DELIVERY-${process.pid}`;
  await query(
    `INSERT INTO bms_products(tenant_id,sku,name,price,active,vat_category)
     VALUES($1,$2,$3,60,TRUE,'V')`,
    [tenantId, sku, tag],
  );
  await query(DECLARE_FAKE_SALES_SURFACES_SQL, [tenantId]);
  await query(
    `INSERT INTO bms_product_variants(tenant_id,product_sku,code)
     VALUES($1,$2,'BASE') ON CONFLICT DO NOTHING`,
    [tenantId, sku],
  );
  await query(
    `INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock)
     VALUES($1,$2,$3,'BASE',10,0)`,
    [tenantId, locationId, sku],
  );

  const integrationId = (await query<{ id: string }>(
    `INSERT INTO bms_delivery_integrations(
       tenant_id,provider,environment,rollout_mode,active,outbound_commands_enabled,
       access_token_encrypted,webhook_secret_encrypted,config,api_version,health_status
     ) VALUES($1,'FOODPANDA','SANDBOX','LIVE',TRUE,FALSE,$2,$3,$4::jsonb,'v2','DEGRADED')
     RETURNING id`,
    [tenantId, encryptSecret("legacy-test-token"), encryptSecret("webhook-test-secret"),
      JSON.stringify({ chainId: "chain-test", currency: "THB", webhookAuthHeader: "x-webhook-secret" })],
  )).rows[0].id;
  const locationMappingId = (await query<{ id: string }>(
    `INSERT INTO bms_delivery_location_mappings(tenant_id,integration_id,provider_store_id,location_id,active)
     VALUES($1,$2,'store-test',$3,TRUE) RETURNING id`,
    [tenantId, integrationId, locationId],
  )).rows[0].id;
  await query(
    `INSERT INTO bms_delivery_menu_mappings(
       tenant_id,integration_id,location_mapping_id,mapping_kind,provider_item_id,
       product_sku,size,provider_name_snapshot,provider_price_snapshot,mapping_status
     ) VALUES($1,$2,$3,'ITEM','provider-sku',$4,'BASE','Meal',60,'VERIFIED')`,
    [tenantId, integrationId, locationMappingId, sku],
  );

  const originalFetch = globalThis.fetch;
  let disableDuringFetch = false;
  globalThis.fetch = (async (request: string | URL | Request) => {
    const providerOrderId = decodeURIComponent(String(request).split("/").at(-1) ?? "");
    if (disableDuringFetch) {
      disableDuringFetch = false;
      await query(
        `UPDATE bms_delivery_integrations SET active=FALSE,rollout_mode='OFF',health_status='DISABLED',updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [tenantId, integrationId],
      );
    }
    const currency = providerOrderId.includes("currency-mismatch") ? "USD" : "THB";
    const status = providerOrderId.includes("latest-ready") ? "READY_FOR_PICKUP"
      : providerOrderId.includes("latest-dispatched") ? "DISPATCHED"
      : providerOrderId.includes("latest-cancelled") ? "CANCELLED" : "RECEIVED";
    return new Response(JSON.stringify({
      order_id: providerOrderId,
      order_code: providerOrderId,
      status,
      order_type: "DELIVERY",
      transport_type: "LOGISTICS_DELIVERY",
      currency,
      client: { store_id: "store-test" },
      payment: { sub_total: 60, order_total: 60, type: "ONLINE" },
      items: [{ _id: `line-${providerOrderId}`, sku: "provider-sku", name: "Meal",
        pricing: { quantity: 1, unit_price: 60 } }],
      sys: { created_at: "2026-09-24T10:00:00Z", updated_at: "2026-09-24T10:01:00Z" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  async function claim(providerOrderId: string): Promise<Claimed> {
    const eventId = (await query<{ id: string }>(
      `INSERT INTO bms_delivery_events(
         tenant_id,integration_id,external_event_id,event_type,provider_version,provider_occurred_at,
         payload_hash,sanitized_payload,processing_status
       ) VALUES($1,$2,$3,'ORDER.RECEIVED','2026-09-24T10:00:00Z','2026-09-24T10:00:00Z',
                repeat('a',64),$4::jsonb,'PENDING') RETURNING id`,
      [tenantId, integrationId, `test:${providerOrderId}`,
        JSON.stringify({ providerOrderId, providerStoreId: "store-test", providerStatus: "RECEIVED",
          transportType: "LOGISTICS_DELIVERY" })],
    )).rows[0].id;
    return (await query<Claimed>(
      `UPDATE bms_delivery_events
          SET processing_status='PROCESSING',attempts=attempts+1,claimed_at=now(),claim_token=gen_random_uuid()
        WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tenantId, eventId],
    )).rows[0];
  }

  try {
    const mismatched = await claim("currency-mismatch");
    assert.equal(await processClaimedDeliveryEvent(mismatched), "ACTION_REQUIRED");
    const mismatchEvent = (await query<{ error_code: string }>(
      `SELECT error_code FROM bms_delivery_events WHERE tenant_id=$1 AND id=$2`,
      [tenantId, mismatched.id],
    )).rows[0];
    assert.equal(mismatchEvent.error_code, "DELIVERY_CURRENCY_MISMATCH");
    assert.equal(Number((await query(
      `SELECT count(*) AS n FROM bms_delivery_orders WHERE tenant_id=$1 AND provider_order_id='currency-mismatch'`,
      [tenantId],
    )).rows[0].n), 0);
    assert.equal(Number((await query(`SELECT count(*) AS n FROM bms_orders WHERE tenant_id=$1`, [tenantId])).rows[0].n), 0);
    assert.equal(Number((await query(`SELECT count(*) AS n FROM bms_payments WHERE tenant_id=$1`, [tenantId])).rows[0].n), 0);
    assert.equal(Number((await query(
      `SELECT reserved_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='BASE'`,
      [tenantId, locationId, sku],
    )).rows[0].reserved_stock), 0);

    const matched = await claim("latest-ready");
    assert.equal(await processClaimedDeliveryEvent(matched), "PROCESSED");
    const delivery = (await query<{ id: string; bms_order_id: string; local_status: string; provider_status: string; transport_type: string }>(
      `SELECT id,bms_order_id,local_status,provider_status,transport_type
         FROM bms_delivery_orders WHERE tenant_id=$1 AND provider_order_id='latest-ready'`,
      [tenantId],
    )).rows[0];
    assert.deepEqual(
      { local: delivery.local_status, provider: delivery.provider_status, transport: delivery.transport_type },
      { local: "AWAITING_ACCEPTANCE", provider: "READY_FOR_PICKUP", transport: "LOGISTICS_DELIVERY" },
    );
    assert.equal(Number((await query(
      `SELECT count(*) AS n FROM bms_payments WHERE tenant_id=$1 AND order_id=$2
        AND method='PLATFORM_SETTLEMENT' AND status='CONFIRMED'`,
      [tenantId, delivery.bms_order_id],
    )).rows[0].n), 1);
    assert.equal(Number((await query(
      `SELECT reserved_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='BASE'`,
      [tenantId, locationId, sku],
    )).rows[0].reserved_stock), 1);
    const history = await query<{ event_kind: string }>(
      `SELECT event_kind FROM bms_delivery_order_events WHERE tenant_id=$1 AND delivery_order_id=$2`,
      [tenantId, delivery.id],
    );
    assert.equal(history.rows.some((row) => row.event_kind === "INITIAL_PROVIDER_EVENT"), true);
    assert.equal(history.rows.some((row) => row.event_kind === "LATEST_PROVIDER_SNAPSHOT"), true);

    const dispatched = await claim("latest-dispatched");
    assert.equal(await processClaimedDeliveryEvent(dispatched), "PROCESSED");
    const dispatchedOrder = (await query<{ local_status: string; provider_status: string; id: string }>(
      `SELECT id,local_status,provider_status FROM bms_delivery_orders
        WHERE tenant_id=$1 AND provider_order_id='latest-dispatched'`,
      [tenantId],
    )).rows[0];
    assert.deepEqual(
      { local: dispatchedOrder.local_status, provider: dispatchedOrder.provider_status },
      { local: "AWAITING_ACCEPTANCE", provider: "DISPATCHED" },
      "latest provider progress must not fabricate local handoff evidence",
    );
    assert.equal(Number((await query(
      `SELECT count(*) AS n FROM bms_delivery_handoffs WHERE tenant_id=$1 AND delivery_order_id=$2`,
      [tenantId, dispatchedOrder.id],
    )).rows[0].n), 0);

    const cancelled = await claim("latest-cancelled");
    assert.equal(await processClaimedDeliveryEvent(cancelled), "ACTION_REQUIRED");
    assert.equal((await query<{ error_code: string }>(
      `SELECT error_code FROM bms_delivery_events WHERE tenant_id=$1 AND id=$2`,
      [tenantId, cancelled.id],
    )).rows[0].error_code, "PROVIDER_CANCELLED_BEFORE_INTAKE");
    assert.equal(Number((await query(
      `SELECT count(*) AS n FROM bms_delivery_orders WHERE tenant_id=$1 AND provider_order_id='latest-cancelled'`,
      [tenantId],
    )).rows[0].n), 0);

    const killSwitch = await claim("disabled-during-fetch");
    disableDuringFetch = true;
    assert.equal(await processClaimedDeliveryEvent(killSwitch), "ACTION_REQUIRED");
    assert.equal((await query<{ error_code: string }>(
      `SELECT error_code FROM bms_delivery_events WHERE tenant_id=$1 AND id=$2`,
      [tenantId, killSwitch.id],
    )).rows[0].error_code, "INTEGRATION_DISABLED");
    assert.equal(Number((await query(
      `SELECT count(*) AS n FROM bms_delivery_orders WHERE tenant_id=$1 AND provider_order_id='disabled-during-fetch'`,
      [tenantId],
    )).rows[0].n), 0);

    await query(
      `UPDATE bms_delivery_integrations
          SET active=TRUE,rollout_mode='SHADOW',health_status='DEGRADED',config_version=config_version+1
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, integrationId],
    );
    const webhookBody = (displayNumber: string) => JSON.stringify({
      order_id: "webhook-conflict", order_code: displayNumber, status: "RECEIVED", order_type: "DELIVERY",
      transport_type: "LOGISTICS_DELIVERY", client: { store_id: "store-test" },
      sys: { updated_at: "2026-09-24T11:00:00Z" },
    });
    const headers = new Headers({ "x-webhook-secret": "webhook-test-secret" });
    assert.equal((await intakeDeliveryWebhook({ integrationId, provider: "FOODPANDA", rawBody: webhookBody("A-1"), headers })).status, "ACCEPTED");
    assert.equal((await intakeDeliveryWebhook({ integrationId, provider: "FOODPANDA", rawBody: webhookBody("A-1"), headers })).status, "DUPLICATE");
    assert.equal((await intakeDeliveryWebhook({ integrationId, provider: "FOODPANDA", rawBody: webhookBody("A-2"), headers })).status, "CONFLICT");
    const conflict = (await query<{ processing_status: string; error_code: string }>(
      `SELECT processing_status,error_code FROM bms_delivery_events
        WHERE tenant_id=$1 AND integration_id=$2 AND external_event_id LIKE 'order:webhook-conflict:%'`,
      [tenantId, integrationId],
    )).rows[0];
    assert.deepEqual(conflict, { processing_status: "ACTION_REQUIRED", error_code: "WEBHOOK_PAYLOAD_CONFLICT" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

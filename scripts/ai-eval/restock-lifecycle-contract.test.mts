import assert from "node:assert/strict";
import test from "node:test";

import {
  markRestockSubscriptionsOrdered,
  markRestockSubscriptionsPurchasedForOrder,
  reopenRestockSubscriptionsForOrders,
} from "../../apps/web/lib/bms/restockSubscriptions.ts";

function recordingClient(rowCount = 1) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  return {
    calls,
    client: {
      async query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        return { rowCount, rows: [] };
      },
    },
  };
}

test("creating an order links the restock subscription as ORDERED without revenue", async () => {
  const db = recordingClient();
  await markRestockSubscriptionsOrdered({
    tenantId: "tenant-1",
    orderId: "order-1",
    channel: "line",
    customerRef: "customer-1",
    customerId: null,
    items: [{ sku: "SKU-1", size: "m" }],
    client: db.client,
  });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].text, /status = 'ORDERED'/);
  assert.match(db.calls[0].text, /recovered_revenue = NULL/);
  assert.doesNotMatch(db.calls[0].text, /status = 'PURCHASED'/);
  assert.deepEqual(db.calls[0].values.slice(-1), ["order-1"]);
});

test("payment confirmation promotes only ORDERED subscriptions and allocates net revenue", async () => {
  const db = recordingClient(2);
  const changed = await markRestockSubscriptionsPurchasedForOrder({
    tenantId: "tenant-1",
    orderId: "order-1",
    client: db.client,
  });
  assert.equal(changed, 2);
  assert.match(db.calls[0].text, /status = 'PURCHASED'/);
  assert.match(db.calls[0].text, /s\.status = 'ORDERED'/);
  assert.match(db.calls[0].text, /o\.total_amount/);
  assert.match(db.calls[0].text, /SUM\(all_oi\.qty \* all_oi\.unit_price\)/);
});

test("cancel, expiry, or return reopens subscriptions and clears attribution", async () => {
  const db = recordingClient(1);
  await reopenRestockSubscriptionsForOrders({ orderIds: ["order-1"], client: db.client });
  assert.match(db.calls[0].text, /status = 'ACTIVE'/);
  assert.match(db.calls[0].text, /resolved_order_id = NULL/);
  assert.match(db.calls[0].text, /recovered_revenue = NULL/);
  assert.match(db.calls[0].text, /status IN \('ORDERED','PURCHASED'\)/);
});

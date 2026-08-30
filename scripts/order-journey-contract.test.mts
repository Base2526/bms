import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serviceSource = await readFile(
  new URL("../apps/web/lib/bms/orders.ts", import.meta.url),
  "utf8"
);
const ordersPageSource = await readFile(
  new URL("../apps/web/app/(admin)/admin/orders/page.tsx", import.meta.url),
  "utf8"
);
const bmsOrdersResolverSource = await readFile(
  new URL("../apps/web/graphql/bmsOrders.ts", import.meta.url),
  "utf8"
);
const typeDefsSource = await readFile(
  new URL("../apps/web/graphql/typeDefs.ts", import.meta.url),
  "utf8"
);

test("deposit close comments are part of the order journey timeline", () => {
  assert.match(serviceSource, /cancel_reason: string \| null/);
  assert.match(serviceSource, /d\.cancelled_at, d\.cancel_reason/);
  assert.match(serviceSource, /kind: "deposit_close"/);
  assert.match(serviceSource, /คืนมัดจำเต็มจำนวน ฿\$\{paid\}/);
  assert.match(serviceSource, /ยึดมัดจำ ฿\$\{paid\}/);
  assert.match(serviceSource, /เหตุผล: \$\{depositRow\.cancel_reason\}/);
});

test("order journey reads POS deposit payments for web-origin orders", () => {
  const paymentQuery = serviceSource.match(
    /const posPayments = \(await query[\s\S]*?FROM bms_payments[\s\S]*?ORDER BY created_at, id`/
  )?.[0] ?? "";
  const depositQuery = serviceSource.match(
    /const depositRow = \(await query[\s\S]*?FROM bms_pos_deposits d[\s\S]*?LIMIT 1`/
  )?.[0] ?? "";

  assert.ok(paymentQuery, "journey must read confirmed payment rows by order id");
  assert.ok(depositQuery, "journey must read deposit rows by order id");
  assert.doesNotMatch(paymentQuery, /isPos\s*\?/,
    "a web/Inbox order can be selected and paid as a deposit at POS");
  assert.doesNotMatch(depositQuery, /isPos\s*\?/,
    "deposit display must follow the POS deposit row, not the order channel");
  assert.match(serviceSource, /const steps: OrderStep\[\] = \(isPos \? POS_FLOW : MAIN_FLOW\)\.map/,
    "only the visual order flow should remain channel-specific");
});

test("admin order page renders timeline event text without filtering deposit close events", () => {
  assert.match(ordersPageSource, /events \{ kind at text actorName \}/);
  assert.match(ordersPageSource, /const events: JEvent\[\] = j\.events \|\| \[\]/);
  assert.match(ordersPageSource, /items=\{events\.map\(\(e\) =>/);
  assert.match(ordersPageSource, /\{e\.text\}/);
  assert.doesNotMatch(ordersPageSource, /filter\(\(e\).*deposit_close/);
});

test("admin order list surfaces deposit amounts before the row is expanded", () => {
  assert.match(typeDefsSource, /deposit_paid: Float!/);
  assert.match(typeDefsSource, /deposit_balance_due: Float!/);
  assert.match(typeDefsSource, /deposit_status: String/);
  assert.match(bmsOrdersResolverSource, /LEFT JOIN bms_pos_deposits d/);
  assert.match(bmsOrdersResolverSource, /COALESCE\(d\.deposit_paid, 0\) AS deposit_paid/);
  assert.match(bmsOrdersResolverSource, /d\.status AS deposit_status/);
  assert.match(ordersPageSource, /deposit_paid deposit_balance_due deposit_status/);
  assert.match(ordersPageSource, /admin_orders\.deposit_received/);
  assert.match(ordersPageSource, /admin_orders\.deposit_balance_due/);
});

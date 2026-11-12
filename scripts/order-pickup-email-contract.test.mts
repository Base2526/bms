import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { orderEmailTemplateKey, type OrderEmailKey } from "../apps/web/lib/bms/orderEmailPolicy.ts";
import { REQUIRED_PICKUP_EMAIL_TEMPLATES, missingPickupEmailTemplates } from "./orderEmailReadiness.mts";

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

function emailHarness(fulfillmentType: string | null) {
  const calls = { templates: [] as string[], shipmentReads: 0, messages: [] as Array<{ subject: string; to: string }> };
  const module = { exports: {} as Record<string, any> };
  const source = ts.transpileModule(read("apps/web/lib/bms/orderNotify.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mocks: Record<string, unknown> = {
    "@/lib/db": { query: async (sql: string) => {
      if (sql.includes("FROM bms_orders")) return { rows: [{ id: "12345678-order", total_amount: "100.00", shipping_fee: "0", fulfillment_type: fulfillmentType, pickup_location_name: "Main", customer_name: "Buyer", customer_email: "buyer@example.test", preferred_language: "en" }] };
      if (sql.includes("FROM bms_order_items")) return { rows: [] };
      if (sql.includes("FROM bms_shipments")) { calls.shipmentReads++; return { rows: [{ carrier: "Carrier", tracking_no: "TRACK" }] }; }
      throw new Error(`Unexpected SQL: ${sql}`);
    } },
    "@/lib/mailer": { sendEmail: async (message: { subject: string; to: string }) => { calls.messages.push(message); } },
    "@/lib/emailTemplates": {
      getLatestEmailTemplate: async (key: string) => { calls.templates.push(key); return { key }; },
      renderEmailTemplate: (template: { key: string }) => ({ subject: template.key, html: template.key, text: template.key }),
    },
    "./storeProfile": { DEFAULT_EMAIL_THEME_COLOR: "#000000", getStoreProfile: async () => ({ currency: "THB", contactEmail: "shop@example.test" }) },
    "./platform": { getTenantName: async () => "Shop" },
    "./orderEmailPolicy": { orderEmailTemplateKey },
  };
  new Function("require", "module", "exports", source)(
    (key: string) => key in mocks ? mocks[key] : require(key), module, module.exports,
  );
  return { calls, notify: module.exports.notifyOrderStatusEmail as (tenantId: string, orderId: string, status: OrderEmailKey) => Promise<void> };
}

test("only persisted pickup fulfillment selects pickup-specific status mail", () => {
  const pickupStatuses: OrderEmailKey[] = ["paid", "packing", "shipped", "completed"];
  for (const status of pickupStatuses) {
    assert.equal(orderEmailTemplateKey(status, "PICKUP"), `order.pickup.${status}`);
    for (const type of [null, "DELIVERY", "pickup", "UNKNOWN"]) {
      assert.equal(orderEmailTemplateKey(status, type), `order.${status}`);
    }
  }
  for (const status of ["cancelled", "returned"] as const) {
    assert.equal(orderEmailTemplateKey(status, "PICKUP"), `order.${status}`);
  }
});

test("pickup handover mail uses the stored fulfillment type without reading parcel tracking", async () => {
  const pickup = emailHarness("PICKUP");
  await pickup.notify("tenant", "12345678-order", "shipped");
  assert.deepEqual(pickup.calls.templates, ["order.pickup.shipped"]);
  assert.equal(pickup.calls.shipmentReads, 0);
  assert.equal(pickup.calls.messages.length, 1);
  assert.equal(pickup.calls.messages[0]?.subject, "order.pickup.shipped");
  assert.equal(pickup.calls.messages[0]?.to, "buyer@example.test");

  const delivery = emailHarness("DELIVERY");
  await delivery.notify("tenant", "12345678-order", "shipped");
  assert.deepEqual(delivery.calls.templates, ["order.shipped"]);
  assert.equal(delivery.calls.shipmentReads, 1);
});

test("pickup templates are bilingual and seeded idempotently before the caller", () => {
  const service = read("apps/web/lib/bms/orderNotify.ts");
  const migration = read("db/migrations/10.114__bms_pickup_status_email_templates.sql");
  assert.match(service, /SELECT o\.id,[\s\S]*o\.fulfillment_type/);
  assert.match(service, /LEFT JOIN bms_customers cu ON cu\.tenant_id = o\.tenant_id AND cu\.id = o\.customer_id/);
  for (const status of ["paid", "packing", "shipped", "completed"] as const) {
    for (const locale of ["th", "en"] as const) {
      assert.match(migration, new RegExp(`\\('order\\.pickup\\.${status}', '${locale}', 1, true, true,`));
    }
  }
  assert.match(migration, /Payment does not mean it is ready to collect/);
  assert.match(migration, /การชำระเงินยังไม่ได้หมายความว่าสินค้าพร้อมรับ/);
  assert.match(migration, /ON CONFLICT \(key, locale, version\) DO NOTHING/);
});

test("deployment readiness rejects missing, unpublished or empty latest pickup mail", () => {
  const checker = read("scripts/check-order-email-readiness.mts");
  const preflight = read("scripts/preflight-deploy.mts");
  const all = REQUIRED_PICKUP_EMAIL_TEMPLATES.map(({ key, locale }) =>
    ({ key, locale, version: 1, subject_tpl: "Order", html_tpl: "<p>Order</p>" }));
  assert.equal(all.length, 8);
  assert.deepEqual(missingPickupEmailTemplates(all), []);
  assert.deepEqual(missingPickupEmailTemplates(all.filter(({ key, locale }) =>
    !(key === "order.pickup.paid" && locale === "th"))), ["order.pickup.paid:th"]);
  assert.deepEqual(missingPickupEmailTemplates([...all,
    { key: "order.pickup.paid", locale: "th", version: 2, subject_tpl: " ", html_tpl: "<p>Order</p>" },
  ]), ["order.pickup.paid:th"]);
  assert.match(checker, /is_active = true AND is_published = true/);
  assert.match(checker, /SELECT key, locale, version, subject_tpl, html_tpl FROM email_templates/);
  assert.match(checker, /process\.exit\(1\)/);
  assert.match(checker, /process\.exit\(2\)/);
  assert.match(preflight, /check-order-email-readiness\.mts/);
  assert.match(preflight, /pickupMail\.status === 1[\s\S]*?block\(/);
});

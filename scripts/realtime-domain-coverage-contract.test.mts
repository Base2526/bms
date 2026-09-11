import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import test from "node:test";

import { REALTIME_EVENT_TYPES } from "../packages/realtime/src/events.ts";

/**
 * ด่านนี้มีไว้จับ "domain ที่หายไป" โดยเฉพาะ
 * -------------------------------------------------------------
 * `realtime-domain-contract` เทียบ event กับ **ลิสต์ที่เราเขียนเอง** จึงบอกได้แค่ว่า
 * ของที่เรานึกออกครบไหม — มันมองไม่เห็นโดเมนที่ไม่มีใครนึกถึง (เจอจริง: เงินเข้า-ออก
 * ลิ้นชัก และคิวครัวของร้านค้าปลีก ไม่มี event เลยจนถึง `9.72`)
 *
 * ตัวนี้เดินกลับทาง: ไล่จาก **ตารางที่ชั้นธุรกิจเขียนจริง** แล้วบังคับว่าทุกตารางต้องถูก
 * จัดประเภท — มี trigger, หรืออยู่ในลิสต์ยกเว้นพร้อมเหตุผล · ตารางใหม่ที่ไม่มีใครจัดประเภท
 * = แดงทันที ซึ่งเป็นจุดเดียวที่ "ลืมทั้งโดเมน" จะถูกจับได้
 */

const REPO = new URL("../", import.meta.url);
const BMS_LIB = new URL("apps/web/lib/bms/", REPO);
const MIGRATIONS = [
  "db/migrations/9.71__bms_realtime_domain_events.sql",
  "db/migrations/9.72__bms_realtime_cash_and_kitchen_events.sql",
];

function read(relative: string): string {
  return readFileSync(new URL(relative, REPO), "utf8");
}

/** ไฟล์เป็น CRLF และคอมเมนต์อธิบายกฎเอง จึงต้องตัดก่อนสแกนทุกครั้ง */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

function businessLibFiles(dir: URL): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) out.push(...businessLibFiles(child));
    else if (entry.name.endsWith(".ts")) out.push(readFileSync(child, "utf8"));
  }
  return out;
}

/** ตารางที่ `lib/bms` เขียนจริง (INSERT/UPDATE) — ไม่ใช่ลิสต์ที่พิมพ์เอง */
function tablesWrittenByBusinessLayer(): Set<string> {
  const tables = new Set<string>();
  for (const source of businessLibFiles(BMS_LIB)) {
    for (const match of withoutComments(source)
      .matchAll(/\b(?:INSERT\s+INTO|UPDATE)\s+(bms_[a-z0-9_]+)/gi)) {
      tables.add(match[1].toLowerCase());
    }
  }
  return tables;
}

/** ตารางที่มี AFTER trigger ยิง event — อ่านจาก migration ไม่ใช่จากความจำ */
function tablesWithRealtimeTrigger(): Set<string> {
  const tables = new Set<string>();
  for (const migration of MIGRATIONS) {
    for (const block of read(migration).matchAll(/CREATE\s+TRIGGER\b([\s\S]*?)FOR\s+EACH\s+ROW/gi)) {
      const targets = [...block[1].matchAll(/\bON\s+([a-z0-9_]+)/gi)];
      if (targets.length) tables.add(targets[targets.length - 1][1].toLowerCase());
    }
  }
  return tables;
}

// -------------------------------------------------------------
// ลิสต์ยกเว้น: ตารางที่ "ตั้งใจไม่มี event" พร้อมเหตุผล
// เพิ่มตารางใหม่แล้วไม่จัดประเภท = เทสแดง
// -------------------------------------------------------------

/** แถวลูกของ aggregate ที่ยิง event อยู่แล้ว — ยิงซ้ำคือ event ซ้ำของงานเดียวกัน */
const CHILD_OF_AGGREGATE = [
  "bms_action_events", "bms_ai_usage_events", "bms_conversation_note_mentions",
  "bms_inbound_events", "bms_inventory_demand_events", "bms_inventory_lots",
  "bms_order_item_lots", "bms_order_items", "bms_pharmacy_assessment_events",
  "bms_pos_return_item_lots", "bms_product_bundle_items", "bms_product_modifier_items",
  "bms_product_recipe_items", "bms_purchase_order_items", "bms_report_deliveries",
  "bms_restaurant_qr_submission_items", "bms_restock_deliveries",
  "bms_shipment_tracking_events", "bms_stock_count_items", "bms_stock_transfer_items",
  "bms_support_events", "bms_order_discounts", "bms_order_extra_lines",
  "bms_order_item_stock_consumption", "bms_stock_movements",
];

/** ร่องรอย/ตัวชี้วัดของระบบ ไม่ใช่สถานะธุรกิจที่จอไหนเฝ้าดูอยู่ */
const OPS_TELEMETRY = [
  "bms_ai_provider_health", "bms_ai_provider_health_log", "bms_ai_usage_monthly",
  "bms_audit_log", "bms_channel_health_log", "bms_failure_incidents",
  "bms_fake_eval_cases", "bms_fake_eval_results", "bms_fake_eval_runs", "bms_job_runs",
  "bms_mail_log", "bms_onboarding_seed_runs", "bms_support_bundles",
  "bms_ai_credit_ledger", "bms_ai_quality_reviews", "bms_ai_synonym_candidates",
  "bms_generated_reports", "bms_realtime_outbox", "bms_retention_cases",
  "bms_followup_history", "bms_followup_jobs", "bms_etax_submissions",
];

/** ค่าตั้งค่า/แคตตาล็อกที่หน้าจออ่านตอนเปิด ไม่ได้เฝ้าเป็น live surface */
const CONFIGURATION = [
  "bms_commission_rules", "bms_coupon_locations", "bms_document_counters",
  "bms_followup_rules", "bms_inventory_policies", "bms_kitchen_stations",
  "bms_kitchen_station_slas", "bms_locations", "bms_loyalty_settings",
  "bms_membership_tiers", "bms_pending_shop_signups", "bms_pharmacy_product_policies",
  "bms_pharmacy_protocols", "bms_product_categories", "bms_product_images",
  "bms_product_modifier_groups", "bms_product_modifiers", "bms_product_packs",
  "bms_product_price_tiers", "bms_product_promotions", "bms_product_recipes",
  "bms_product_sales_surfaces", "bms_product_stock_policies", "bms_product_variants",
  "bms_report_subscriptions", "bms_restock_subscriptions", "bms_role_permissions",
  "bms_store_capabilities", "bms_store_profile", "bms_supplier_products", "bms_suppliers",
  "bms_tenant_ai_config", "bms_tenant_channels", "bms_tenants", "bms_product_serials",
  "bms_coupons", "bms_customer_addresses", "bms_customer_ai_summary",
  "bms_customer_coupon_wallet", "bms_customer_identities", "bms_customers",
  "bms_conversation_helpers", "bms_conversation_intents", "bms_conversation_notes",
  "bms_actions", "bms_pharmacy_clinical_evidence", "bms_pos_purchase_receipts",
  "bms_restaurant_qr_sessions", "bms_restaurant_table_qr_tokens",
];

/**
 * ⚠️ ช่องว่างที่รู้ตัว — ควรมี event แต่ยังไม่ได้ทำ
 * อยู่ในลิสต์นี้เพื่อให้ "ยังไม่ได้ทำ" เป็นของที่อ่านเจอ ไม่ใช่ของที่เงียบหาย
 * เพิ่ม trigger ให้ตัวไหนแล้ว ต้องย้ายออกจากลิสต์นี้ (มีเทสบังคับ)
 */
const KNOWN_GAPS = [
  "bms_pos_returns", "bms_pos_blind_returns", "bms_pos_blind_return_items",
  "bms_pos_deposits", "bms_pos_expenses", "bms_pos_no_sales", "bms_pos_parked_sales",
  "bms_pos_petty_cash_ledger", "bms_pos_petty_cash_wallets",
  "bms_pos_pharmacist_authorizations", "bms_store_credits", "bms_store_credit_ledger",
  "bms_ar_accounts", "bms_ar_invoices", "bms_ar_ledger", "bms_ar_receipts",
  "bms_tax_documents", "bms_loyalty_ledger", "bms_purchase_orders",
  "bms_inventory_wastage",
];

const CLASSIFIED = new Map<string, string>();
for (const [reason, tables] of [
  ["child of an aggregate that already emits", CHILD_OF_AGGREGATE],
  ["ops/telemetry, not a mobile-visible business state", OPS_TELEMETRY],
  ["configuration read on demand, not a live surface", CONFIGURATION],
  ["known gap: deserves an event, not built yet", KNOWN_GAPS],
] as const) {
  for (const table of tables) CLASSIFIED.set(table, reason);
}

test("every table the business layer writes is classified for realtime coverage", () => {
  const written = tablesWrittenByBusinessLayer();
  const triggered = tablesWithRealtimeTrigger();
  assert.ok(written.size > 100, "table scan must actually find the business writes");
  assert.ok(triggered.size > 20, "trigger scan must actually find the migrations");

  const unclassified = [...written]
    .filter((table) => !triggered.has(table) && !CLASSIFIED.has(table))
    .sort();
  assert.deepEqual(
    unclassified,
    [],
    "ตารางใหม่ต้องมี trigger หรือถูกจัดประเภทพร้อมเหตุผล — ไม่งั้นทั้งโดเมนหายเงียบ",
  );
});

test("a table that gained a trigger is removed from the exclusion lists", () => {
  const triggered = tablesWithRealtimeTrigger();
  const stale = [...CLASSIFIED.keys()].filter((table) => triggered.has(table)).sort();
  assert.deepEqual(stale, [], "ตารางที่มี trigger แล้วต้องไม่ค้างอยู่ในลิสต์ยกเว้น");
});

test("the drawer and both kitchen queues emit events", () => {
  const triggered = tablesWithRealtimeTrigger();
  // สองตัวนี้คือช่องว่างที่ `9.72` ปิด — ถอย trigger ออกเมื่อไรต้องแดง
  for (const table of [
    "bms_pos_cash_movements", "bms_kitchen_tickets", "bms_restaurant_kitchen_tickets",
  ]) {
    assert.ok(triggered.has(table), `${table} must emit a realtime event`);
  }
});

test("every emitted event type is centrally registered, and every registered type is emitted", () => {
  const registered = new Set<string>(REALTIME_EVENT_TYPES);
  const emitted = new Set<string>();
  // โดเมนที่ถูกต้องมาจากลิสต์กลาง ไม่ได้พิมพ์เอง — ชื่อ GUC อย่าง `app.editor_id`
  // หรือ `bms.tenant_id` จึงไม่ถูกเข้าใจผิดว่าเป็น event type
  const domains = new Set([...registered].map((type) => type.split(".", 1)[0]));
  for (const migration of MIGRATIONS) {
    // ทุกสตริงที่มีรูปทรง "โดเมน.เหตุการณ์" ใน migration พวกนี้คือ event type
    // ชนิดที่ยิงแต่ยังไม่ได้ประกาศจะ validate ไม่ผ่านตอนรัน จึงต้องจับที่นี่
    for (const match of read(migration).matchAll(/'([a-z][a-z0-9_]*\.[a-z0-9_.]+)'/g)) {
      if (!domains.has(match[1].split(".", 1)[0])) continue;
      assert.ok(registered.has(match[1]), `${match[1]} is emitted but not registered`);
      emitted.add(match[1]);
    }
  }
  for (const source of businessLibFiles(BMS_LIB)) {
    for (const match of source.matchAll(/eventType:\s*"([a-z][a-z0-9_.]+)"/g)) {
      assert.ok(registered.has(match[1]), `${match[1]} is emitted but not registered`);
      emitted.add(match[1]);
    }
  }
  const dead = [...registered].filter((type) => !emitted.has(type)).sort();
  assert.deepEqual(dead, [], "event type ที่ประกาศไว้แต่ไม่มีใครยิง = สัญญาที่ตายแล้ว");
});

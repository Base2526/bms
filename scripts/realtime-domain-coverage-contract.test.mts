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
const INBOX = readFileSync(new URL("apps/web/lib/bms/inbox.ts", REPO), "utf8");
const MIGRATIONS = [
  "db/migrations/9.71__bms_realtime_domain_events.sql",
  "db/migrations/9.72__bms_realtime_cash_and_kitchen_events.sql",
  "db/migrations/9.73__bms_realtime_pos_scope_trigger_fix.sql",
  "db/migrations/9.74__bms_realtime_pos_trigger_split.sql",
  "db/migrations/9.84__bms_realtime_pos_device_heartbeat_filter.sql",
  "db/migrations/9.85__bms_realtime_remaining_business_events.sql",
  "db/migrations/9.86__bms_realtime_parked_sale_delete.sql",
  "db/migrations/9.96__bms_board_game_service_calls.sql",
  "db/migrations/9.99__bms_board_game_waitlist.sql",
  "db/migrations/10.2__bms_board_game_reservation_completion.sql",
];

type DmlOperation = "INSERT" | "UPDATE" | "DELETE";

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

function withoutSqlLineComments(source: string): string {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
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

/** ตารางและ operation ที่ `lib/bms` เขียนจริง — ไม่ใช่ลิสต์ที่พิมพ์เอง */
function writesByBusinessLayer(): Map<string, Set<DmlOperation>> {
  const writes = new Map<string, Set<DmlOperation>>();
  for (const source of businessLibFiles(BMS_LIB)) {
    for (const match of withoutComments(source).matchAll(
      /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?(bms_[a-z0-9_]+)/gi,
    )) {
      const operation = match[1].toUpperCase().startsWith("INSERT")
        ? "INSERT"
        : match[1].toUpperCase().startsWith("DELETE")
          ? "DELETE"
          : "UPDATE";
      const table = match[2].toLowerCase();
      const operations = writes.get(table) ?? new Set<DmlOperation>();
      operations.add(operation);
      writes.set(table, operations);
    }
  }
  return writes;
}

/** operation ของ trigger ชุดล่าสุด อ่านตามลำดับ migration และชื่อ trigger จริง */
function realtimeTriggerOperations(): Map<string, Set<DmlOperation>> {
  const triggers = new Map<string, { table: string; operations: Set<DmlOperation> }>();
  for (const migration of MIGRATIONS) {
    const source = withoutSqlLineComments(read(migration));
    const actions: Array<
      | { index: number; kind: "drop"; name: string }
      | { index: number; kind: "create"; name: string; body: string }
    > = [];
    for (const match of source.matchAll(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+([a-z0-9_]+)/gi)) {
      actions.push({ index: match.index, kind: "drop", name: match[1].toLowerCase() });
    }
    for (const match of source.matchAll(
      /CREATE\s+TRIGGER\s+(trg_bms_realtime_[a-z0-9_]+)([\s\S]*?)FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION[\s\S]*?;/gi,
    )) {
      actions.push({
        index: match.index,
        kind: "create",
        name: match[1].toLowerCase(),
        body: match[2],
      });
    }
    actions.sort((a, b) => a.index - b.index);

    for (const action of actions) {
      if (action.kind === "drop") {
        triggers.delete(action.name);
        continue;
      }
      const targets = [...action.body.matchAll(/\bON\s+(?:public\.)?([a-z0-9_]+)/gi)];
      assert.ok(targets.length > 0, `${action.name} has no target table`);
      const target = targets[targets.length - 1];
      const eventClause = action.body.slice(0, target.index);
      const operations = new Set<DmlOperation>();
      for (const match of eventClause.matchAll(/\b(INSERT|UPDATE|DELETE)\b/gi)) {
        operations.add(match[1].toUpperCase() as DmlOperation);
      }
      assert.ok(operations.size > 0, `${action.name} has no DML operation`);
      triggers.set(action.name, {
        table: target[1].toLowerCase(),
        operations,
      });
    }
  }

  const byTable = new Map<string, Set<DmlOperation>>();
  for (const trigger of triggers.values()) {
    const operations = byTable.get(trigger.table) ?? new Set<DmlOperation>();
    for (const operation of trigger.operations) operations.add(operation);
    byTable.set(trigger.table, operations);
  }
  return byTable;
}

function tablesWithRealtimeTrigger(): Set<string> {
  return new Set(realtimeTriggerOperations().keys());
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
  "bms_board_game_reservation_deposit_applications", "bms_board_game_pass_renewal_runs",
  "bms_delivery_order_lines", "bms_delivery_order_modifiers", "bms_delivery_order_events",
  "bms_delivery_handoffs", "bms_delivery_settlement_lines",
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
  "bms_board_game_idempotency_results",
  "bms_inventory_operation_idempotency",
  "bms_delivery_events", "bms_delivery_commands",
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
  "bms_board_game_areas", "bms_board_game_public_locations", "bms_board_game_tables",
  "bms_board_game_time_rates", "bms_board_game_titles", "bms_board_game_offers",
  "bms_board_game_guest_tokens",
  "bms_delivery_integrations", "bms_delivery_location_mappings", "bms_delivery_menu_mappings",
];

/** Operational state whose owning page performs authoritative 15-second polling plus post-write refresh. */
const POLLED_OPERATIONAL_SURFACE = [
  "bms_expense_documents",
  "bms_board_game_copies", "bms_board_game_sessions",
  "bms_board_game_session_games", "bms_board_game_session_participants",
  "bms_board_game_billing_groups", "bms_board_game_group_items",
  "bms_board_game_seatings",
  "bms_board_game_pass_plans", "bms_board_game_member_passes", "bms_board_game_pass_ledger",
  "bms_board_game_pass_renewals",
  "bms_board_game_identity_holds",
  "bms_delivery_orders", "bms_delivery_intake_controls", "bms_delivery_settlements",
  "bms_delivery_adjustments", "bms_delivery_disputes",
];

const CLASSIFIED = new Map<string, string>();
for (const [reason, tables] of [
  ["child of an aggregate that already emits", CHILD_OF_AGGREGATE],
  ["ops/telemetry, not a mobile-visible business state", OPS_TELEMETRY],
  ["configuration read on demand, not a live surface", CONFIGURATION],
  ["authoritative polling plus post-write refresh; no realtime event contract", POLLED_OPERATIONAL_SURFACE],
] as const) {
  for (const table of tables) CLASSIFIED.set(table, reason);
}

/** การลบทั้ง tenant ไม่มี subscriber เหลืออยู่ และ outbox ของ tenant ถูก cascade ทิ้ง */
const OPERATION_EXEMPTIONS = new Map<string, string>([
  ["bms_messages:UPDATE", "outbound delivery metadata; conversation invalidation is emitted after delivery"],
  ["bms_orders:DELETE", "platform tenant teardown"],
  ["bms_payments:DELETE", "reservation fixture cleanup and platform tenant teardown"],
  ["bms_pharmacy_assessments:DELETE", "dev fixture cleanup before replacing seeded pharmacists"],
  ["bms_board_game_waitlist:DELETE", "fixture cleanup and platform tenant teardown"],
  ["bms_pos_refund_allocations:DELETE", "reservation fixture cleanup and platform tenant teardown"],
  ["bms_pos_expenses:DELETE", "platform tenant teardown"],
  ["bms_pos_petty_cash_ledger:DELETE", "platform tenant teardown"],
  ["bms_pos_shifts:DELETE", "platform tenant teardown"],
  ["bms_products:DELETE", "platform tenant teardown"],
  ["bms_products:INSERT", "draft/config creation; publish is the active-state UPDATE"],
  ["bms_purchase_orders:DELETE", "platform tenant teardown"],
  ["bms_restaurant_order_requests:DELETE", "platform tenant teardown"],
  ["bms_stock_counts:INSERT", "draft count creation does not change inventory"],
  ["bms_stock_transfers:INSERT", "draft transfer creation does not move inventory"],
]);

test("every business-layer write operation is classified for realtime coverage", () => {
  const writes = writesByBusinessLayer();
  const triggerOperations = realtimeTriggerOperations();
  assert.ok(writes.size > 100, "table scan must actually find the business writes");
  assert.ok(triggerOperations.size > 20, "trigger scan must actually find the migrations");

  const unclassified: string[] = [];
  for (const [table, operations] of writes) {
    if (CLASSIFIED.has(table)) continue;
    const covered = triggerOperations.get(table) ?? new Set<DmlOperation>();
    for (const operation of operations) {
      if (
        !covered.has(operation) &&
        !OPERATION_EXEMPTIONS.has(`${table}:${operation}`)
      ) {
        unclassified.push(`${table}:${operation}`);
      }
    }
  }
  unclassified.sort();
  assert.deepEqual(
    unclassified,
    [],
    "ทุก INSERT/UPDATE/DELETE ต้องมี trigger หรือเหตุผลยกเว้น — ไม่งั้นบาง operation จะหายเงียบ",
  );
});

test("operation exemptions stay explicit, exercised, and uncovered", () => {
  const writes = writesByBusinessLayer();
  const triggerOperations = realtimeTriggerOperations();
  for (const key of OPERATION_EXEMPTIONS.keys()) {
    const [table, operation] = key.split(":") as [string, DmlOperation];
    assert.ok(writes.get(table)?.has(operation), `${key} exemption is no longer exercised`);
    assert.ok(
      !triggerOperations.get(table)?.has(operation),
      `${key} is covered now and must be removed from OPERATION_EXEMPTIONS`,
    );
  }
});

test("message delivery metadata keeps its explicit conversation invalidation", () => {
  assert.match(
    INBOX,
    /UPDATE bms_messages SET meta[\s\S]{0,500}publishInboxChanged\(tenantId, row\.conversation_id, "CONVERSATION_CHANGED"\)/,
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

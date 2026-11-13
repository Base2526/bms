import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { auditAdminUi } from "./testing/admin-ui-audit.mjs";
import { createUiTranslator } from "../apps/web/i18n/uiText.ts";
import { buildSchema, parse, validate } from "../apps/web/node_modules/graphql/index.js";
import { pharmacyReviewValue, pharmacyReviewStatus, pharmacyCaseStatus, pharmacyRiskLabel } from "../apps/web/i18n/pharmacyReview.ts";
import { deliveryStatusLabel } from "../apps/web/i18n/deliveryStatus.ts";
import { formatTimeAgo } from "../apps/web/components/comments/Helper.ts";

test("admin and reachable shared UI have no unreviewed authored language leaks", () => {
  const { files, candidates } = auditAdminUi();
  assert.ok(files.length >= 200, "Admin routes and their shared components must be scanned");
  const exceptions = JSON.parse(readFileSync(new URL("./fixtures/admin-ui-copy-exceptions.json", import.meta.url), "utf8"));
  const missing = candidates.filter(({ file, text }: { file: string; text: string }) => !exceptions[file]?.strings.includes(text));
  assert.deepEqual(missing, [], "Localize new UI copy; exceptions are for reviewed data, brands and protocol identifiers only");
  for (const entry of Object.values(exceptions) as Array<{ reason: string }>) assert.ok(entry.reason.length > 20);
});

test("admin translator follows language without translating interpolated store data", () => {
  const th = createUiTranslator("th"), en = createUiTranslator("en");
  assert.equal(th.locale, "th-TH");
  assert.equal(en.locale, "en-GB");
  assert.equal(en.language, "en");
  assert.equal(en("admin_ui.role_activated"), "Role activated successfully");
  assert.equal(th("admin_ui.role_activated"), "เปิดใช้งานบทบาทแล้ว");
  assert.equal(en("unconfigured.key"), "unconfigured.key");
  assert.equal(en("admin_ui.edit_28072", { v0: "ร้านไทย {v1}" }), "Edit ร้านไทย {v1}");
  // Key parity alone cannot detect English values copied into the Thai dictionary.
  for (const key of [
    "admin_settings.refresh", "admin_orders.col_actions", "admin_reports.page_title",
    "admin_profile.field_username", "admin_store_profile.shop_archetype_label",
    "admin_revisions.col_editor", "admin_pharmacy_queue.tab_emergency",
    "admin_pharmacy_queue.tab_urgent", "admin_pharmacy_queue.tab_normal",
    "admin_pharmacy_case.unknown", "admin_inbox.tab_timeline",
  ]) {
    assert.match(th(key), /[ก-๙]/, `${key} must contain its authored Thai label`);
    assert.doesNotMatch(en(key), /[ก-๙]/, `${key} must contain its authored English label`);
  }
});

test("playground stock preview reads the current bounded product connection", () => {
  const source = readFileSync(new URL("../apps/web/app/(admin)/admin/playground/page.tsx", import.meta.url), "utf8");
  const document = source.match(/const Q_PRODUCTS = gql`([\s\S]*?)`/)?.[1];
  assert.ok(document);
  const schema = buildSchema(readFileSync(new URL("../schema.graphql", import.meta.url), "utf8"));
  assert.deepEqual(validate(schema, parse(document)), []);
  assert.match(document, /bmsProducts\(limit: 50\)/);
});

test("pharmacy operator labels translate structured codes and preserve clinical prose", () => {
  const en = createUiTranslator("en"), th = createUiTranslator("th");
  assert.equal(pharmacyReviewValue("SELF", en), "Self");
  assert.equal(pharmacyReviewValue("SELF", th), "ตัวเอง");
  assert.equal(pharmacyReviewValue(false, en), "No");
  assert.equal(pharmacyReviewStatus("INCOMPLETE", th), "ไม่ครบถ้วน");
  assert.equal(pharmacyReviewStatus("PENDING", en), "Awaiting confirmation");
  assert.equal(pharmacyReviewValue("complete", th), "complete");
  assert.equal(pharmacyReviewValue("__proto__", en), "__proto__");
  assert.equal(pharmacyReviewValue("ข้อความต้นฉบับจากเภสัชกร {v0}", en), "ข้อความต้นฉบับจากเภสัชกร {v0}");
  assert.equal(pharmacyReviewValue(null, en), "—");
  assert.equal(pharmacyCaseStatus("WAITING_FOR_PHARMACIST", en), "Awaiting pharmacist");
  assert.equal(pharmacyCaseStatus("APPROVED", th), "อนุมัติแล้ว");
  assert.equal(pharmacyRiskLabel("MODERATE", en), "Moderate");
  assert.equal(pharmacyCaseStatus("FUTURE_STATE", en), "FUTURE_STATE");
});

test("relative comment times and delivery attempt labels follow the operator language", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  assert.equal(formatTimeAgo(now - 120000, "en", now), "2 minutes ago");
  assert.equal(formatTimeAgo(now - 120000, "th", now), "2 นาทีที่ผ่านมา");
  assert.equal(formatTimeAgo(now + 7200000, "en", now), "in 2 hours");
  assert.equal(formatTimeAgo("invalid", "th", now), "");
  const th = createUiTranslator("th"), en = createUiTranslator("en");
  assert.equal(deliveryStatusLabel("PARTIAL", th), "สำเร็จบางส่วน");
  assert.equal(deliveryStatusLabel("SENDING", en), "Sending");
  assert.equal(deliveryStatusLabel("PROVIDER_UNKNOWN", th), "PROVIDER_UNKNOWN");
});

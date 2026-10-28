import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planFeatureKeys } from "../apps/web/lib/bms/featurePolicy";
import { composeBmsPlanReply, isBmsPlanQuestion } from "../apps/web/lib/bms/platformPresales";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("10.101 publishes only enforceable sustainable package limits", () => {
  const sql = read("db/migrations/10.101__bms_sustainable_package_pricing.sql");
  assert.match(sql, /WHEN 'pro' THEN 990/);
  assert.match(sql, /WHEN 'business' THEN 4900/);
  assert.match(sql, /'enterprise', 'Enterprise Factory', 29900, 200000, 20, -1, 4/);
  assert.match(sql, /150, 10000, 10000, 10, 50/);
  assert.match(sql, /max_orders_month = -1/);
  assert.match(sql, /ON CONFLICT \(code\) DO UPDATE/);
  assert.doesNotMatch(sql, /max_(?:storage|api|support|transactions)/i);
});

test("Enterprise retains paid features and is contact-sales only on the public page", () => {
  assert.deepEqual(planFeatureKeys("enterprise"), ["REPORT_SCHEDULE", "RETENTION_ENGINE"]);
  const page = read("apps/web/app/(main)/page.tsx");
  assert.match(page, /plan\.code === "enterprise"/);
  assert.match(page, /BMS_LINE_OA_URL/);
  assert.match(page, /landing\.contactSales/);
  assert.match(page, /landing\.enterpriseTerms/);
});

test("10.102 adds the mid-market Growth plan and annual catalogue prices", () => {
  const sql = read("db/migrations/10.102__bms_growth_and_annual_pricing.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS price_yearly/);
  assert.match(sql, /'growth', 'Growth', 1990, 19900, 15000, 5, -1, 3/);
  assert.match(sql, /15, 2500, 2500, 3, 6/);
  assert.match(sql, /WHEN 'business' THEN 49000/);
  assert.match(sql, /WHEN 'enterprise' THEN 329000/);
  assert.deepEqual(planFeatureKeys("growth"), ["REPORT_SCHEDULE"]);
});

test("verified presales plan copy identifies Enterprise terms without inventing billing", () => {
  const plan = {
    code: "enterprise", name: "Enterprise Factory", price_monthly: 29900, price_yearly: 329000,
    max_products: 200000, max_channels: 20, max_orders_month: -1,
    max_users: 150, max_branches: 10, max_devices: 50,
    ai_credits_monthly: 10000, feature_keys: ["REPORT_SCHEDULE", "RETENTION_ENGINE"] as any,
    verifiedAt: "2026-10-28T00:00:00.000Z",
  };
  assert.equal(isBmsPlanQuestion("ราคา enterprise สำหรับโรงงานใหญ่"), true);
  const thai = composeBmsPlanReply([plan], "th");
  const english = composeBmsPlanReply([plan], "en");
  assert.match(thai, /เริ่ม 29,900 บาท\/เดือน/);
  assert.match(thai, /สัญญารายปีเริ่ม 329,000 บาท/);
  assert.match(english, /from 29,900 THB\/month/);
  assert.match(english, /annual contract/);
  assert.match(thai, /ยังไม่มีการตัดค่าสมาชิกรายเดือนอัตโนมัติ/);
});

test("Thai and English package copy expose the same new pricing keys", () => {
  const thai = read("apps/web/i18n/th.ts");
  const english = read("apps/web/i18n/en.ts");
  for (const key of ["startingAt", "annualPrice", "annualFrom", "perYear", "annualAverage", "contactSales", "enterpriseTerms"]) {
    assert.match(thai, new RegExp(`${key}:`));
    assert.match(english, new RegExp(`${key}:`));
  }
});

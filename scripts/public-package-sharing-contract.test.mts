import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderPublicPackagePdf } from "../apps/web/lib/bms/publicPackagePdf";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const plans = [
  ["free", "Free", 0, 0, 100, 2, 1, 1, 1, 100, []],
  ["pro", "Pro", 990, 9900, 5000, 5, 1, 3, 3, 1000, ["REPORT_SCHEDULE"]],
  ["growth", "Growth", 1990, 19900, 15000, 15, 3, 6, 5, 2500, ["REPORT_SCHEDULE"]],
  ["business", "Business", 4900, 49000, 50000, 40, 5, 10, 10, 5000, ["REPORT_SCHEDULE", "RETENTION_ENGINE"]],
  ["enterprise", "Enterprise Factory", 29900, 329000, 200000, 150, 10, 50, 20, 10000, ["REPORT_SCHEDULE", "RETENTION_ENGINE"]],
].map(([code, name, price_monthly, price_yearly, max_products, max_users, max_branches, max_devices,
  max_channels, ai_credits_monthly, feature_keys]) => ({
  code, name, price_monthly, price_yearly, max_products, max_users, max_branches, max_devices,
  max_channels, max_orders_month: -1, ai_credits_monthly, feature_keys,
})) as any;

test("latest package PDF is a real bounded bilingual document", async () => {
  for (const locale of ["th", "en"] as const) {
    const pdf = await renderPublicPackagePdf(plans, locale, new Date("2026-10-28T03:00:00.000Z"));
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.ok(pdf.length > 8_000);
    assert.ok(pdf.length < 1_000_000);
  }
});

test("public package download is fresh, rate limited and never trusts client plan data", () => {
  const route = read("apps/web/app/api/public/packages/pdf/route.ts");
  assert.match(route, /rateLimit\(`public-package-pdf:/);
  assert.match(route, /listBmsPublicPlans\(\)/);
  assert.match(route, /renderPublicPackagePdf\(plans, locale\)/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.match(route, /Content-Disposition/);
  assert.doesNotMatch(route, /request\.json|searchParams\.get\("plans"\)/);
});

test("pricing page downloads the selected language and shares one always-current URL", () => {
  const page = read("apps/web/app/(main)/page.tsx");
  assert.match(page, /\/api\/public\/packages\/pdf\?lang=\$\{lang\}/);
  assert.match(page, /window\.location\.origin.*#pricing/);
  assert.match(page, /navigator\.share/);
  assert.match(page, /navigator\.clipboard/);
  assert.match(page, /landing\.downloadPackagesPdf/);
  assert.match(page, /landing\.sharePackages/);
});

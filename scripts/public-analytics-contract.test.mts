import assert from "node:assert/strict";
import test from "node:test";
import { analyticsPage, analyticsSource, analyticsCta, validMeasurementId } from "../apps/web/lib/publicAnalytics.ts";
import { parseAnalyticsConsent } from "../apps/web/lib/analyticsConsent.ts";
import { BMS_LINE_OA_URL } from "../apps/web/lib/bms/lineOfficialAccount.ts";

test("public analytics accepts only explicit marketing and known learning paths", () => {
  assert.deepEqual(analyticsPage("/th/restaurant?email=private#token"), { path: "/th/restaurant", locale: "th" });
  const learn = ["/learn", "/learn/guides/start-here"];
  assert.ok(analyticsPage("/en/learn/guides/start-here", learn));
  for (const path of ["/admin/dashboard", "/th/admin", "/th/learn/guides/customer-name", "/shop/tenant/products/sku", "/checkout/token", "/login", "/pos", "/th/restaurant/private", "/restaurant", "/th/learn/search-token"]) {
    assert.equal(analyticsPage(path, learn), null, path);
  }
});
test("measurement ids are opt-in and cannot inject script parameters", () => {
  assert.equal(validMeasurementId(undefined), null);
  assert.equal(validMeasurementId(""), null);
  assert.equal(validMeasurementId(" G-BMSSEOQA "), "G-BMSSEOQA");
  for (const value of ["UA-1234", "G-1234&other=1", "G-<script>", "https://evil.example", "G-a"]) assert.equal(validMeasurementId(value), null);
});
test("referral measurement returns bounded categories, never arbitrary query values or paths", () => {
  assert.equal(analyticsSource("https://jachoei.com/th?utm_source=chatgpt.com&email=secret", ""), "chatgpt");
  assert.equal(analyticsSource("https://jachoei.com/th?utm_source=__proto__", ""), "direct_or_unknown");
  assert.equal(analyticsSource("https://jachoei.com/th?utm_source=constructor", ""), "direct_or_unknown");
  assert.equal(analyticsSource("https://jachoei.com/en", "https://perplexity.ai/search/private-question"), "perplexity");
  assert.equal(analyticsSource("https://jachoei.com/th", "https://www.google.co.th/search?q=private"), "google");
  assert.equal(analyticsSource("https://jachoei.com/th", "https://google.com.attacker.test/"), "other_referral");
  assert.equal(analyticsSource("https://jachoei.com/th?utm_source=customer-phone", ""), "direct_or_unknown");
  assert.equal(analyticsSource("https://jachoei.com/th", "https://jachoei.com/admin/customers/secret"), "internal");
});
test("CTA telemetry names only supported intent, never claims a completed signup or sale", () => {
  const origin = "https://jachoei.com";
  assert.equal(analyticsCta("/shop-signup?email=secret", origin), "signup_start");
  assert.equal(analyticsCta("/en/demo", origin), "demo_open");
  assert.equal(analyticsCta(BMS_LINE_OA_URL, origin), "line_contact");
  assert.equal(analyticsCta("https://line.me/R/ti/p/another-shop", origin), null);
  assert.equal(analyticsCta("https://evil.test/shop-signup", origin), null);
  assert.equal(analyticsCta("/admin/dashboard", origin), null);
});
test("consent expires, rejects malformed/future data, and does not imply consent from missing data", () => {
  const now = Date.parse("2026-10-29T00:00:00Z");
  const encode = (value: string, at: string) => JSON.stringify({ value, at });
  assert.equal(parseAnalyticsConsent(encode("allow", "2026-10-28"), now), "allow");
  assert.equal(parseAnalyticsConsent(encode("reject", "2026-10-28"), now), "reject");
  for (const raw of [null, "bad", "{}", encode("allow", "2026-10-30"), encode("allow", "2025-10-29"), encode("yes", "2026-10-28"), encode("allow", "bad")]) assert.equal(parseAnalyticsConsent(raw, now), null);
});

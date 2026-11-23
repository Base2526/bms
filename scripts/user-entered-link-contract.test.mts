import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { safePublicWebsiteUrl, safeStoredLinkUrl } from "../apps/web/lib/safeLinkUrl.ts";

// 2026-11-23 recheck: a shop owner's website (public shop page) and a staff-entered payment slip
// URL (payment review screen) were rendered as raw <a href>. React 18 only warns about
// javascript: hrefs, so any scheme reached the visitor/reviewer.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("a shop website is shown only as an http(s) URL", () => {
  assert.equal(safePublicWebsiteUrl("shop.example"), "https://shop.example/");
  assert.equal(safePublicWebsiteUrl("http://shop.example/menu"), "http://shop.example/menu");
  for (const unsafe of [null, "", "javascript:alert(document.domain)", "JAVASCRIPT:alert(1)",
    "data:text/html,FAKE", "vbscript:msgbox(1)", " javascript:alert(1)", "https://"]) {
    assert.equal(safePublicWebsiteUrl(unsafe), null, String(unsafe));
  }
});

test("a stored link opens only an http(s) URL or a same-origin path", () => {
  assert.equal(safeStoredLinkUrl("/api/files/42"), "/api/files/42");
  assert.equal(safeStoredLinkUrl("https://bank.example/slip/1"), "https://bank.example/slip/1");
  for (const unsafe of [null, "", "javascript:alert(1)", "data:image/svg+xml,FAKE", "//evil.example/x",
    "/\\evil.example", "ftp://example.test/x", "shop.example/slip"]) {
    assert.equal(safeStoredLinkUrl(unsafe), null, String(unsafe));
  }
});

test("public shop pages and the payment review screen render user-entered links through the guards", () => {
  const landing = read("../apps/web/app/(main)/shop/[tenantSlug]/ShopLandingView.tsx");
  assert.doesNotMatch(landing, /href=\{shop\.website\}/);
  assert.match(landing, /safePublicWebsiteUrl\(shop\.website\)/);
  const product = read("../apps/web/app/(main)/shop/[tenantSlug]/products/[sku]/PublicProductView.tsx");
  assert.doesNotMatch(product, /function safeWebsite\(/);
  assert.match(product, /safePublicWebsiteUrl\(shop\.website\)/);
  const payment = read("../apps/web/app/(admin)/admin/payment/page.tsx");
  assert.doesNotMatch(payment, /href=\{r\.slipUrl\}/);
  // Desktop and mobile each guard both the render condition and the href.
  assert.equal((payment.match(/safeStoredLinkUrl\(r\.slipUrl\)/g) ?? []).length, 4);
});

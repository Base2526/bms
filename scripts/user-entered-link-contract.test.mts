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

// 2026-11-24 recheck: the staff Inbox turned ANY message body, including a customer's, into a
// system-styled coupon/product card, and used the whole wallet line as the card button's href. A
// customer could send "coupon / CODE X / https://evil.example/coupon/wallet?t=1" and staff saw an
// official-looking "Open coupon wallet" button to that site.
test("Inbox share cards come only from outbound messages and the wallet link is guarded", () => {
  // Raw source on purpose: read()'s naive block-comment stripper swallows most of this file because
  // its regex literals contain "/*". Each pattern is anchored to a code line (no leading //).
  const inbox = readFileSync(new URL("../apps/web/app/(admin)/admin/inbox/page.tsx", import.meta.url), "utf8")
    .replace(/\r\n/g, "\n");
  assert.match(inbox, /^\s+const product = isIn \? null : parseProductShare\(m\.body\);$/m);
  assert.match(inbox, /^\s+const coupon = isIn \? null : parseCouponShare\(m\.body\);$/m);
  const start = inbox.indexOf("\nfunction parseCouponShare(");
  assert.ok(start >= 0, "parser anchor must exist");
  const parser = inbox.slice(start, inbox.indexOf("\n}\n", start) + 3);
  assert.match(parser, /^\s+const walletUrl = safeStoredLinkUrl\(/m);
});

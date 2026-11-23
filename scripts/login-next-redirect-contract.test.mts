import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { safeInternalRedirectPath } from "../apps/web/lib/safeRedirect.ts";

// 2026-11-23 recheck: /admin/login passed ?next= straight to router.replace(), so a crafted login
// link sent a freshly signed-in admin to another origin (or a javascript: URL).

test("only same-origin paths survive as a post-login destination", () => {
  for (const [input, expected] of [
    ["/admin/orders?status=PAID#top", "/admin/orders?status=PAID#top"],
    ["/pos", "/pos"],
    [null, "/admin"],
    ["", "/admin"],
    ["https://evil.example/admin", "/admin"],
    ["//evil.example/admin", "/admin"],
    ["/\\evil.example", "/admin"],
    ["\\\\evil.example", "/admin"],
    ["javascript:alert(document.domain)", "/admin"],
    ["JaVaScRiPt:alert(1)", "/admin"],
    ["data:text/html,FAKE", "/admin"],
    ["/admin\n//evil.example", "/admin"],
    ["/%09/evil.example", "/%09/evil.example"],
    ["admin", "/admin"],
  ] as const) {
    assert.equal(safeInternalRedirectPath(input), expected, String(input));
  }
  assert.equal(safeInternalRedirectPath("https://evil.example", "/admin/dashboard"), "/admin/dashboard");
});

test("the admin login page only navigates to the sanitized destination", () => {
  const source = readFileSync(new URL("../apps/web/app/(admin)/admin/login/page.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(source, /const next = safeInternalRedirectPath\(sp\.get\("next"\)\);/);
  assert.doesNotMatch(source, /sp\.get\("next"\) \|\|/);
});

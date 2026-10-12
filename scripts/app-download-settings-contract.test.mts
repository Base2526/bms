import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeAppDownloadSettings, InvalidAppDownloadSettings } from "../apps/web/lib/bms/appDownloadValidation.ts";

test("download links allow HTTPS stores and APKs, normalize whitespace and can be cleared", () => {
  assert.deepEqual(normalizeAppDownloadSettings({ androidUrl: "  https://downloads.example.com/bms.apk  ", iosUrl: "https://apps.apple.com/th/app/id123" }), {
    androidUrl: "https://downloads.example.com/bms.apk", iosUrl: "https://apps.apple.com/th/app/id123",
  });
  assert.deepEqual(normalizeAppDownloadSettings({ androidUrl: " ", iosUrl: "" }), { androidUrl: "", iosUrl: "" });
  assert.deepEqual(normalizeAppDownloadSettings({ androidUrl: "HTTPS://DOWNLOADS.EXAMPLE.COM/bms.apk", iosUrl: "" }), {
    androidUrl: "https://downloads.example.com/bms.apk", iosUrl: "",
  });
});

test("download links reject executable schemes, credentials, malformed or oversized URLs", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "http://example.com", "//example.com", "/download/android", "https://user:pass@example.com", "https://", "https:example.com", "https:/example.com", "https:///example.com", "https://example.com\\@other.example", "https://example.com/a\nb", `https://example.com/${"x".repeat(2048)}`, `https://example.com/${"ก".repeat(250)}`, null, 123]) {
    assert.throws(() => normalizeAppDownloadSettings({ androidUrl: value, iosUrl: "" }), InvalidAppDownloadSettings);
    assert.throws(() => normalizeAppDownloadSettings({ androidUrl: "", iosUrl: value }), InvalidAppDownloadSettings);
  }
  for (const input of [null, [], {}, { androidUrl: "" }]) {
    assert.throws(() => normalizeAppDownloadSettings(input), InvalidAppDownloadSettings);
  }
});

test("global download settings guard page and both admin methods, and recheck service writes", () => {
  const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const route = read("apps/web/app/api/admin/app-downloads/route.ts");
  assert.equal((route.match(/await authorizePlatformAdminRoute\(\)/g) ?? []).length, 2);
  assert.match(read("apps/web/app/(admin)/admin/app-downloads/layout.tsx"), /await requirePlatformAdminPage\(\)/);
  const service = read("apps/web/lib/bms/appDownloadSettings.ts");
  const update = service.slice(service.indexOf("export async function updateAppDownloadSettings"));
  assert.ok(update.indexOf("await requirePlatformAdmin(ctx)") < update.indexOf("await query("));
  assert.ok(update.indexOf("normalizeAppDownloadSettings(input)") < update.indexOf("await query("));
});

// Run only against the isolated installer-report dev server, never production.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE || "playwright");
const jwt = require("jsonwebtoken");
const base = "http://localhost:3107";
const secret = "installer-reports-isolated-dev-only";
const cookieFor = id => `ADMIN_COOKIE=${jwt.sign({ id, role: "Administrator" }, secret, { expiresIn: "10m" })}`;
const adminId = "11111111-1111-4111-8111-111111111111";
const adminCookie = cookieFor(adminId);
const api = async (path, options) => fetch(base + path, options);
assert.equal((await api("/api/admin/installer-reports")).status, 401);
assert.equal((await api("/api/admin/installer-reports", { headers: { Cookie: cookieFor("22222222-2222-4222-8222-222222222222") } })).status, 403);
assert.equal((await api("/api/admin/installer-reports", { headers: { Cookie: adminCookie } })).status, 200);
const payload = Buffer.from(JSON.stringify({ formatVersion: 1, product: "server-pos", installerVersion: "0.2.13-pilot.1", stage: "start-postgres", createdAt: new Date().toISOString(),
  failure: { message: "PostgreSQL service did not become healthy", hresult: -1, scriptLine: 320 },
  machine: { windows: { name: "Windows 11", version: "10.0", build: "26100", architecture: "64-bit" }, hardware: { ramBytes: 8589934592 }, wsl: { packageVersion: "2.5.0" } } }));
assert.equal((await api("/api/installer-reports", { method: "POST", body: payload, headers: { "Content-Type": "application/json" } })).status, 400);
const response = await api("/api/installer-reports", { method: "POST", body: payload, headers: { "Content-Type": "application/json", "X-BMS-Report-Consent": "1" } });
assert.equal(response.status, 202);
const { reportId } = await response.json();
const replay = await api("/api/installer-reports", { method: "POST", body: payload, headers: { "Content-Type": "application/json", "X-BMS-Report-Consent": "1" } });
assert.equal((await replay.json()).reportId, reportId);
assert.equal((await api(`/api/admin/installer-reports/${reportId}`)).status, 401);
assert.equal((await api(`/api/admin/installer-reports/${reportId}`, { method: "PATCH", headers: { Cookie: adminCookie, "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ revision: 0, status: "RESOLVED", note: "" }) })).status, 403);
const output = new URL("../.test-output/installer-ui/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "lang", value: "en", url: base }, { name: "theme", value: "light", url: base }]);
  const page = await context.newPage();
  await page.goto(base + "/installer-report");
  await page.getByRole("heading", { name: "BMS installation report" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Send report", exact: true }).isDisabled(), true);
  await page.locator('input[type="file"]').setInputFiles({ name: "diagnostics.json", mimeType: "application/json", buffer: payload });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send report", exact: true }).click();
  await page.getByText("Report received. Reference:").waitFor();
  await page.screenshot({ path: new URL("submit-desktop.png", output).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: new URL("submit-mobile.png", output).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await context.addCookies([{ name: "ADMIN_COOKIE", value: adminCookie.slice("ADMIN_COOKIE=".length), url: base }]);
  // The surrounding admin shell uses unrelated tenant services; fixture those only.
  // Report APIs remain real, with the disposable Postgres database and session guard.
  await page.route("**/api/auth/me**", route => route.fulfill({ json: { user: null, admin: { id: adminId, role: "Administrator", is_platform_admin: true, language: "en" } } }));
  await page.route("**/api/graphql**", route => route.fulfill({ json: { data: { bmsActingTenant: null, bmsIsPlatformAdmin: true, bmsStoreProfile: null, myBmsPermissions: [], bmsAiProviderHealthCount: 0 } } }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + "/admin/installer-reports");
  await page.getByRole("heading", { name: "Installer error reports", exact: true }).waitFor();
  await page.getByRole("button", { name: "PostgreSQL service did not become healthy", exact: true }).first().waitFor();
  await page.screenshot({ path: new URL("admin-desktop.png", output).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true });
  await page.getByRole("button", { name: "PostgreSQL service did not become healthy", exact: true }).first().click();
  await page.getByText("Report details", { exact: true }).waitFor();
  await page.locator("textarea").fill("Investigated with isolated test evidence");
  const saved = page.waitForResponse(response => response.url().endsWith(reportId) && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  assert.equal((await saved).status(), 200);
  const detail = await (await api(`/api/admin/installer-reports/${reportId}`, { headers: { Cookie: adminCookie } })).json();
  assert.equal(detail.note, "Investigated with isolated test evidence");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const panel = document.querySelector('.ant-drawer-content-wrapper')?.getBoundingClientRect();
    return panel && panel.left >= 0 && panel.right <= innerWidth + 1;
  });
  await page.screenshot({ path: new URL("detail-mobile.png", output).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({ path: new URL("admin-mobile.png", output).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log("Installer reports: real HTTP auth/consent/idempotency, submission and admin UI desktop/mobile passed.");
} finally { await browser.close(); }

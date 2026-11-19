// Local UI fixture: all APIs are intercepted, so no tenant write reaches a database.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE || "playwright");
const origin = process.env.BMS_ADMIN_SMOKE_ORIGIN || "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname));
const screenshotDir = new URL("../.test-output/platform-tenant-confirmation/", import.meta.url);
mkdirSync(screenshotDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.addCookies([
      { name: "ADMIN_COOKIE", value: "FAKE-tenant-confirmation-fixture", url: origin },
      { name: "lang", value: "en", url: origin },
    ]);
    const writes = [];
    await context.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/auth/me") return route.fulfill({ json: {
        isAuthenticated: true, admin: { id: "FAKE-platform", role: "Administrator", name: "Fixture" },
      } });
      if (pathname !== "/api/graphql") return route.fulfill({ json: {} });
      const { query, variables } = route.request().postDataJSON();
      if (query.includes("mutation")) {
        writes.push({ query, variables });
        return route.fulfill({ json: { data: {
          [query.includes("bmsSetTenantPlan") ? "bmsSetTenantPlan" : "bmsSetTenantActive"]: true,
        } } });
      }
      return route.fulfill({ json: { data: {
        bmsIsPlatformAdmin: true,
        myBmsPermissions: ["billing.view", "settings.manage"],
        bmsActingTenant: null,
        bmsMe: { id: "FAKE-platform", email: "fixture@example.invalid", tenant: { id: "FAKE", name: "Fixture", slug: "fixture" } },
        bmsTenants: [{ id: "FAKE", name: "Fixture Shop", slug: "fixture", plan: "free", active: true,
          created_at: "2026-11-14T00:00:00Z", users: 1, products: 0, orders: 0, revenue: 0 }],
        bmsBilling: { plans: [{ code: "free", name: "Free" }, { code: "pro", name: "Pro" }] },
        bmsPackageMetrics: { available: true, from: "2026-10-14", to: "2026-11-14", untrackedTenants: 0, cohorts: [], costs: [] },
      } } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(20000);
    await page.goto(`${origin}/admin/tenants`);
    await page.getByRole("heading", { name: "All Shops" }).waitFor();
    const row = page.getByRole("row").filter({ hasText: "Fixture Shop" });
    await row.getByRole("switch").click();
    const confirm = page.locator(".ant-modal-confirm");
    await confirm.locator(".ant-modal-confirm-title", { hasText: "Suspend this shop?" }).waitFor();
    await page.waitForFunction(() => {
      const dialog = document.querySelector(".ant-modal-confirm");
      return dialog && getComputedStyle(dialog).opacity === "1" && !dialog.className.includes("zoom");
    });
    const dialogBounds = await confirm.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
        viewportWidth: innerWidth, viewportHeight: innerHeight };
    });
    assert.ok(dialogBounds.left >= -1 && dialogBounds.right <= dialogBounds.viewportWidth + 1 &&
      dialogBounds.top >= -1 && dialogBounds.bottom <= dialogBounds.viewportHeight + 1,
      `Confirmation dialog must fit the viewport: ${JSON.stringify(dialogBounds)}`);
    await page.screenshot({ path: new URL(`suspend-${width}.png`, screenshotDir).pathname });
    assert.equal(writes.length, 0, "Opening confirmation cannot write");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await confirm.waitFor({ state: "hidden" });
    assert.equal(writes.length, 0, "Cancelling confirmation cannot write");
    await row.getByRole("switch").click();
    await confirm.getByRole("button", { name: "Confirm change" }).click();
    await confirm.waitFor({ state: "hidden" });
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].variables, { tenantId: "FAKE", active: false, confirm: true });

    await row.locator(".ant-select-selector").click();
    await page.locator(".ant-select-dropdown:visible").getByText("Pro", { exact: true }).click();
    await confirm.locator(".ant-modal-confirm-title", { hasText: "Change this shop's plan?" }).waitFor();
    assert.equal(writes.length, 1);
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await confirm.waitFor({ state: "hidden" });
    assert.equal(writes.length, 1);
    await row.locator(".ant-select-selector").click();
    await page.locator(".ant-select-dropdown:visible").getByText("Pro", { exact: true }).click();
    await confirm.getByRole("button", { name: "Confirm change" }).click();
    await confirm.waitFor({ state: "hidden" });
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1].variables, { tenantId: "FAKE", planCode: "pro", confirm: true });
    assert.deepEqual(errors, []);
    console.log(`PASS platform tenant confirmation at ${width}px`);
    await context.close();
  }
} finally {
  await browser.close();
}

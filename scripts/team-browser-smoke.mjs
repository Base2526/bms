// Local-only synthetic UI smoke. All APIs are intercepted; no real account is changed.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE || "playwright");
const origin = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const rows = Array.from({ length: 23 }, (_, index) => ({
  id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
  name: `FAKE Employee ${String(index + 1).padStart(2, "0")}`,
  email: `fake-team-${index + 1}@example.invalid`, phone: null, role: "Sales",
  created_at: "2026-11-14T10:00:00Z", avatar: null, tenantName: "FAKE Shop",
  lastLoginAt: null, is_platform_admin: false,
}));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.routeWebSocket(/.*/, socket => socket.onMessage(raw => {
      try {
        if (JSON.parse(String(raw)).type === "connection_init") {
          socket.send(JSON.stringify({ type: "connection_ack" }));
        }
      } catch { /* fixture ignores unrelated frames */ }
    }));
    await context.addCookies([
      { name: "ADMIN_COOKIE", value: "FAKE-team-smoke", url: origin },
      { name: "lang", value: "th", url: origin },
    ]);
    const reads = [];
    const errors = [];
    await context.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/auth/me") return route.fulfill({ json: {
        isAuthenticated: true,
        admin: { id: rows[0].id, role: "Administrator", name: rows[0].name, language: "th" },
      } });
      if (pathname === "/api/graphql") {
        const { query = "", variables = {} } = route.request().postDataJSON();
        assert.doesNotMatch(query, /\bmutation\b/i, "UI smoke must not write accounts");
        if (query.includes("users(")) {
          reads.push(variables);
          const filtered = rows.filter(row => !variables.search ||
            `${row.name} ${row.email}`.toLowerCase().includes(String(variables.search).toLowerCase()));
          return route.fulfill({ json: { data: { users: {
            items: filtered.slice(variables.offset || 0, (variables.offset || 0) + (variables.limit || 10)),
            total: filtered.length,
          } } } });
        }
        if (query.includes("bmsMe")) return route.fulfill({ json: { data: { bmsMe: {
          id: rows[0].id, role: "Administrator", is_platform_admin: false,
        } } } });
        if (query.includes("roles")) return route.fulfill({ json: { data: { roles: [
          { id: "22222222-2222-4222-8222-222222222222", name: "Administrator", description: null, is_active: true },
          { id: "33333333-3333-4333-8333-333333333333", name: "Sales", description: null, is_active: true },
        ] } } });
        if (query.includes("user(")) return route.fulfill({ json: { data: { user: {
          ...rows[0], role_id: "22222222-2222-4222-8222-222222222222",
        } } } });
        if (query.includes("myBmsPermissions")) return route.fulfill({ json: {
          data: { myBmsPermissions: ["user.view", "user.manage"] },
        } });
        return route.fulfill({ json: { data: {} } });
      }
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/admin/users`, { waitUntil: "domcontentloaded" });
    await page.getByText("FAKE Employee 01").first().waitFor();
    assert.equal(await page.getByText("FAKE Employee 11").count(), 0);
    if (width === 390) {
      await page.locator(".ant-pagination-next").last().click();
    } else {
      await page.locator(".ant-pagination-item-2").last().click();
    }
    await page.getByText("FAKE Employee 11").first().waitFor();
    assert.ok(reads.some(read => read.offset === 10), `page 2 missing at ${width}px`);
    for (const path of ["/admin/users/new", `/admin/users/${rows[0].id}/edit`]) {
      await page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
      await page.locator("form input:not([type=file])").first().waitFor();
    }
    assert.deepEqual(errors, [], `page errors at ${width}px`);
    console.log(`team users ${width}px: list, new, edit loaded; page 2 fetched; no page errors`);
    await context.close();
  }
} finally {
  await browser.close();
}

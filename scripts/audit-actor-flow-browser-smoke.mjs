// Local-only UI smoke: intercepts APIs and does not write business data.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE || "playwright");
const origin = process.env.BMS_SMOKE_URL || "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname));
const output = new URL("../.test-output/audit-actor-flow/", import.meta.url);
await mkdir(output, { recursive: true });

const actorId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-11-16T10:00:00.000Z";
const row = (id, action, actorUserId = actorId) => ({
  id, source: "BUSINESS", actor: "a@example.test", actorUserId,
  action, target: `FAKE-${id}`, meta: { reason: "FAKE fixture" },
  outcome: null, created_at: timestamp,
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.routeWebSocket(/.*/, socket => socket.onMessage(raw => {
      try {
        if (JSON.parse(String(raw)).type === "connection_init") {
          socket.send(JSON.stringify({ type: "connection_ack" }));
        }
      } catch { /* synthetic fixture ignores unrelated frames */ }
    }));
    await context.addCookies([
      { name: "ADMIN_COOKIE", value: "FAKE-audit-flow-fixture", url: origin },
      { name: "lang", value: "th", url: origin },
    ]);
    const actorFilters = [];
    await context.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/auth/me") {
        return route.fulfill({ json: { isAuthenticated: true,
          admin: { id: actorId, role: "Administrator", name: "FAKE admin", tenant_id: actorId } } });
      }
      if (pathname === "/api/graphql") {
        const { query = "", variables = {} } = route.request().postDataJSON() || {};
        let data = {};
        if (query.includes("AuditActorFlow")) {
          actorFilters.push(variables.filter);
          data = { bmsAuditTimeline: variables.filter?.cursor
            ? { nodes: [row("BUSINESS:older", "auth.logout")], nextCursor: null }
            : { nodes: [row("BUSINESS:recent", "order.pay"), row("BUSINESS:middle", "stock.adjust")], nextCursor: "FAKE-cursor" } };
        } else if (query.includes("AuditTimeline")) {
          data = { bmsIsPlatformAdmin: false, bmsActingTenant: null,
            bmsAuditTimeline: { nodes: [row("BUSINESS:recent", "order.pay"),
              row("BUSINESS:legacy", "inbox.reply", null)], nextCursor: null } };
        } else if (query.includes("myBmsPermissions")) {
          data = { myBmsPermissions: [] };
        }
        return route.fulfill({ json: { data } });
      }
      return route.fulfill({ json: {} });
    });

    const page = await context.newPage();
    await page.goto(`${origin}/admin/audit`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByRole("heading", { name: "บันทึกการตรวจสอบ" }).waitFor();
    await page.getByRole("button", { name: "ดูเหตุการณ์ของ a@example.test" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "ดูเหตุการณ์ของ a@example.test" }).count(), 1,
      "legacy email-only row does not link to a verified actor");
    await page.getByRole("button", { name: "ดูเหตุการณ์ของ a@example.test" }).click();
    const dialog = page.getByRole("dialog", { name: "ลำดับเหตุการณ์ของ a@example.test" });
    await dialog.waitFor();
    await dialog.getByText("ออเดอร์ · ชำระเงินแล้ว").waitFor();
    assert.equal(await dialog.locator(".ant-timeline-item").count(), 2);
    await dialog.getByRole("button", { name: "หน้าถัดไป" }).click();
    await dialog.getByText("auth.logout").waitFor();
    assert.equal(await dialog.locator(".ant-timeline-item").count(), 1,
      "only the active page is rendered");
    await dialog.getByRole("button", { name: "หน้าก่อน" }).click();
    await dialog.getByText("ออเดอร์ · ชำระเงินแล้ว").waitFor();
    assert.equal(await dialog.locator(".ant-timeline-item").count(), 2);
    assert.deepEqual(actorFilters.map(filter => filter.actorUserId), [actorId, actorId, actorId]);
    assert.ok(actorFilters[1].cursor, "earlier page uses the server cursor");
    assert.equal(actorFilters[2].cursor, null, "previous page restores its cursor");
    await page.screenshot({ path: fileURLToPath(new URL(`audit-flow-${width}.png`, output)) });
    await context.close();
    console.log(`audit actor flow ${width}px: ok`);
  }
} finally {
  await browser.close();
}

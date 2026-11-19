// Local-only synthetic render benchmark. No database reads or business writes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE || "playwright");
const origin = process.env.BMS_SMOKE_URL || "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname));
const pages = Number(process.env.BMS_AUDIT_PERF_PAGES || 40);
assert.ok(Number.isInteger(pages) && pages >= 2 && pages <= 100);
const cpuRate = Number(process.env.BMS_AUDIT_PERF_CPU_RATE || 1);
assert.ok(Number.isFinite(cpuRate) && cpuRate >= 1 && cpuRate <= 8);
const actorId = "11111111-1111-4111-8111-111111111111";
const row = (index) => ({
  id: `BUSINESS:${index}`, source: "BUSINESS", actor: "a@example.test",
  actorUserId: actorId, action: `FAKE-action-${index}`, target: `FAKE-target-${index}`,
  meta: { reason: "FAKE fixture", count: index }, outcome: null,
  created_at: new Date(Date.UTC(2026, 10, 16, 10, 0, 0) - index * 1000).toISOString(),
});
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

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
      { name: "ADMIN_COOKIE", value: "FAKE-audit-perf-fixture", url: origin },
      { name: "lang", value: "th", url: origin },
    ]);
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
          const pageIndex = Number(variables.filter?.cursor || 0);
          data = { bmsAuditTimeline: {
            nodes: Array.from({ length: 30 }, (_, offset) => row(pageIndex * 30 + offset)),
            nextCursor: pageIndex + 1 < pages ? String(pageIndex + 1) : null,
          } };
        } else if (query.includes("AuditTimeline")) {
          data = { bmsIsPlatformAdmin: false, bmsActingTenant: null,
            bmsAuditTimeline: { nodes: [row(0)], nextCursor: null } };
        } else if (query.includes("myBmsPermissions")) data = { myBmsPermissions: [] };
        return route.fulfill({ json: { data } });
      }
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage();
    if (cpuRate > 1) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
    }
    await page.goto(`${origin}/admin/audit`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByRole("heading", { name: "บันทึกการตรวจสอบ" }).waitFor();
    await page.getByRole("button", { name: "ดูเหตุการณ์ของ a@example.test" }).waitFor();
    await page.getByRole("button", { name: "ดูเหตุการณ์ของ a@example.test" }).click();
    const dialog = page.getByRole("dialog", { name: "ลำดับเหตุการณ์ของ a@example.test" });
    await dialog.getByText("FAKE-action-29").waitFor();
    const durations = [];
    let finalNodes = 0;
    for (let pageIndex = 1; pageIndex < pages; pageIndex++) {
      const start = performance.now();
      await dialog.getByRole("button", { name: /โหลดรายการก่อนหน้า|หน้าถัดไป/ }).click();
      await dialog.getByText(`FAKE-action-${pageIndex * 30 + 29}`).waitFor();
      durations.push(performance.now() - start);
    }
    finalNodes = await dialog.locator(".ant-timeline-item").count();
    const allDomNodes = await page.evaluate(() => document.querySelectorAll("*").length);
    const first = durations.slice(0, 5), last = durations.slice(-5);
    console.log(JSON.stringify({ width, cpuRate, pages, loadedEvents: pages * 30, visibleFlowNodes: finalNodes,
      allDomNodes, firstFiveMedianMs: Math.round(median(first)), lastFiveMedianMs: Math.round(median(last)),
      slowestMs: Math.round(Math.max(...durations)) }));
    await context.close();
  }
} finally {
  await browser.close();
}

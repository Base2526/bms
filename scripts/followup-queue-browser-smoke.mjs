// Local-only Follow-up Queue UI fixture. All APIs are intercepted; no customer message is sent.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE || "playwright");
const origin = process.env.BMS_ADMIN_SMOKE_ORIGIN || "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname));

const now = "2026-11-15T00:00:00Z";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.addCookies([
      { name: "ADMIN_COOKIE", value: "FAKE-followup-fixture", url: origin },
      { name: "lang", value: "en", url: origin },
    ]);
    await context.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/auth/me") return route.fulfill({ json: {
        isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", name: "Fixture" },
      } });
      if (pathname !== "/api/graphql") return route.fulfill({ json: {} });
      const body = route.request().postDataJSON();
      assert.ok(!body.query.includes("mutation"), "The smoke must not run a follow-up job");
      return route.fulfill({ json: { data: {
        myBmsPermissions: ["followup.view"],
        bmsIsPlatformAdmin: false, bmsActingTenant: null, bmsStoreProfile: null,
        bmsMe: { id: "FAKE-admin", role: "Administrator", is_available: true, gender: null,
          tenant: { slug: "fixture" } },
        bmsFollowupQueue: [{ id: "FAKE-job", status: "STOPPED", nextRunAt: now,
          retryCount: 0, lastResult: "channel_no_outbound", conversationId: "FAKE-conversation",
          ruleId: "FAKE-rule", intent: "QUESTION", messageGoal: "Follow up", priority: 1,
          maxRetry: 1, businessHoursOnly: false, customerName: "Fixture Customer",
          lastMessageAt: now, idleMinutes: 60, customerLifetimeValue: 0, totalOrders: 0,
          score: 0, scoreLabel: "COLD", scoreReasons: [], updatedAt: now }],
        bmsFollowupHistory: [{ id: "FAKE-history", conversationId: "FAKE-conversation",
          ruleId: "FAKE-rule", outcome: "SENT", reason: "delivery_status_unconfirmed",
          messageBody: "Fixture follow-up", goal: "Follow up", createdAt: now }],
        bmsFollowupAnalytics: null,
      } } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(20000);
    await page.goto(`${origin}/admin/followup-queue`);
    await page.getByText("Automatic follow-up stopped: BMS cannot send to this channel. Contact the customer in the provider app.").waitFor();
    await page.getByRole("tab", { name: /History/ }).click();
    await page.getByText("Provider accepted the message, but the send status was not saved. Check the channel before contacting again.").waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS Follow-up Queue reasons at ${width}px`);
    await context.close();
  }
} finally {
  await browser.close();
}

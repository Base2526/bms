// Local-only Inbox UI fixture. All APIs are intercepted; no customer message is sent.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE || "playwright");
const origin = process.env.BMS_ADMIN_SMOKE_ORIGIN || "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname));
const out = new URL("../.test-output/inbox-partial/", import.meta.url);
mkdirSync(out, { recursive: true });
const now = "2026-11-14T00:00:00Z";
const conversation = { id: "FAKE-conversation", channel: "facebook", customerRef: "FAKE-customer",
  customerId: null, customerName: "Fixture Customer", customerAvatar: null,
  sourceDisplayName: "Fixture Page", sourceHandle: null, sourceAvatar: null,
  status: "OPEN", tags: [], unread: 0, lastMessage: "Fixture reply", lastMessageAt: now, createdAt: now,
  assignedStaff: null, helpers: [], systemEvents: [], notes: [], messages: [{
    id: "FAKE-message", direction: "OUT", body: "Fixture reply", sender: "staff:fixture",
    createdAt: now, attachment: null, status: "PARTIAL", canReportDelivery: true,
  }, {
    id: "FAKE-pending", direction: "OUT", body: "Fixture uncertain reply", sender: "staff:fixture",
    createdAt: now, attachment: null, status: "PENDING", canReportDelivery: true,
  }] };
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-inbox-fixture", url: origin },
      { name: "lang", value: "en", url: origin }]);
    await context.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/auth/me") return route.fulfill({ json: {
        isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", name: "Fixture" },
      } });
      if (pathname !== "/api/graphql") return route.fulfill({ json: {} });
      const body = route.request().postDataJSON();
      if (body.query.includes("mutation")) {
        assert.ok(body.query.includes("bmsMarkConversationRead"), "The smoke must not send or retry a reply");
        return route.fulfill({ json: { data: { bmsMarkConversationRead: true } } });
      }
      return route.fulfill({ json: { data: {
        myBmsPermissions: ["inbox.view", "inbox.reply", "inbox.manage"],
        bmsIsPlatformAdmin: false, bmsActingTenant: null, bmsStoreProfile: null,
        bmsMe: { id: "FAKE-admin", role: "Administrator", is_available: true, gender: null,
          tenant: { slug: "fixture" } },
        bmsConversations: [conversation], bmsConversation: conversation,
        bmsAssignableStaff: [], bmsInboxUnreadCount: 0, bmsMyMentionsUnreadCount: 0,
      } } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(20000);
    await page.goto(`${origin}/admin/inbox?c=FAKE-conversation`);
    await page.getByText("Partly sent — review in the channel before replying again").waitFor();
    await page.getByText("Delivery pending").waitFor();
    assert.equal(await page.getByRole("button", { name: "Resend" }).count(), 0);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: new URL(`partial-${width}.png`, out).pathname });
    console.log(`PASS Inbox partial-delivery state at ${width}px`);
    await context.close();
  }
} finally {
  await browser.close();
}

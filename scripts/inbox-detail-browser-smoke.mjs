// Local-only browser smoke. GraphQL and auth are intercepted; no customer channel is contacted.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE || "playwright");
const origin = process.env.BMS_ADMIN_SMOKE_ORIGIN || "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname));
const atFor = body => body === "Second fixture message"
  ? "2026-11-19T06:01:00.000Z" : "2026-11-19T06:00:00.000Z";
const fixture = (body, unread = 1) => ({
  id: "FAKE-inbox-detail", channel: "line", supportsOutboundPush: true,
  customerRef: "FAKE-customer", customerId: null, customerName: "Fixture Customer",
  customerAvatar: null, sourceDisplayName: "Fixture LINE", sourceHandle: null,
  sourceAvatar: null, status: "OPEN", tags: [], unread, lastMessage: body,
  lastMessageAt: atFor(body), createdAt: atFor(body), assignedStaff: null, helpers: [],
  systemEvents: [], notes: [], messages: [{ id: body === "Second fixture message" ? "2" : "1",
    direction: "IN", body, sender: "customer", createdAt: atFor(body),
    attachment: null, status: "SENT", canReportDelivery: false }],
});
const otherFixture = () => ({ ...fixture("Other fixture message", 0),
  id: "FAKE-other", customerRef: "FAKE-other", customerName: "Other Fixture",
  messages: [{ ...fixture("Other fixture message", 0).messages[0], id: "3" }],
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-inbox-fixture", url: origin },
      { name: "lang", value: "en", url: origin }]);
    let body = "First fixture message";
    let readBody = null;
    let failDetailOnce = true;
    let markReadCalls = 0;
    let detailCalls = 0;
    await context.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/auth/me") return route.fulfill({ json: {
        isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", name: "Fixture" },
      } });
      if (pathname !== "/api/graphql") return route.fulfill({ json: {} });
      const request = route.request().postDataJSON();
      const query = request.query || "";
      if (query.includes("mutation")) {
        assert.ok(query.includes("bmsMarkConversationRead"), "Smoke must not send a reply");
        assert.match(String(request.variables.observedLatestMessageId), /^[12]$/);
        markReadCalls++;
        readBody = body;
        return route.fulfill({ json: { data: { bmsMarkConversationRead: true } } });
      }
      if (query.includes("bmsConversation(id:")) {
        detailCalls++;
        if (request.variables?.id === "FAKE-other") {
          await new Promise(resolve => setTimeout(resolve, 400));
        } else if (failDetailOnce) {
          failDetailOnce = false;
          return route.fulfill({ status: 500, json: { errors: [{ message: "Fixture detail failure" }] } });
        }
      }
      return route.fulfill({ json: { data: {
        myBmsPermissions: ["inbox.view", "inbox.reply", "inbox.manage"],
        bmsIsPlatformAdmin: false, bmsActingTenant: null, bmsStoreProfile: null,
        bmsMe: { id: "FAKE-admin", role: "Administrator", is_available: true, gender: null,
          tenant: { slug: "fixture" } },
        bmsConversations: request.variables?.status === "CLOSED" ? []
          : [fixture(body, readBody === body ? 0 : 1), otherFixture()],
        bmsConversation: request.variables?.id === "FAKE-missing" ? null
          : request.variables?.id === "FAKE-other" ? otherFixture()
          : fixture(body, readBody === body ? 0 : 1),
        bmsAssignableStaff: [], bmsInboxUnreadCount: 1, bmsMyMentionsUnreadCount: 0,
      } } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(30000);
    await page.goto(`${origin}/admin/inbox`);
    await page.getByText("Fixture Customer").first().waitFor();
    await page.locator(".ant-segmented-item-label").filter({ hasText: "CLOSED" }).click();
    await page.locator(".bms-inbox-conversation-scroll").getByText("Fixture Customer").waitFor({ state: "hidden" });
    await page.locator(".ant-segmented-item-label").filter({ hasText: "OPEN" }).click();
    await page.getByText("Fixture Customer").first().waitFor();
    assert.equal(detailCalls, 0, "No selected conversation must not fetch detail");
    await page.getByText("Fixture Customer").first().click();
    await page.getByRole("button", { name: /retry/i }).waitFor();
    assert.equal(markReadCalls, 0, "Failed detail must retain unread");
    await page.getByRole("button", { name: /retry/i }).click();
    await page.getByText("First fixture message").last().waitFor();
    if (width > 600) {
      await page.getByText("Other Fixture").first().click();
      await page.getByText("Fixture Customer").first().click();
      await page.getByText("First fixture message").last().waitFor();
      assert.equal(await page.getByText("Other fixture message").count(), 1,
        "A delayed prior detail must not replace the selected conversation");
      await page.locator("button:has(.anticon-menu-fold)").first().click();
      await page.locator("button:has(.anticon-menu-unfold)").first().click();
    } else {
      await page.locator("button:has(.anticon-left)").first().click();
      await page.getByText("Other Fixture").first().click();
      await page.getByText("Other fixture message").last().waitFor();
      await page.locator("button:has(.anticon-left)").first().click();
      await page.getByText("Fixture Customer").first().click();
      await page.getByText("First fixture message").last().waitFor();
    }
    await page.waitForFunction(() => new URL(location.href).searchParams.has("c"));
    const readsBeforeSecond = markReadCalls;
    body = "Second fixture message";
    if (width > 600) page.setDefaultTimeout(45000); // Wait for the 20s list poll with WebSocket closed.
    else await page.reload();
    await page.getByText("Second fixture message").last().waitFor();
    assert.ok(markReadCalls > readsBeforeSecond, "The new visible message should be marked read");
    await page.reload();
    await page.getByText("Second fixture message").last().waitFor();
    await page.goto(`${origin}/admin/inbox?c=FAKE-missing`);
    await page.getByText("Conversation not found or access denied").waitFor();
    assert.deepEqual(errors.filter(error => error !== "CloseEvent"), []);
    console.log(`PASS Inbox detail selection, retry, socket-off recovery and reload at ${width}px`);
    await context.close();
  }
} finally {
  await browser.close();
}

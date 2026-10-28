import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Real route + synthetic GraphQL fixtures. This proves UI rendering, not live delivery/RLS.
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3007";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = ".test-output/presales-callback-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["th", "en"]) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([
      { name: "ADMIN_COOKIE", value: "FAKE-browser-fixture", url: base },
      { name: "lang", value: lang, url: base },
    ]);
    const conversations = [
      ["FAKE-callback", "FAKE Callback", "OPEN", ["sales-callback", "hot-lead"]],
      ["FAKE-ordinary", "FAKE Ordinary", "OPEN", []],
      ["FAKE-closed", "FAKE Closed", "CLOSED", ["sales-callback"]],
    ].map(([id, customerName, status, tags]) => ({
      id, customerName, status, tags, channel: "line", customerRef: id,
      customerAvatar: null, sourceDisplayName: "FAKE BMS", sourceHandle: "@fake",
      sourceAvatar: null, unread: 0, lastMessage: "FAKE prospect message",
      lastMessageAt: "2026-10-28T10:00:00Z", assignedStaff: null,
    }));
    await context.route(/\/(?:api\/|graphql)/, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/me") return route.fulfill({ json: {
        isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", name: "FAKE", language: lang },
      } });
      if (path === "/api/graphql" || path === "/graphql") {
        const data = {
          myBmsPermissions: ["inbox.view", "inbox.reply", "inbox.manage", "inbox.assign"],
          bmsMe: { id: "FAKE-admin", role: "Administrator", name: "FAKE", email: "fake@example.test", avatar: null, gender: null, is_available: true, tenant: { slug: "fake", id: "FAKE-tenant" } },
          bmsActingTenant: null, bmsIsPlatformAdmin: false, bmsStoreProfile: { businessArchetype: "retail" },
          bmsConversations: conversations, bmsAssignableStaff: [], bmsInboxUnreadCount: 1,
          bmsMyMentionsUnreadCount: 1, bmsChannelHealthCount: 0, bmsRestockReadyCount: 0,
          bmsKitchenBoardEnabled: false, bmsWastageEnabled: false, bmsPackToolsConfigured: false,
          bmsAiLimitNotifications: { unreadCount: 0, items: [] },
        };
        return route.fulfill({ json: { data } });
      }
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(20000);
    try {
      await page.goto(`${base}/admin/inbox`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.getByText("FAKE Callback", { exact: true }).waitFor();
      const callbackLabel = lang === "th" ? "Sales ติดต่อกลับ" : "Sales callback";
      assert.equal(await page.getByText(callbackLabel, { exact: true }).count(), 1, "only active callback work has the priority label");
      await page.getByRole("button", { name: lang === "th" ? /ด่วนก่อน/ : /Urgent first/ }).click();
      await page.getByText("FAKE Ordinary", { exact: true }).waitFor({ state: "hidden" });
      await page.getByText("FAKE Closed", { exact: true }).waitFor({ state: "hidden" });
      await page.getByText("FAKE Callback", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false, "no horizontal document overflow");
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}/${lang}-${width}.png`, fullPage: true });
    } catch (error) {
      await page.screenshot({ path: `${output}/failure-${lang}-${width}.png`, fullPage: true });
      throw error;
    } finally {
      await context.close();
    }
  }
  console.log("PASS Inbox callback priority: th/en, desktop/mobile, read callback remains urgent, closed work excluded, no overflow");
} finally {
  await browser.close();
}

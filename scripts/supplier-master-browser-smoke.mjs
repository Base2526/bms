import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3199";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = ".test-output/supplier-master";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const supplierId = "00000000-0000-4000-8000-000000000111";

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.addCookies([
      { name: "ADMIN_COOKIE", value: "FAKE-browser-fixture", url: base },
      { name: "lang", value: "th", url: base },
    ]);
    const errors = [];
    const mutations = [];
    let supplier = null;
    await context.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/me") return route.fulfill({ json: {
        isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", language: "th" },
      } });
      if (path !== "/api/graphql") return route.fulfill({ json: {} });
      const body = route.request().postDataJSON();
      const query = body?.query || "";
      if (query.includes("mutation BmsUpsertSupplier")) {
        mutations.push(body.variables.input);
        supplier = { id: supplierId, ...body.variables.input };
        return route.fulfill({ json: { data: { bmsUpsertSupplier: supplier } } });
      }
      const data = {
        myBmsPermissions: ["purchase.view", "purchase.edit"],
        bmsPurchaseOrders: [],
        bmsSuppliers: supplier ? [supplier] : [],
        bmsMe: { id: "FAKE-admin", tenant: { id: "FAKE-tenant" } },
        bmsActingTenant: null,
        bmsIsPlatformAdmin: false,
        bmsMyTenant: { id: "FAKE-tenant", name: "FAKE shop", slug: "fake" },
        bmsChannels: [], bmsChannelHealth: [], bmsChannelHealthCount: 0,
        bmsInboxUnreadCount: 0, bmsMyMentionsUnreadCount: 0, bmsRestockReadyCount: 0,
      };
      return route.fulfill({ json: { data } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message));
    const websocketUrls = [];
    page.on("websocket", socket => websocketUrls.push(socket.url()));
    try {
      await page.goto(`${base}/admin/purchase`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByRole("button", { name: "จัดการผู้ขาย" }).click();
      const modal = page.getByRole("dialog", { name: "จัดการผู้ขาย" });
      await modal.getByLabel("ชื่อผู้ขาย").fill("FAKE supplier");
      await modal.getByLabel("โทรศัพท์").fill("0812345678");
      await modal.getByLabel("อีเมล").fill("supplier@example.test");
      await modal.getByLabel("เลขผู้เสียภาษี 13 หลัก").fill("1234567890123");
      await modal.getByLabel("รหัสสาขา 5 หลัก").fill("00000");
      await modal.getByLabel("ที่อยู่").fill("FAKE address");
      await modal.getByLabel("หมายเหตุ").fill("FAKE note");
      await modal.getByRole("button", { name: "บันทึกผู้ขาย" }).click();
      await page.waitForFunction(() => document.querySelector('.ant-message-success'));
      assert.equal(mutations.length, 1);
      assert.deepEqual(mutations[0], {
        name: "FAKE supplier", phone: "0812345678", email: "supplier@example.test",
        note: "FAKE note", taxId: "1234567890123", branchCode: "00000",
        address: "FAKE address", entityType: null,
      });
      await modal.getByText("FAKE supplier").waitFor();
      await modal.getByRole("button", { name: "แก้ไข" }).click();
      assert.equal(await modal.getByLabel("อีเมล").inputValue(), "supplier@example.test");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}/${width}.png`, fullPage: true });
      const manualResponse = await page.goto(`${base}/admin/manual`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.equal(manualResponse?.status(), 200);
      await page.waitForFunction(() => document.body.innerText.trim().length > 50);
      await page.screenshot({ path: `${output}/manual-${width}.png` });
      assert.deepEqual(errors, []);
      assert.ok(!websocketUrls.some(url => url.endsWith("/undefined")), "missing realtime URL must not open a relative socket");
      console.log(`PASS supplier ${width}px: create payload, list readback, edit form, no page overflow (mocked API)`);
    } catch (error) {
      await page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true });
      console.error({ errors, text: (await page.locator("body").innerText()).slice(0, 5000) });
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

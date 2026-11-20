import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3199";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = ".test-output/customer-master";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const customerId = "00000000-0000-4000-8000-000000000021";
const addressId = "00000000-0000-4000-8000-000000000022";

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-browser-fixture", url: base },
      { name: "lang", value: "th", url: base }]);
    const errors = [], mutations = [];
    let customer = { id: customerId, name: "FAKE Customer", phone: null, note: null, tags: [],
      total_spent: 0, order_count: 0, created_at: "2026-11-20T00:00:00Z",
      identities: [], addresses: [], orders: [], coupons: [], membership: null };
    await context.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/me") return route.fulfill({ json: { isAuthenticated: true,
        admin: { id: "FAKE-admin", role: "Administrator", language: "th" } } });
      if (path !== "/api/graphql") return route.fulfill({ json: {} });
      const body = route.request().postDataJSON();
      const query = body?.query || "";
      if (query.includes("bmsAddCustomerAddress")) {
        mutations.push(body.variables);
        customer.addresses = [{ id: addressId, label: body.variables.label,
          address: body.variables.address, is_default: body.variables.isDefault,
          province: null, postcode: null, provinceCode: null, districtCode: null, subdistrictCode: null }];
        return route.fulfill({ json: { data: { bmsAddCustomerAddress: { id: addressId } } } });
      }
      const data = {
        myBmsPermissions: ["customer.view", "customer.edit"],
        bmsCustomers: [customer], bmsCustomerLocations: [],
        provinces: [], districts: [], subdistricts: [],
        bmsMe: { id: "FAKE-admin", tenant: { id: "FAKE-tenant" } },
        bmsActingTenant: null, bmsIsPlatformAdmin: false,
        bmsMyTenant: { id: "FAKE-tenant", name: "FAKE Shop", slug: "fake" },
        bmsChannels: [], bmsChannelHealth: [], bmsChannelHealthCount: 0,
        bmsInboxUnreadCount: 0, bmsMyMentionsUnreadCount: 0, bmsRestockReadyCount: 0,
      };
      return route.fulfill({ json: { data } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(`${base}/admin/customers`, { waitUntil: "domcontentloaded", timeout: 120000 });
      const row = page.locator(`tr[data-row-key="${customerId}"]`);
      await row.getByText("FAKE Customer", { exact: true }).waitFor();
      await row.getByRole("button", { name: "ที่อยู่" }).click();
      const modal = page.getByRole("dialog");
      await modal.getByLabel("ที่อยู่", { exact: true }).fill("FAKE address");
      await modal.locator("#isDefault").locator("xpath=ancestor::div[contains(@class, 'ant-select-selector')]").click();
      await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").getByText("ใช่", { exact: true }).click();
      await modal.getByRole("button", { name: "เพิ่ม", exact: true }).click();
      await row.locator("button.ant-table-row-expand-icon").click();
      await page.getByText("FAKE address", { exact: true }).waitFor();
      assert.equal(mutations.length, 1);
      assert.equal(mutations[0].id, customerId);
      assert.equal(mutations[0].address, "FAKE address");
      assert.equal(mutations[0].isDefault, true);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}/${width}.png`, fullPage: true });
      console.log(`PASS customer ${width}px: default address form sends true and reads back (mocked API)`);
    } catch (error) {
      await page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true });
      console.error({ errors, text: (await page.locator("body").innerText()).slice(0, 5000) });
      throw error;
    } finally { await context.close(); }
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, serviceWorkers: "block" });
  await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-browser-fixture", url: base },
    { name: "lang", value: "th", url: base }]);
  await context.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { isAuthenticated: true,
      admin: { id: "FAKE-viewer", role: "Sales", language: "th" } } });
    return route.fulfill({ json: { data: { myBmsPermissions: ["customer.view"],
      bmsCustomers: [{ id: customerId, name: "FAKE Customer", phone: null, note: null, tags: [],
        total_spent: 0, order_count: 0, created_at: "2026-11-20T00:00:00Z",
        identities: [], addresses: [], orders: [], coupons: [], membership: null }],
      bmsCustomerLocations: [], provinces: [], districts: [], subdistricts: [],
      bmsMe: { id: "FAKE-viewer", tenant: { id: "FAKE-tenant" } },
      bmsActingTenant: null, bmsIsPlatformAdmin: false,
      bmsMyTenant: { id: "FAKE-tenant", name: "FAKE Shop", slug: "fake" },
      bmsChannels: [], bmsChannelHealth: [], bmsChannelHealthCount: 0,
      bmsInboxUnreadCount: 0, bmsMyMentionsUnreadCount: 0, bmsRestockReadyCount: 0,
    } } });
  });
  try {
    const page = await context.newPage();
    await page.goto(`${base}/admin/customers`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const row = page.locator(`tr[data-row-key="${customerId}"]`);
    await row.getByText("FAKE Customer", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "เพิ่มลูกค้า" }).count(), 0);
    assert.equal(await row.getByRole("button", { name: "แก้ไข" }).count(), 0);
    await row.locator("button.ant-table-row-expand-icon").click();
    assert.equal(await page.getByRole("button", { name: "เพิ่มที่อยู่" }).count(), 0);
    console.log("PASS customer 390px view-only: edit, address and create controls hidden");
  } finally { await context.close(); }
} finally { await browser.close(); }
